import { FIRECRAWL_MAX_PER_RUN } from "./config";
import { evaluateRelevance } from "./relevance";
import type { NormalizedJob, RelevanceResult, SourceName } from "./types";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

const basicsSchema = {
  type: "object",
  properties: {
    company: {
      type: "string",
      description: "Název zaměstnavatele. Vynech, pokud inzerát firmu neuvádí.",
    },
    location: {
      type: "string",
      description: "Město nebo místo výkonu práce. Vynech, pokud není uvedeno.",
    },
    remote_mode: {
      type: "string",
      description: "Jedno z: remote, hybrid, onsite. Vynech, pokud to z inzerátu nevyplývá.",
    },
  },
} as const;

let spentThisRun = 0;

export function resetEnrichmentBudget(): void {
  spentThisRun = 0;
}

// Datacruit is an agency board whose postings deliberately keep the client
// anonymous, so re-reading one to look for an employer only ever costs credits.
const anonymousSources = new Set<SourceName>(["datacruit"]);

/**
 * A job that looks strong but does not say where it is, or who it is for, is
 * hard to review, so it is worth one paid read of the posting itself.
 */
export function needsBasics(
  job: NormalizedJob,
  relevance: RelevanceResult,
  source: SourceName,
): boolean {
  if (relevance.tier !== "strong") return false;
  if (!job.location) return true;
  return !job.company && !anonymousSources.has(source);
}

// On job pages that render client-side there is nothing for the extractor to
// read but the boilerplate, so it comes back with the portal operator's own
// name and registered address instead of the employer's.
const portalOperator = /alma career|menclova 2538|\blmc\b|jobs\.cz|datacruit|startupjobs/i;

export function isPortalBoilerplate(value: string): boolean {
  return portalOperator.test(value);
}

function cleaned(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > 200 || !/\p{L}/u.test(result)) return null;
  if (isPortalBoilerplate(result)) return null;
  return /nen[íi] uveden|neuveden|not (specified|stated|available)|^(unknown|n\/a)$/i.test(result)
    ? null
    : result;
}

function asRemoteMode(value: unknown): NormalizedJob["remoteMode"] | null {
  const parsed = cleaned(value)?.toLowerCase();
  return parsed === "remote" || parsed === "hybrid" || parsed === "onsite" ? parsed : null;
}

/**
 * Returns the job unchanged when there is no key, no budget left, or nothing
 * new to learn; enrichment must never be the reason a crawl fails.
 */
export async function fillMissingBasics(job: NormalizedJob): Promise<NormalizedJob> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return job;
  if (spentThisRun >= FIRECRAWL_MAX_PER_RUN) return job;
  spentThisRun += 1;

  try {
    const response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        url: job.canonicalUrl,
        onlyMainContent: true,
        formats: [
          {
            type: "json",
            schema: basicsSchema,
            prompt:
              "Z tohoto pracovního inzerátu vytáhni zaměstnavatele a místo výkonu práce. Ignoruj údaje o provozovateli pracovního portálu v hlavičce a patičce stránky. U personálních agentur, které klienta neuvádějí, pole company vynech — nehádej.",
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      console.warn(`firecrawl: HTTP ${response.status} for ${job.canonicalUrl}`);
      return job;
    }

    const payload = (await response.json()) as { data?: { json?: Record<string, unknown> } };
    const extracted = payload.data?.json ?? {};
    const company = job.company ?? cleaned(extracted.company);
    const location = job.location ?? cleaned(extracted.location);
    if (company === job.company && location === job.location) return job;

    return {
      ...job,
      company,
      location,
      remoteMode:
        job.remoteMode === "unknown"
          ? (asRemoteMode(extracted.remote_mode) ?? job.remoteMode)
          : job.remoteMode,
    };
  } catch (error) {
    console.warn(
      `firecrawl failed for ${job.canonicalUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return job;
  }
}

/**
 * Scores a hydrated job, and pays Firecrawl to read the posting when a strong
 * match is missing the employer or the place before scoring it again.
 *
 * Whether to pay is decided without the identity gate on purpose: a posting
 * with neither field would already be filtered out by it, which is exactly the
 * posting worth paying to rescue. The gate only decides the stored verdict.
 */
export async function scoreHydrated(job: NormalizedJob, source: SourceName) {
  const provisional = evaluateRelevance(job);
  const enriched = needsBasics(job, provisional, source) ? await fillMissingBasics(job) : job;
  return { job: enriched, relevance: evaluateRelevance(enriched, { requireIdentity: true }) };
}
