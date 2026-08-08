import { closeOrphanedJobs, getBackfillCandidates, saveHydratedJob } from "./db";
import { resetEnrichmentBudget, scoreHydrated } from "./enrich";
import { createFingerprint } from "./relevance";
import { sources } from "./sources";
import { hydrateCompanyJob } from "./sources/companyCareers";
import type { DiscoveryRecord, SourceName } from "./types";

function recordFrom(candidate: Awaited<ReturnType<typeof getBackfillCandidates>>[number]) {
  return {
    source: candidate.source as SourceName,
    sourceId: String(candidate.source_id),
    url: String(candidate.url),
    title: String(candidate.title),
    company: candidate.company as string | null,
    location: candidate.location as string | null,
    snippet: candidate.snippet as string | null,
    publishedAt: candidate.published_at as string | null,
    rawData: candidate.raw_data as Record<string, unknown>,
  } satisfies DiscoveryRecord;
}

function hydrate(record: DiscoveryRecord) {
  return record.source === "company_careers"
    ? hydrateCompanyJob(record)
    : sources[record.source].hydrate(record);
}

/**
 * Re-reads postings that were stored before the detail parsers could see an
 * employer or a location, and rescores them. Fingerprints are derived from
 * those fields, so a re-read usually moves a posting to a different canonical
 * job; whatever is left without any source is closed at the end.
 */
export async function backfillMissingBasics(dryRun: boolean, limit: number): Promise<void> {
  resetEnrichmentBudget();
  const candidates = await getBackfillCandidates(limit);
  console.log(`backfill: ${candidates.length} source jobs to re-read`);

  const tiers: Record<string, number> = {};
  let recovered = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const record = recordFrom(candidate);
    try {
      const { job, relevance } = await scoreHydrated(await hydrate(record), record.source);
      tiers[relevance.tier] = (tiers[relevance.tier] ?? 0) + 1;
      if (job.company || job.location) recovered += 1;

      if (dryRun) {
        console.log(
          `[${record.source}] ${relevance.tier}: ${job.company ?? "?"} / ${job.location ?? "?"} — ${record.url}`,
        );
        continue;
      }
      await saveHydratedJob(record, job, relevance, createFingerprint(job));
    } catch (error) {
      failed += 1;
      console.warn(
        `backfill failed for ${record.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const closed = dryRun ? 0 : await closeOrphanedJobs();
  console.log(`backfill: ${JSON.stringify({ recovered, failed, closed, tiers })}`);
}
