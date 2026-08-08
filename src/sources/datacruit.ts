import * as cheerio from "cheerio";
import { DATACRUIT_MAX_PAGES } from "../config";
import { fetchText } from "../http";
import { cleanText } from "../parsers";
import type { DiscoveryBatch, JobSource } from "../types";
import { checkHtmlActive, extractJobLinks, hydrateHtml } from "./shared";

const BASE_URL = "https://jobs.datacruit.com";

// Datacruit is an agency board: postings name the location but keep the client
// company anonymous, so only the location is recoverable from the title
// ("Customer Care with German - Prague").
export function extractDatacruitDetail(html: string) {
  const $ = cheerio.load(html);
  const title = cleanText($('meta[property="og:title"]').attr("content"));
  const parts = title?.split(" - ") ?? [];
  return { location: parts.length > 1 ? cleanText(parts.at(-1)) : null };
}

export const datacruitSource: JobSource = {
  name: "datacruit",

  async *discover(): AsyncGenerator<DiscoveryBatch> {
    const signatures = new Set<string>();
    for (let page = 1; page <= DATACRUIT_MAX_PAGES; page += 1) {
      const url = new URL("/nabidky-prace/praha/", BASE_URL);
      url.searchParams.set("page", String(page));
      const html = await fetchText(url.toString());
      const records = extractJobLinks(html, {
        source: "datacruit",
        baseUrl: BASE_URL,
        pattern: /^\/pozice\/.+-(\d+)\/?$/,
      });
      const signature = records
        .map((record) => record.sourceId)
        .sort()
        .join(",");
      if (records.length === 0 || signatures.has(signature)) break;
      signatures.add(signature);
      yield { records, page };
    }
  },

  hydrate: (record) => hydrateHtml(record, extractDatacruitDetail),
  checkActive: checkHtmlActive,
};
