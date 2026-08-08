import {
  completeCrawlRun,
  failCrawlRun,
  getClosureCandidates,
  markSourceJobClosed,
  saveHydratedJob,
  sourceIsDue,
  startCrawlRun,
  upsertDiscoveryBatch,
} from "./db";
import { SourceHttpError } from "./http";
import { createFingerprint, evaluateRelevance, isStrictHighFit } from "./relevance";
import { sources } from "./sources";
import { deliverInstant, retryFailedInstantDeliveries, telegramConfigured } from "./telegram";
import type { CrawlMode, CrawlStats, DiscoveryRecord, JobSource, SourceName } from "./types";

export type CrawlOptions = {
  dryRun: boolean;
  force: boolean;
  mode: CrawlMode;
};

const emptyStats = (): CrawlStats => ({
  pagesFetched: 0,
  jobsDiscovered: 0,
  newSourceJobs: 0,
  jobsHydrated: 0,
});

function discoveryPreview(record: DiscoveryRecord) {
  return {
    title: record.title,
    company: record.company ?? null,
    location: record.location ?? null,
    remoteMode: "unknown" as const,
    description: record.snippet ?? null,
    canonicalUrl: record.url,
    publishedAt: record.publishedAt ?? null,
  };
}

async function checkClosures(source: JobSource, before: string): Promise<void> {
  const candidates = await getClosureCandidates(source.name, before);
  for (const candidate of candidates) {
    const record: DiscoveryRecord = {
      source: source.name,
      sourceId: String(candidate.source_id),
      url: String(candidate.url),
      title: String(candidate.title),
      company: candidate.company as string | null,
      location: candidate.location as string | null,
      snippet: candidate.snippet as string | null,
      publishedAt: candidate.published_at as string | null,
      rawData: candidate.raw_data as Record<string, unknown>,
    };
    if (!(await source.checkActive(record))) {
      await markSourceJobClosed(source.name, record.sourceId, candidate.job_id as string | null);
    }
  }
}

export async function crawlSource(name: SourceName, options: CrawlOptions): Promise<CrawlStats> {
  const source = sources[name];
  if (name === "jooble" && !process.env.JOOBLE_API_KEY) {
    console.log("jooble: skipped until JOOBLE_API_KEY is configured");
    return emptyStats();
  }
  if (!options.dryRun && !(await sourceIsDue(name, options.force))) {
    console.log(`${name}: not due or disabled`);
    return emptyStats();
  }

  const stats = emptyStats();
  const runStartedAt = new Date().toISOString();
  const runId = options.dryRun ? null : await startCrawlRun(name, options.mode);
  const seenThisRun = new Set<string>();
  let previewCount = 0;

  try {
    for await (const batch of source.discover({ mode: options.mode })) {
      stats.pagesFetched += 1;
      const records = batch.records.filter((record) => {
        if (seenThisRun.has(record.sourceId)) return false;
        seenThisRun.add(record.sourceId);
        return true;
      });
      stats.jobsDiscovered += records.length;

      if (options.dryRun) {
        for (const record of records) {
          const relevance = evaluateRelevance(discoveryPreview(record));
          if (relevance.tier !== "filtered_out" && previewCount < 12) {
            console.log(`[${name}] ${relevance.tier}: ${record.title} — ${record.url}`);
            previewCount += 1;
          }
        }
        continue;
      }

      const newIds = await upsertDiscoveryBatch(records);
      stats.newSourceJobs += newIds.size;

      for (const record of records) {
        if (!newIds.has(record.sourceId)) continue;
        const preliminary = evaluateRelevance(discoveryPreview(record));
        if (preliminary.tier === "filtered_out") continue;

        const normalized = await source.hydrate(record);
        const relevance = evaluateRelevance(normalized);
        const fingerprint = createFingerprint(normalized);
        const { job, isNew } = await saveHydratedJob(record, normalized, relevance, fingerprint);
        stats.jobsHydrated += 1;

        if (isNew && isStrictHighFit(normalized, relevance) && telegramConfigured()) {
          await deliverInstant(job, name);
        }
      }
    }

    if (!options.dryRun && options.mode === "full") await checkClosures(source, runStartedAt);
    if (runId) await completeCrawlRun(runId, name, stats);
    console.log(`${name}: ${JSON.stringify(stats)}`);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pauseEligible = error instanceof SourceHttpError && [403, 429].includes(error.status);
    if (runId) await failCrawlRun(runId, name, message, stats, pauseEligible);
    throw error;
  }
}

export async function crawlSources(names: SourceName[], options: CrawlOptions): Promise<void> {
  const failures: string[] = [];
  for (const name of names) {
    try {
      await crawlSource(name, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${name} failed: ${message}`);
      failures.push(`${name}: ${message}`);
    }
  }

  if (!options.dryRun && telegramConfigured()) {
    await retryFailedInstantDeliveries();
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}
