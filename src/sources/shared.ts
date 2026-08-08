import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { fetchText, SourceHttpError } from "../http";
import { extractHtmlFallback, extractJsonLdJob, inactiveText, inferRemoteMode } from "../parsers";
import type { DiscoveryRecord, NormalizedJob, SourceName } from "../types";

export function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** Reads whatever a specific board puts in its markup instead of JSON-LD. */
export type DetailExtractor = (html: string) => {
  company?: string | null;
  location?: string | null;
};

export async function hydrateHtml(
  record: DiscoveryRecord,
  extractDetail?: DetailExtractor,
): Promise<NormalizedJob> {
  const html = await fetchText(record.url);
  const base = extractJsonLdJob(html, record.url) ?? extractHtmlFallback(html, record);
  if (!extractDetail) return base;

  const detail = extractDetail(html);
  const company = base.company ?? detail.company ?? null;
  const location = base.location ?? detail.location ?? null;
  if (company === base.company && location === base.location) return base;

  return {
    ...base,
    company,
    location,
    remoteMode:
      base.remoteMode === "unknown"
        ? inferRemoteMode([location, base.description].filter(Boolean).join(" "))
        : base.remoteMode,
  };
}

export async function checkHtmlActive(record: DiscoveryRecord): Promise<boolean> {
  try {
    const html = await fetchText(record.url, { retries: 0 });
    return !inactiveText(html);
  } catch (error) {
    if (error instanceof SourceHttpError && error.status === 404) return false;
    throw error;
  }
}

type LinkPattern = {
  source: SourceName;
  baseUrl: string;
  pattern: RegExp;
};

export function extractJobLinks(html: string, config: LinkPattern): DiscoveryRecord[] {
  const $ = cheerio.load(html);
  const jobs = new Map<string, DiscoveryRecord>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, config.baseUrl);
    } catch {
      return;
    }

    const match = url.pathname.match(config.pattern);
    if (!match?.[1]) return;

    const heading = $(element).find("h1,h2,h3,h4").first().text();
    const label = (heading || $(element).attr("title") || $(element).text())
      .replace(/\s+/g, " ")
      .trim();
    if (label.length < 3 || label.length > 220) return;

    const sourceId = match[1];
    const existing = jobs.get(sourceId);
    if (existing && existing.title.length <= label.length) return;

    jobs.set(sourceId, {
      source: config.source,
      sourceId,
      title: label,
      url: url.toString(),
    });
  });

  return [...jobs.values()];
}
