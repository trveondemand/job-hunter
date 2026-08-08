import * as cheerio from "cheerio";
import { fetchJson, fetchText, SourceHttpError } from "../http";
import {
  extractHeadingJob,
  extractJsonLdJob,
  htmlToText,
  inactiveText,
  inferRemoteMode,
  parseDate,
} from "../parsers";
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

  // Greenhouse serves European boards from .eu hosts, but their job lists still
  // come from the one global API, so the region only matters for recognition.
  if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(host)) {
    const key = url.searchParams.get("for") ?? (segments[0] === "embed" ? null : segments[0]);
    if (key) return { adapter: "greenhouse", key };
  }
  if (/^boards-api(?:\.eu)?\.greenhouse\.io$/.test(host) && segments[0] === "v1" && segments[2]) {
    return { adapter: "greenhouse", key: segments[2] };
  }

  if (host === "api.recruitee.com" && segments[0] === "c" && segments[1]) {
    return { adapter: "recruitee", key: segments[1] };
  }
  if (host.endsWith(".recruitee.com")) {
    const subdomain = host.slice(0, -".recruitee.com".length);
    if (subdomain && !["api", "www", "widget"].includes(subdomain)) {
      return { adapter: "recruitee", key: subdomain };
    }
  }

  return null;
}

const recruiteeWidgetConfig = /RTWidget\s*\(\s*\{[\s\S]{0,400}?companies\s*:\s*\[\s*(\d+)/;
const lmcWidgetConfig = /__LMC_CAREER_WIDGET__\s*=\s*(\{[^{}]*\})/;

/**
 * Recruitee and Teamio are embedded as a script that renders the openings in
 * the browser, so the page never links to them. What it does carry is the
 * widget's own configuration, and that names the board.
 */
export function detectWidgetAdapter(html: string): AdapterDetection | null {
  const recruitee = html.match(recruiteeWidgetConfig)?.[1];
  if (recruitee) return { adapter: "recruitee", key: recruitee };

  const lmc = html.match(lmcWidgetConfig)?.[1];
  if (lmc) {
    try {
      const config = object(JSON.parse(lmc));
      const widgetId = string(config?.widgetId);
      const apiKey = string(config?.apiKey);
      if (widgetId && apiKey) return { adapter: "teamio", key: `${widgetId}:${apiKey}` };
    } catch {
      // A widget config we cannot read is no better than no widget at all.
    }
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

export function parseRecruiteeOffers(
  payload: unknown,
  company: MonitoredCompany,
): DiscoveryRecord[] {
  const offers = object(payload)?.offers;
  if (!Array.isArray(offers)) throw new Error("Recruitee response neobsahuje seznam offers.");
  const records: DiscoveryRecord[] = [];
  for (const raw of offers) {
    const offer = object(raw);
    if (!offer) continue;
    const status = string(offer.status);
    if (status && status !== "published") continue;
    const title = string(offer.title);
    const canonicalUrl = string(offer.careers_url) ?? string(offer.careers_apply_url);
    const externalId = String(offer.id ?? offer.slug ?? "").trim();
    if (!title || !canonicalUrl || !externalId) continue;
    const location =
      string(offer.location) ??
      ([string(offer.city), string(offer.country)].filter(Boolean).join(", ") || null);
    const description = htmlDescription(
      [string(offer.description), string(offer.requirements)].filter(Boolean).join(" "),
    );
    const remoteMode =
      offer.remote === true
        ? "remote"
        : offer.hybrid === true
          ? "hybrid"
          : offer.on_site === true
            ? "onsite"
            : inferRemoteMode([location, description].filter(Boolean).join(" "));
    records.push(
      recordFromNormalized(
        company,
        "recruitee",
        externalId,
        {
          title,
          company: string(offer.company_name) ?? company.name,
          location,
          remoteMode,
          description,
          canonicalUrl,
          publishedAt: parseDate(string(offer.published_at) ?? string(offer.created_at)),
        },
        raw,
      ),
    );
  }
  return records;
}

const TEAMIO_ENDPOINT = "https://api.capybara.lmc.cz/api/graphql/widget";

const TEAMIO_LISTING_QUERY = `query JobHunterListing($widgetId: ID!, $page: Int, $filters: [JobAdFilter!]!, $useExampleData: Boolean!) {
  widget(id: $widgetId, useExampleData: $useExampleData) {
    jobAdList(page: $page, filters: $filters) {
      paginator { currentPage lastPage }
      groupedJobAds { ...group groups { ...group groups { ...group } } }
    }
  }
}
fragment group on JobAdGroup {
  jobAds { id title validFrom teaser employer { companyName } locations { city region country } }
}`;

function teamioJobAdList(payload: unknown): JsonObject | null {
  return object(object(object(object(payload)?.data)?.widget)?.jobAdList);
}

function collectTeamioJobAds(group: unknown, into: unknown[]): void {
  const parsed = object(group);
  if (!parsed) return;
  if (Array.isArray(parsed.jobAds)) into.push(...parsed.jobAds);
  if (Array.isArray(parsed.groups)) {
    for (const nested of parsed.groups) collectTeamioJobAds(nested, into);
  }
}

/**
 * The Teamio widget renders each opening on the career page itself rather than
 * on a page of its own, so `?detail=<id>` is the only address a reader can be
 * sent to. The listing carries a teaser instead of the full text; asking for
 * every description would mean one more request per opening.
 */
export function parseTeamioJobAds(payload: unknown, company: MonitoredCompany): DiscoveryRecord[] {
  const jobAdList = teamioJobAdList(payload);
  if (!jobAdList) throw new Error("Teamio response neobsahuje seznam pozic.");

  const jobAds: unknown[] = [];
  collectTeamioJobAds(jobAdList.groupedJobAds, jobAds);

  const records: DiscoveryRecord[] = [];
  for (const raw of jobAds) {
    const job = object(raw);
    if (!job) continue;
    const externalId = String(job.id ?? "").trim();
    const title = string(job.title);
    if (!title || !externalId) continue;
    const canonicalUrl = new URL(company.careersUrl);
    canonicalUrl.searchParams.set("detail", externalId);
    const location = Array.isArray(job.locations)
      ? job.locations
          .map((entry) => {
            const parsed = object(entry);
            return [string(parsed?.city), string(parsed?.country)].filter(Boolean).join(", ");
          })
          .filter((entry, index, values) => entry && values.indexOf(entry) === index)
          .join(" / ") || null
      : null;
    const description = string(job.teaser);
    records.push(
      recordFromNormalized(
        company,
        "teamio",
        externalId,
        {
          title,
          company: string(object(job.employer)?.companyName) ?? company.name,
          location,
          remoteMode: inferRemoteMode([location, description].filter(Boolean).join(" ")),
          description,
          canonicalUrl: canonicalUrl.toString(),
          publishedAt: parseDate(string(job.validFrom)),
        },
        raw,
      ),
    );
  }
  return records;
}

const TEAMIO_MAX_PAGES = 10;

async function discoverTeamioJobs(
  company: MonitoredCompany,
  key: string,
): Promise<DiscoveryRecord[]> {
  const separator = key.indexOf(":");
  const widgetId = key.slice(0, separator);
  const apiKey = key.slice(separator + 1);
  if (!widgetId || !apiKey) throw new Error("Teamio widget nemá použitelnou konfiguraci.");

  const records: DiscoveryRecord[] = [];
  for (let page = 1; page <= TEAMIO_MAX_PAGES; page += 1) {
    const payload = await fetchJson<Record<string, unknown>>(TEAMIO_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: JSON.stringify({
        query: TEAMIO_LISTING_QUERY,
        variables: { widgetId, page, filters: [], useExampleData: false },
      }),
      validateUrl: assertSafeCareerUrl,
    });
    records.push(...parseTeamioJobAds(payload, company));
    const lastPage = Number(object(teamioJobAdList(payload)?.paginator)?.lastPage ?? page);
    if (!Number.isFinite(lastPage) || page >= lastPage) break;
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
  if (detection.adapter === "recruitee") {
    // A numeric key is the account id the embedded widget knows itself by; a
    // named one is the board's own subdomain.
    const url = /^\d+$/.test(detection.key)
      ? `https://api.recruitee.com/c/${detection.key}/careers/offers`
      : `https://${encodeURIComponent(detection.key)}.recruitee.com/api/offers/`;
    return parseRecruiteeOffers(
      await fetchJson(url, { validateUrl: assertSafeCareerUrl }),
      company,
    );
  }
  if (detection.adapter === "teamio") {
    return discoverTeamioJobs(company, detection.key);
  }
  const host = detection.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const url = `https://${host}/v0/postings/${encodeURIComponent(detection.key)}?mode=json`;
  return parseLeverJobs(await fetchJson(url, { validateUrl: assertSafeCareerUrl }), company);
}

const atsUrl = /https?:\\?\/\\?\/[\w.-]*(?:ashbyhq|greenhouse|lever|recruitee)\.[^"'<>\s\\]+/gi;

// Scripts build their board address from a placeholder the page fills in later,
// and taking one at face value asks the ATS for a board named "${boardToken}".
const unresolvedPlaceholder = /[${}]|%7[bd]/i;

function detectAdapterInText(text: string): AdapterDetection | null {
  for (const match of text.matchAll(atsUrl)) {
    const candidate = match[0].replaceAll("\\/", "/").replaceAll("&amp;", "&");
    if (unresolvedPlaceholder.test(candidate)) continue;
    const detection = detectCareerAdapter(candidate);
    if (detection) return detection;
  }
  return null;
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

  return detectAdapterInText(html) ?? detectWidgetAdapter(html);
}

const careerScriptPath = /(?:^|[/_-])(?:career|careers|job|jobs)(?:[/_.-]|$)/i;
const MAX_CAREER_SCRIPTS = 4;

/**
 * Some career pages build their own list in the browser and keep the board's
 * address in the bundle that does it. Only bundles whose own path is about
 * careers are worth downloading, so a site that hides nothing pays nothing.
 */
async function detectScriptAdapter(
  html: string,
  baseUrl: string,
): Promise<AdapterDetection | null> {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const scripts = new Set<string>();
  $("script[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    try {
      const url = new URL(src, base);
      if (url.origin === base.origin && careerScriptPath.test(url.pathname)) {
        scripts.add(url.toString());
      }
    } catch {
      // Ignore malformed script sources.
    }
  });

  for (const script of [...scripts].slice(0, MAX_CAREER_SCRIPTS)) {
    try {
      const detection = detectAdapterInText(
        await fetchText(script, { retries: 0, validateUrl: assertSafeCareerUrl }),
      );
      if (detection) return detection;
    } catch {
      // A bundle we cannot read is simply not a source of an ATS address.
    }
  }
  return null;
}

const genericJobPath =
  /\/(?:job|jobs|career|careers|position|positions|vacancy|vacancies|opening|openings|pozice|volne-pozice|volna-mista|kariera)(?:\/|[-_])/i;

// Pages that sit among the openings without being one.
const nonJobSlug =
  /^(?:signup|sign-up|subscribe|newsletter|alerts|referral|referrals|apply|contact|benefits|team|culture|life|blog|faq|login|thank-you|privacy)$/i;

function pathSegments(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean);
}

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
      if (nonJobSlug.test(pathSegments(url.toString()).at(-1) ?? "")) return;
      const normalized = normalizeCareerUrl(url.toString());
      if (normalized !== normalizedListing) urls.add(normalized);
    } catch {
      // Ignore malformed links from third-party pages.
    }
  });
  return [...urls].slice(0, 100);
}

