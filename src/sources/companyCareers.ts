import * as cheerio from "cheerio";
import { fetchJson, fetchText, SourceHttpError } from "../http";
import { extractJsonLdJob, htmlToText, inactiveText, inferRemoteMode, parseDate } from "../parsers";
import type { CareerAdapter, DiscoveryRecord, MonitoredCompany, NormalizedJob } from "../types";
import { assertSafeCareerUrl, normalizeCareerUrl } from "./careerUrl";
import { stableId } from "./shared";

type AdapterDetection = {
  adapter: Exclude<CareerAdapter, "generic">;
  key: string;
  region?: "eu";
};

export type CompanyDiscovery = {
  adapter: CareerAdapter;
  adapterKey: string | null;
  records: DiscoveryRecord[];
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function string(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(string).filter((item): item is string => item !== null);
}

function htmlDescription(value: unknown): string | null {
  const parsed = htmlToText(string(value));
  return parsed && /<\/?[a-z][^>]*>/i.test(parsed) ? htmlToText(parsed) : parsed;
}

export function detectCareerAdapter(value: string): AdapterDetection | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "jobs.ashbyhq.com" && segments[0]) {
    return { adapter: "ashby", key: segments[0] };
  }
  if (host === "api.ashbyhq.com" && segments[0] === "posting-api" && segments[2]) {
    return { adapter: "ashby", key: segments[2] };
  }

  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(host) && segments[0]) {
    return {
      adapter: "lever",
      key: segments[0],
      ...(host === "jobs.eu.lever.co" ? { region: "eu" as const } : {}),
    };
  }
  if (["api.lever.co", "api.eu.lever.co"].includes(host) && segments[0] === "v0" && segments[2]) {
    return {
      adapter: "lever",
      key: segments[2],
      ...(host === "api.eu.lever.co" ? { region: "eu" as const } : {}),
    };
  }

  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(host)) {
    const key = url.searchParams.get("for") ?? (segments[0] === "embed" ? null : segments[0]);
    if (key) return { adapter: "greenhouse", key };
  }
  if (host === "boards-api.greenhouse.io" && segments[0] === "v1" && segments[2]) {
    return { adapter: "greenhouse", key: segments[2] };
  }

  return null;
}

function recordFromNormalized(
  company: MonitoredCompany,
  adapter: CareerAdapter,
  externalId: string,
  normalized: NormalizedJob,
  raw: unknown,
): DiscoveryRecord {
  return {
    source: "company_careers",
    sourceId: stableId(`${company.id}:${adapter}:${externalId}`),
    companyId: company.id,
    url: normalized.canonicalUrl,
    title: normalized.title,
    company: normalized.company ?? company.name,
    location: normalized.location,
    snippet: normalized.description,
    publishedAt: normalized.publishedAt,
    rawData: {
      adapter,
      externalId,
      normalized,
      providerPayload: object(raw) ?? { value: raw },
    },
  };
}

export function parseAshbyJobs(payload: unknown, company: MonitoredCompany): DiscoveryRecord[] {
  const jobs = object(payload)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("Ashby response neobsahuje seznam jobs.");
  const records: DiscoveryRecord[] = [];
  for (const raw of jobs) {
    const job = object(raw);
    if (!job || job.isListed === false) continue;
    const title = string(job.title);
    const canonicalUrl = string(job.jobUrl) ?? string(job.applyUrl);
    const externalId = string(job.id) ?? string(job.jobPostingId) ?? canonicalUrl;
    if (!title || !canonicalUrl || !externalId) continue;
    const description = string(job.descriptionPlain) ?? htmlDescription(job.descriptionHtml);
    const secondaryLocations = Array.isArray(job.secondaryLocations)
      ? job.secondaryLocations
          .map((location) => string(location) ?? string(object(location)?.location))
          .filter((location): location is string => location !== null)
      : [];
    const location =
      [string(job.location), ...secondaryLocations]
        .filter(
          (item, index, values): item is string => Boolean(item) && values.indexOf(item) === index,
        )
        .join(", ") || null;
    records.push(
      recordFromNormalized(
        company,
        "ashby",
        externalId,
        {
          title,
          company: company.name,
          location,
          remoteMode: inferRemoteMode(
            [string(job.workplaceType), location, description].filter(Boolean).join(" "),
          ),
          description,
          canonicalUrl,
          publishedAt: parseDate(string(job.publishedAt)),
        },
        raw,
      ),
    );
  }
  return records;
}

