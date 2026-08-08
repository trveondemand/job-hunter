import * as cheerio from "cheerio";
import type { DiscoveryRecord, NormalizedJob, RemoteMode } from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function findJobPosting(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }

  const object = asObject(value);
  if (!object) return null;

  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some((type) => String(type).toLowerCase() === "jobposting")) return object;

  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const found = findJobPosting(object[key]);
    if (found) return found;
  }

  return null;
}

export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

const text = cleanText;

export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const $ = cheerio.load(`<main>${html}</main>`);
  $("script,style,noscript").remove();
  return text($("main").text());
}

function extractCompany(posting: JsonObject): string | null {
  const organization = asObject(posting.hiringOrganization);
  return text(organization?.name) ?? text(posting.hiringOrganization);
}

function extractLocations(posting: JsonObject): string | null {
  const locations = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : posting.jobLocation
      ? [posting.jobLocation]
      : [];

  const values: string[] = [];
  for (const location of locations) {
    const object = asObject(location);
    const address = asObject(object?.address);
    for (const value of [
      address?.addressLocality,
      address?.addressRegion,
      asObject(address?.addressCountry)?.name,
      address?.addressCountry,
      object?.name,
    ]) {
      const parsed = text(value);
      if (parsed && !values.includes(parsed)) values.push(parsed);
    }
  }
  return values.length > 0 ? values.join(", ") : null;
}

export function inferRemoteMode(input: string): RemoteMode {
  const normalized = input.toLocaleLowerCase("cs-CZ");
  if (/hybrid|hybridn|kombinovan/.test(normalized)) return "hybrid";
  if (/remote|pr[aá]ce na d[aá]lku|home[ -]?office|telecommute/.test(normalized)) return "remote";
  if (/on[ -]?site|onsite|na pracovi[sš]ti|z kancel[aá][rř]e/.test(normalized)) return "onsite";
  return "unknown";
}

export function extractJsonLdJob(html: string, fallbackUrl: string): NormalizedJob | null {
  const $ = cheerio.load(html);
  let posting: JsonObject | null = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (posting) return;
    const raw = $(element).text().trim();
    if (!raw) return;
    try {
      posting = findJobPosting(JSON.parse(raw));
    } catch {
      // Invalid third-party JSON-LD should not prevent the source-specific fallback.
    }
  });

  if (!posting) return null;
  const parsedPosting = posting as JsonObject;

  const description = htmlToText(text(parsedPosting.description));
  const remoteHint = [
    text(parsedPosting.jobLocationType),
    description,
    extractLocations(parsedPosting),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: text(parsedPosting.title) ?? text($("h1").first().text()) ?? "Untitled position",
    company: extractCompany(parsedPosting),
    location: extractLocations(parsedPosting),
    remoteMode: inferRemoteMode(remoteHint),
    description,
    canonicalUrl: text(parsedPosting.url) ?? fallbackUrl,
    publishedAt: parseDate(text(parsedPosting.datePosted)),
  };
}

const locationLabel =
  /(?:location|lokalita|lokace|m[íi]sto (?:v[ýy]konu pr[áa]ce|pracovi[šs]t[ěe]))\s*[:–-]\s*([\p{L}][^|•·\n]{1,58})/iu;

const knownCity =
  /\b(Praha|Prague|Brno|Ostrava|Plze[ňn]|Olomouc|Liberec|Pardubice|Zl[íi]n|Hradec Kr[áa]lov[ée]|[ČC]esk[ée] Bud[ěe]jovice|Bratislava)\b/;

/**
 * Plenty of career sites publish no JobPosting metadata at all, but they still
 * put the role in the page heading. The heading with the page text is enough to
 * score the job; a missing heading is what tells a listing or a marketing page
 * apart from an actual opening, so that case returns null.
 */
export function extractHeadingJob(html: string, url: string): NormalizedJob | null {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,footer,header,dialog").remove();
  const title = text($("h1").first().text());
  if (!title) return null;

  const description = htmlToText($("main").html() ?? $("body").html());
  const body = description ?? "";
  const location = text(body.match(locationLabel)?.[1]) ?? text(body.match(knownCity)?.[0]);

  return {
    title,
    company: null,
    location,
    remoteMode: inferRemoteMode(`${location ?? ""} ${body}`),
    description,
    canonicalUrl: url,
    publishedAt: null,
  };
}

export function extractHtmlFallback(html: string, record: DiscoveryRecord): NormalizedJob {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,footer,header,dialog").remove();
  const bodyText = htmlToText($("main").html() ?? $("body").html());
  const title = text($("h1").first().text()) ?? record.title;
  const description = bodyText ?? record.snippet ?? null;

  return {
    title,
    company: record.company ?? null,
    location: record.location ?? null,
    remoteMode: inferRemoteMode([record.location, description].filter(Boolean).join(" ")),
    description,
    canonicalUrl: record.url,
    publishedAt: parseDate(record.publishedAt),
  };
}

export function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function titleFromSlug(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  return decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function inactiveText(html: string): boolean {
  const normalized = htmlToText(html)?.toLocaleLowerCase("cs-CZ") ?? "";
  return [
    "pozice již není aktivní",
    "position is no longer active",
    "nabídka již není aktivní",
    "tato nabídka už není dostupná",
  ].some((phrase) => normalized.includes(phrase));
}