function sharedPrefixLength(urls: string[]): number {
  const [first, ...rest] = urls.map(pathSegments);
  let length = 0;
  while (length < first.length && rest.every((segments) => segments[length] === first[length])) {
    length += 1;
  }
  return length;
}

/**
 * A career page addresses its openings from one template, so they show up as a
 * set of sibling links of equal depth under a shared path. Taking the largest
 * such set is what separates the openings from the handful of section links
 * that happen to live under /careers too; demanding a shared prefix keeps out
 * unrelated pages of the same depth, such as language variants of the page
 * itself.
 */
export function selectJobLinkGroup(urls: string[]): string[] {
  const byDepth = new Map<number, string[]>();
  for (const url of urls) {
    const depth = pathSegments(url).length;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), url]);
  }

  let best: string[] = [];
  for (const group of byDepth.values()) {
    if (group.length < 2 || group.length <= best.length) continue;
    if (sharedPrefixLength(group) === 0) continue;
    best = group;
  }
  return best;
}

const listingSlug =
  /^(?:jobs?|careers?|open-positions|open-roles|positions|vacancies|openings|volne-pozice|volna-mista|nabidka-prace|kariera|pozice)$/i;
const MAX_LISTING_HOPS = 3;

/**
 * A career URL is often only the page that introduces the team, with the
 * openings themselves one click further in.
 */
