import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import type {
  CrawlMode,
  CrawlStats,
  DiscoveryRecord,
  NormalizedJob,
  RelevanceResult,
  SourceName,
  StoredJob,
} from "./types";

let singleton: SupabaseClient<Database> | null = null;

export function db(): SupabaseClient<Database> {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  singleton = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return singleton;
}

function assertNoError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function assertData<T>(data: T | null, context: string): asserts data is T {
  if (data === null) throw new Error(`${context}: query returned no data`);
}

export async function sourceIsDue(source: SourceName, force: boolean): Promise<boolean> {
  if (force) return true;
  const { data, error } = await db()
    .from("source_configs")
    .select("enabled, interval_minutes, last_success_at")
    .eq("source", source)
    .single();
  assertNoError(error, `Read ${source} config`);
  assertData(data, `Read ${source} config`);
  if (!data.enabled) return false;
  if (!data.last_success_at) return true;
  return Date.now() - new Date(data.last_success_at).getTime() >= data.interval_minutes * 60_000;
}

export async function startCrawlRun(source: SourceName, mode: CrawlMode): Promise<string> {
  const { data, error } = await db()
    .from("crawl_runs")
    .insert({ source, mode, status: "running" })
    .select("id")
    .single();
  assertNoError(error, `Start ${source} crawl`);
  assertData(data, `Start ${source} crawl`);
  return data.id as string;
}

export async function completeCrawlRun(
  runId: string,
  source: SourceName,
  stats: CrawlStats,
): Promise<void> {
  const now = new Date().toISOString();
  const { error: runError } = await db()
    .from("crawl_runs")
    .update({
      status: "completed",
      finished_at: now,
      pages_fetched: stats.pagesFetched,
      jobs_discovered: stats.jobsDiscovered,
      new_source_jobs: stats.newSourceJobs,
      jobs_hydrated: stats.jobsHydrated,
    })
    .eq("id", runId);
  assertNoError(runError, `Complete ${source} crawl`);

  const { error: configError } = await db()
    .from("source_configs")
    .update({ last_success_at: now, consecutive_failures: 0, paused_reason: null })
    .eq("source", source);
  assertNoError(configError, `Update ${source} config`);
}

export async function failCrawlRun(
  runId: string,
  source: SourceName,
  errorMessage: string,
  stats: CrawlStats,
  pauseEligible: boolean,
): Promise<void> {
  const { error: runError } = await db()
    .from("crawl_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      pages_fetched: stats.pagesFetched,
      jobs_discovered: stats.jobsDiscovered,
      new_source_jobs: stats.newSourceJobs,
      jobs_hydrated: stats.jobsHydrated,
      error: errorMessage.slice(0, 2_000),
    })
    .eq("id", runId);
  assertNoError(runError, `Fail ${source} crawl`);

  const { data, error } = await db()
    .from("source_configs")
    .select("consecutive_failures")
    .eq("source", source)
    .single();
  assertNoError(error, `Read ${source} failures`);
  assertData(data, `Read ${source} failures`);
  const failures = Number(data.consecutive_failures) + 1;
  const pause = pauseEligible && failures >= 3;
  const { error: updateError } = await db()
    .from("source_configs")
    .update({
      consecutive_failures: failures,
      enabled: !pause,
      paused_reason: pause ? errorMessage.slice(0, 500) : null,
    })
    .eq("source", source);
  assertNoError(updateError, `Record ${source} failure`);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function upsertDiscoveryBatch(records: DiscoveryRecord[]): Promise<Set<string>> {
  if (records.length === 0) return new Set();
  const unique = [...new Map(records.map((record) => [record.sourceId, record])).values()];
  const existingIds = new Set<string>();

  for (const batch of chunks(unique, 100)) {
    const { data, error } = await db()
      .from("source_jobs")
      .select("source_id")
      .eq("source", batch[0].source)
      .in(
        "source_id",
        batch.map((record) => record.sourceId),
      );
    assertNoError(error, `Read existing ${batch[0].source} jobs`);
    for (const row of data ?? []) existingIds.add(String(row.source_id));
  }

  const now = new Date().toISOString();
  for (const batch of chunks(unique, 200)) {
    const { error } = await db()
      .from("source_jobs")
      .upsert(
        batch.map((record) => ({
          source: record.source,
          source_id: record.sourceId,
          url: record.url,
          title: record.title,
          company: record.company ?? null,
          location: record.location ?? null,
          snippet: record.snippet ?? null,
          published_at: record.publishedAt ?? null,
          raw_data: (record.rawData ?? {}) as Json,
          last_seen_at: now,
          status: "active",
        })),
        { onConflict: "source,source_id" },
      );
    assertNoError(error, `Upsert ${batch[0].source} discovery batch`);
  }

  return new Set(
    unique.filter((record) => !existingIds.has(record.sourceId)).map((record) => record.sourceId),
  );
}