export function parseGreenhouseJobs(
  payload: unknown,
  company: MonitoredCompany,
): DiscoveryRecord[] {
  const jobs = object(payload)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("Greenhouse response neobsahuje seznam jobs.");
  const records: DiscoveryRecord[] = [];
  for (const raw of jobs) {
    const job = object(raw);
    if (!job) continue;
    const title = string(job.title) ?? string(job.name);
    const canonicalUrl = string(job.absolute_url);
    const externalId = String(job.id ?? "").trim();
    if (!title || !canonicalUrl || !externalId) continue;
    const location = string(object(job.location)?.name);
    const description = htmlDescription(job.content);
    records.push(
      recordFromNormalized(
        company,
        "greenhouse",
        externalId,
        {
          title,
          company: string(job.company_name) ?? company.name,
          location,
          remoteMode: inferRemoteMode([location, description].filter(Boolean).join(" ")),
          description,
          canonicalUrl,
          publishedAt: parseDate(string(job.first_published)),
        },
        raw,
      ),
    );
  }
  return records;
}

export function parseLeverJobs(payload: unknown, company: MonitoredCompany): DiscoveryRecord[] {
  if (!Array.isArray(payload)) throw new Error("Lever response neobsahuje seznam pozic.");
  const records: DiscoveryRecord[] = [];
  for (const raw of payload) {
    const job = object(raw);
    if (!job) continue;
    const title = string(job.text);
    const canonicalUrl = string(job.hostedUrl) ?? string(job.applyUrl);
    const externalId = string(job.id);
    if (!title || !canonicalUrl || !externalId) continue;
    const categories = object(job.categories);
    const allLocations = stringArray(categories?.allLocations);
    const primaryLocation = string(categories?.location);
    const location =
      [...(primaryLocation ? [primaryLocation] : []), ...allLocations]
        .filter((item, index, values) => values.indexOf(item) === index)
        .join(", ") || null;
    const description = string(job.descriptionPlain) ?? htmlDescription(job.description);
    const createdAt =
      typeof job.createdAt === "number" ? new Date(job.createdAt).toISOString() : null;
    records.push(
      recordFromNormalized(
        company,
        "lever",
        externalId,
        {
          title,
          company: company.name,
          location,
          remoteMode: inferRemoteMode(
            [string(job.workplaceType), location, description].filter(Boolean).join(" "),
          ),
          description,
          canonicalUrl,
          publishedAt: createdAt ?? parseDate(string(job.createdAt)),
        },
        raw,
      ),
    );
  }
  return records;
}

async function discoverWithAdapter(
  company: MonitoredCompany,
  detection: AdapterDetection,
): Promise<DiscoveryRecord[]> {
  if (detection.adapter === "ashby") {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(detection.key)}`;
    return parseAshbyJobs(await fetchJson(url, { validateUrl: assertSafeCareerUrl }), company);
  }
  if (detection.adapter === "greenhouse") {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(detection.key)}/jobs?content=true`;
    return parseGreenhouseJobs(await fetchJson(url, { validateUrl: assertSafeCareerUrl }), company);
  }
  const host = detection.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const url = `https://${host}/v0/postings/${encodeURIComponent(detection.key)}?mode=json`;
  return parseLeverJobs(await fetchJson(url, { validateUrl: assertSafeCareerUrl }), company);
}

