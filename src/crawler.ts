import {
  completeCrawlRun,
  failCrawlRun,
  getClosureCandidates,
  getCompanyClosureCandidates,
  listEnabledMonitoredCompanies,
  markSourceJobClosed,
  recordMonitoredCompanyFailure,
  recordMonitoredCompanySuccess,
  saveHydratedJob,
  sourceIsDue,
  startCrawlRun,
  upsertDiscoveryBatch,
} from "./db";
import { fillMissingBasics, needsBasics, resetEnrichmentBudget } from "./enrich";
import { SourceHttpError } from "./http";
import { createFingerprint, evaluateRelevance, isStrictHighFit } from "./relevance";
import { sources } from "./sources";
import {
  checkCompanyJobActive,
  discoverCompanyJobs,
  hydrateCompanyJob,
} from "./sources/companyCareers";
import { shouldCloseMissingCompanyJob } from "./sources/companyLifecycle";
import { deliverInstant, retryFailedInstantDeliveries, telegramConfigured } from "./telegram";
import type {
  CareerAdapter,
  CrawlMode,
  CrawlStats,
  DiscoveryRecord,
  JobSource,
  MonitoredCompany,
  NormalizedJob,
  SourceName,
} from "./types";

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

/**
 * Scores a hydrated job, and pays Firecrawl to read the posting when a strong
 * match is missing the employer or the place before scoring it again.
 */
async function scoreHydrated(job: NormalizedJob, source: SourceName) {
  const relevance = evaluateRelevance(job, { requireIdentity: true });
  if (!needsBasics(job, relevance, source)) return { job, relevance };

  const enriched = await fillMissingBasics(job);
  if (enriched === job) return { job, relevance };
  return { job: enriched, relevance: evaluateRelevance(enriched, { requireIdentity: true }) };
}

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

function companyRecord(candidate: Awaited<ReturnType<typeof getCompanyClosureCandidates>>[number]) {
  return {
    source: "company_careers" as const,
    sourceId: String(candidate.source_id),
    companyId: candidate.company_id as string | null,
    url: String(candidate.url),
    title: String(candidate.title),
    company: candidate.company as string | null,
    location: candidate.location as string | null,
    snippet: candidate.snippet as string | null,
    publishedAt: candidate.published_at as string | null,
    rawData: candidate.raw_data as Record<string, unknown>,
  };
}

async function closeMissingCompanyJobs(
  company: MonitoredCompany,
  adapter: CareerAdapter,
  before: string,
): Promise<void> {
  const candidates = await getCompanyClosureCandidates(company.id, before);
  for (const candidate of candidates) {
    const record = companyRecord(candidate);
    const fallbackStillActive =
      adapter === "generic" ? await checkCompanyJobActive(record) : undefined;
    if (!shouldCloseMissingCompanyJob(adapter, fallbackStillActive)) {
      continue;
    }
    await markSourceJobClosed(
      "company_careers",
      record.sourceId,
      candidate.job_id as string | null,
    );
  }
}

async function crawlCompanyCareers(options: CrawlOptions): Promise<CrawlStats> {
  const stats = emptyStats();
  const runId = options.dryRun ? null : await startCrawlRun("company_careers", options.mode);
  const companies = await listEnabledMonitoredCompanies();
  let successfulCompanies = 0;
  let previewCount = 0;
  const failures: string[] = [];

  try {
    for (const company of companies) {
      const companyStartedAt = new Date().toISOString();
      try {
        const discovery = await discoverCompanyJobs(company);
        stats.pagesFetched += 1;
        const records = [
          ...new Map(discovery.records.map((record) => [record.sourceId, record])).values(),
        ];
        stats.jobsDiscovered += records.length;

        if (options.dryRun) {
          for (const record of records) {
            const relevance = evaluateRelevance(await hydrateCompanyJob(record));
            if (relevance.tier !== "filtered_out" && previewCount < 20) {
              console.log(
                `[company_careers/${company.name}] ${relevance.tier}: ${record.title} — ${record.url}`,
              );
              previewCount += 1;
            }
          }
          successfulCompanies += 1;
          console.log(
            `company_careers/${company.name}: ${records.length} jobs via ${discovery.adapter}`,
          );
          continue;
        }

        const newIds = await upsertDiscoveryBatch(records);
        stats.newSourceJobs += newIds.size;
        for (const record of records) {
          if (!newIds.has(record.sourceId)) continue;
          const preliminary = evaluateRelevance(discoveryPreview(record));
          if (preliminary.tier === "filtered_out") continue;

          const { job: normalized, relevance } = await scoreHydrated(
            await hydrateCompanyJob(record),
            "company_careers",
          );
          const fingerprint = createFingerprint(normalized);
          const { job, isNew } = await saveHydratedJob(record, normalized, relevance, fingerprint);
          stats.jobsHydrated += 1;
          if (isNew && isStrictHighFit(normalized, relevance) && telegramConfigured()) {
            await deliverInstant(job, "company_careers");
          }
        }

        await closeMissingCompanyJobs(company, discovery.adapter, companyStartedAt);
        await recordMonitoredCompanySuccess(company.id, discovery.adapter, discovery.adapterKey);
        successfulCompanies += 1;
        console.log(
          `company_careers/${company.name}: ${records.length} jobs via ${discovery.adapter}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const pauseEligible = error instanceof SourceHttpError && [403, 429].includes(error.status);
        if (!options.dryRun) {
          await recordMonitoredCompanyFailure(company, message, pauseEligible);
        }
        failures.push(`${company.name}: ${message}`);
        console.error(`company_careers/${company.name} failed: ${message}`);
      }
    }

    if (companies.length > 0 && successfulCompanies === 0) {
      throw new Error(failures.join("\n") || "No monitored company completed successfully");
    }
    if (runId) await completeCrawlRun(runId, "company_careers", stats);
    console.log(
      `company_careers: ${JSON.stringify({ ...stats, successfulCompanies, failedCompanies: failures.length })}`,
    );
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) await failCrawlRun(runId, "company_careers", message, stats, false);
    throw error;
  }
}

export async function crawlSource(name: SourceName, options: CrawlOptions): Promise<CrawlStats> {
  if (name === "jooble" && !process.env.JOOBLE_API_KEY) {
    console.log("jooble: skipped until JOOBLE_API_KEY is configured");
    return emptyStats();
  }
  if (!options.dryRun && !(await sourceIsDue(name, options.force))) {
    console.log(`${name}: not due or disabled`);
    return emptyStats();
  }
  if (name === "company_careers") return crawlCompanyCareers(options);
  const source = sources[name];

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

        const { job: normalized, relevance } = await scoreHydrated(
          await source.hydrate(record),
          name,
        );
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
  resetEnrichmentBudget();
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