export async function saveHydratedJob(
  record: DiscoveryRecord,
  normalized: NormalizedJob,
  relevance: RelevanceResult,
  fingerprint: string,
): Promise<{ job: StoredJob; isNew: boolean }> {
  const { data: existing, error: existingError } = await db()
    .from("jobs")
    .select("id")
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  assertNoError(existingError, "Read canonical job");
  const isNew = !existing;
  const now = new Date().toISOString();

  const { data, error } = await db()
    .from("jobs")
    .upsert(
      {
        fingerprint,
        title: normalized.title,
        company: normalized.company,
        location: normalized.location,
        remote_mode: normalized.remoteMode,
        description: normalized.description,
        canonical_url: normalized.canonicalUrl,
        published_at: normalized.publishedAt,
        relevance_tier: relevance.tier,
        matched_rules: relevance.matchedRules,
        negative_rules: relevance.negativeRules,
        status: "active",
        last_seen_at: now,
      },
      { onConflict: "fingerprint" },
    )
    .select(
      "id, fingerprint, title, company, location, remote_mode, description, canonical_url, published_at, relevance_tier, matched_rules, negative_rules, first_seen_at, instant_alert_sent_at",
    )
    .single();
  assertNoError(error, "Upsert canonical job");
  assertData(data, "Upsert canonical job");

  const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const { error: sourceError } = await db()
    .from("source_jobs")
    .update({
      job_id: data.id,
      title: normalized.title,
      company: normalized.company,
      location: normalized.location,
      published_at: normalized.publishedAt,
      content_hash: contentHash,
      last_checked_at: now,
    })
    .eq("source", record.source)
    .eq("source_id", record.sourceId);
  assertNoError(sourceError, "Attach source job");

  if (relevance.tier !== "filtered_out") {
    const { error: reviewError } = await db()
      .from("reviews")
      .upsert(
        { job_id: data.id, state: "unseen" },
        { onConflict: "job_id", ignoreDuplicates: true },
      );
    assertNoError(reviewError, "Create review state");
  }

  return {
    isNew,
    job: {
      id: String(data.id),
      fingerprint: String(data.fingerprint),
      title: String(data.title),
      company: data.company as string | null,
      location: data.location as string | null,
      remoteMode: data.remote_mode as StoredJob["remoteMode"],
      description: data.description as string | null,
      canonicalUrl: String(data.canonical_url),
      publishedAt: data.published_at as string | null,
      tier: data.relevance_tier as StoredJob["tier"],
      matchedRules: data.matched_rules as string[],
      negativeRules: data.negative_rules as string[],
      locationConfirmed: relevance.locationConfirmed,
      firstSeenAt: String(data.first_seen_at),
      instantAlertSentAt: data.instant_alert_sent_at as string | null,
    },
  };
}

export async function markInstantAlertSent(jobId: string): Promise<void> {
  const { error } = await db()
    .from("jobs")
    .update({ instant_alert_sent_at: new Date().toISOString() })
    .eq("id", jobId);
  assertNoError(error, "Mark instant alert sent");
}

export async function getClosureCandidates(source: SourceName, before: string) {
  const { data, error } = await db()
    .from("source_jobs")
    .select(
      "source, source_id, url, title, company, location, snippet, published_at, raw_data, job_id",
    )
    .eq("source", source)
    .eq("status", "active")
    .not("job_id", "is", null)
    .lt("last_seen_at", before)
    .limit(50);
  assertNoError(error, `Read ${source} closure candidates`);
  return data ?? [];
}

export async function markSourceJobClosed(
  source: SourceName,
  sourceId: string,
  jobId: string | null,
) {
  const { error } = await db()
    .from("source_jobs")
    .update({ status: "closed", last_checked_at: new Date().toISOString() })
    .eq("source", source)
    .eq("source_id", sourceId);
  assertNoError(error, "Close source job");
  if (!jobId) return;

  const { count, error: countError } = await db()
    .from("source_jobs")
    .select("source_id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "active");
  assertNoError(countError, "Count active job sources");
  if ((count ?? 0) === 0) {
    const { error: jobError } = await db()
      .from("jobs")
      .update({ status: "closed" })
      .eq("id", jobId);
    assertNoError(jobError, "Close canonical job");
  }
}

export { assertNoError };