export function findListingPages(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const normalizedPage = normalizeCareerUrl(pageUrl);
  const pages = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, page);
      if (url.origin !== page.origin) return;
      if (!listingSlug.test(pathSegments(url.toString()).at(-1) ?? "")) return;
      const normalized = normalizeCareerUrl(url.toString());
      if (normalized !== normalizedPage) pages.add(normalized);
    } catch {
      // Ignore malformed links from third-party pages.
    }
  });
  return [...pages].slice(0, MAX_LISTING_HOPS);
}

/**
 * One dead or renamed link should not cost the whole company its crawl. Being
 * blocked or throttled is different: that is a fact about the site rather than
 * about the page, and the crawler pauses companies over it.
 */
async function fetchPageOrSkip(url: string): Promise<string | null> {
  try {
    return await fetchText(url, { validateUrl: assertSafeCareerUrl });
  } catch (error) {
    if (error instanceof SourceHttpError && [403, 429].includes(error.status)) throw error;
    return null;
  }
}

async function discoverGeneric(
  company: MonitoredCompany,
  listingHtml: string,
): Promise<CompanyDiscovery> {
  let links = selectJobLinkGroup(extractGenericJobUrls(listingHtml, company.careersUrl));

  for (const page of findListingPages(listingHtml, company.careersUrl)) {
    const html = await fetchPageOrSkip(page);
    if (!html) continue;
    const embedded = detectEmbeddedAdapter(html, page);
    if (embedded) {
      return {
        adapter: embedded.adapter,
        adapterKey: embedded.key,
        records: await discoverWithAdapter(company, embedded),
      };
    }
    const candidates = selectJobLinkGroup(extractGenericJobUrls(html, page));
    if (candidates.length > links.length) links = candidates;
  }

  const records: DiscoveryRecord[] = [];
  for (const url of links) {
    const html = await fetchPageOrSkip(url);
    if (!html) continue;
    const normalized = extractJsonLdJob(html, url) ?? extractHeadingJob(html, url);
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
    throw new Error(
      "Career page nenabízí čitelný seznam pozic — nejspíš se dokresluje v prohlížeči. Zkus místo ní vložit přímou adresu ATS (Greenhouse, Lever, Ashby, Recruitee).",
    );
  }
  return { adapter: "generic", adapterKey: null, records };
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
  const embedded =
    detectEmbeddedAdapter(html, company.careersUrl) ??
    (await detectScriptAdapter(html, company.careersUrl));
  if (embedded) {
    return {
      adapter: embedded.adapter,
      adapterKey: embedded.key,
      records: await discoverWithAdapter(company, embedded),
    };
  }
  return discoverGeneric(company, html);
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
