import * as cheerio from "cheerio";
import { fetchText } from "../http";
import { titleFromSlug } from "../parsers";
import type { DiscoveryBatch, DiscoveryRecord, JobSource } from "../types";
import { checkHtmlActive, hydrateHtml } from "./shared";

const SITEMAP_URL = "https://www.startupjobs.cz/sitemap/offers.xml";

export const startupJobsSource: JobSource = {
  name: "startupjobs",

  async *discover(): AsyncGenerator<DiscoveryBatch> {
    const xml = await fetchText(SITEMAP_URL);
    const $ = cheerio.load(xml, { xmlMode: true });
    const records: DiscoveryRecord[] = [];

    $("url > loc").each((_, element) => {
      const url = $(element).text().trim();
      const match = new URL(url).pathname.match(/^\/nabidka\/(\d+)\//);
      if (!match?.[1]) return;
      records.push({
        source: "startupjobs",
        sourceId: match[1],
        title: titleFromSlug(url),
        url,
      });
    });

    yield { records, page: 1 };
  },

  hydrate: hydrateHtml,
  checkActive: checkHtmlActive,
};
