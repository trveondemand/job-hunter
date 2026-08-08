import type { SourceName } from "./types";

export const USER_AGENT =
  "Sofhunter/0.1 (+https://github.com/trveondemand/job-hunter; personal-use monitor)";

export const APP_URL =
  process.env.APP_URL ?? process.env.VITE_APP_URL ?? "https://trveondemand.github.io/job-hunter/";

export const JOBS_CZ_QUERIES = [
  "customer success",
  "customer onboarding",
  "implementation manager",
  "implementation consultant",
  "project manager",
  "program manager",
  "service delivery",
  "professional services",
  "client success",
  "customer experience",
  "customer operations",
  "partner success",
  "adoption manager",
] as const;

export const JOOBLE_QUERIES = [
  "customer success",
  "onboarding",
  "implementation manager",
  "project manager",
  "program manager",
  "service delivery",
  "professional services",
  "customer operations",
] as const;

/**
 * Datacruit is an agency board that never names its client, so no posting from
 * it can satisfy the requirement that a job say who it is for. Crawling it only
 * produces entries that are filtered out. Delete the entry here to bring it
 * back — the adapter and its stored postings are untouched.
 */
export const DISABLED_SOURCES = new Set<SourceName>(["datacruit"]);

export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 1_250);
// Safety valve, not an expectation: after the jobs.cz and Datacruit parsers
// were fixed, only a handful of postings per run should still need paying for.
export const FIRECRAWL_MAX_PER_RUN = Number(process.env.FIRECRAWL_MAX_PER_RUN ?? 15);
export const TARGETED_PAGES = Number(process.env.TARGETED_PAGES ?? 3);
export const JOBS_CZ_FULL_MAX_PAGES = Number(process.env.JOBS_CZ_FULL_MAX_PAGES ?? 350);
export const DATACRUIT_MAX_PAGES = Number(process.env.DATACRUIT_MAX_PAGES ?? 100);