function detectEmbeddedAdapter(html: string, baseUrl: string): AdapterDetection | null {
  const $ = cheerio.load(html);
  for (const element of $("[href], [src]").toArray()) {
    const value = $(element).attr("href") ?? $(element).attr("src");
    if (!value) continue;
    try {
      const detection = detectCareerAdapter(new URL(value, baseUrl).toString());
      if (detection) return detection;
    } catch {
      // Ignore invalid third-party attributes and keep looking.
    }
  }

  for (const match of html.matchAll(
    /https?:\\?\/\\?\/[\w.-]*(?:ashbyhq|greenhouse|lever)\.[^"'<>\s\\]+/gi,
  )) {
    const candidate = match[0].replaceAll("\\/", "/").replaceAll("&amp;", "&");
    const detection = detectCareerAdapter(candidate);
    if (detection) return detection;
  }
  return null;
}

const genericJobPath =
  /\/(?:job|jobs|career|careers|position|positions|vacancy|vacancies|opening|openings|pozice|volne-pozice|volna-mista|kariera)(?:\/|[-_])/i;

export function extractGenericJobUrls(html: string, listingUrl: string): string[] {
  const $ = cheerio.load(html);
  const listing = new URL(listingUrl);
  const normalizedListing = normalizeCareerUrl(listingUrl);
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, listing);
      if (url.origin !== listing.origin || !genericJobPath.test(url.pathname)) return;
      const normalized = normalizeCareerUrl(url.toString());
      if (normalized !== normalizedListing) urls.add(normalized);
    } catch {
      // Ignore malformed links from third-party pages.
    }
  });
  return [...urls].slice(0, 100);
}

async function discoverGeneric(
  company: MonitoredCompany,
  listingHtml: string,
): Promise<DiscoveryRecord[]> {
  const records: DiscoveryRecord[] = [];
  for (const url of extractGenericJobUrls(listingHtml, company.careersUrl)) {
    const html = await fetchText(url, { validateUrl: assertSafeCareerUrl });
    const normalized = extractJsonLdJob(html, url);
    if (!normalized) continue;
    records.push(
      recordFromNormalized(
        company,
        "generic",
        normalized.canonicalUrl,
        { ...normalized, company: normalized.company ?? company.name },
        { url },
      ),
    );
  }
  if (records.length === 0) {
    throw new Error("Career page nemá podporovaný ATS ani čitelné JobPosting odkazy.");
  }
  return records;
}

export async function discoverCompanyJobs(company: MonitoredCompany): Promise<CompanyDiscovery> {
  await assertSafeCareerUrl(company.careersUrl);
  const direct = detectCareerAdapter(company.careersUrl);
  if (direct) {
    return {
      adapter: direct.adapter,
      adapterKey: direct.key,
      records: await discoverWithAdapter(company, direct),
    };
  }

  const html = await fetchText(company.careersUrl, { validateUrl: assertSafeCareerUrl });
  const embedded = detectEmbeddedAdapter(html, company.careersUrl);
  if (embedded) {
    return {
      adapter: embedded.adapter,
      adapterKey: embedded.key,
      records: await discoverWithAdapter(company, embedded),
    };
  }
  return { adapter: "generic", adapterKey: null, records: await discoverGeneric(company, html) };
}

export async function hydrateCompanyJob(record: DiscoveryRecord): Promise<NormalizedJob> {
  const normalized = object(record.rawData?.normalized);
  if (!normalized) throw new Error(`Company job ${record.sourceId} nemá normalizovaná data.`);
  return {
    title: string(normalized.title) ?? record.title,
    company: string(normalized.company) ?? record.company ?? null,
    location: string(normalized.location),
    remoteMode: ["remote", "hybrid", "onsite", "unknown"].includes(String(normalized.remoteMode))
      ? (normalized.remoteMode as NormalizedJob["remoteMode"])
      : "unknown",
    description: string(normalized.description),
    canonicalUrl: string(normalized.canonicalUrl) ?? record.url,
    publishedAt: parseDate(string(normalized.publishedAt)),
  };
}

export async function checkCompanyJobActive(record: DiscoveryRecord): Promise<boolean> {
  try {
    const html = await fetchText(record.url, { retries: 0, validateUrl: assertSafeCareerUrl });
    return !inactiveText(html);
  } catch (error) {
    if (error instanceof SourceHttpError && error.status === 404) return false;
    throw error;
  }
}
