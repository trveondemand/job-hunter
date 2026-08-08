import { JOBS_CZ_FULL_MAX_PAGES, JOBS_CZ_QUERIES, TARGETED_PAGES } from "../config";
import { fetchText } from "../http";
import type { DiscoveryBatch, JobSource } from "../types";
import { checkHtmlActive, extractJobLinks, hydrateHtml } from "./shared";

const BASE_URL = "https://www.jobs.cz";

async function discoverPage(query: string | null, page: number) {
  const url = new URL("/prace/praha/", BASE_URL);
  url.searchParams.set("locality[radius]", "0");
  url.searchParams.set("page", String(page));
  if (query) url.searchParams.append("q[]", query);
  const html = await fetchText(url.toString());
  return extractJobLinks(html, {
    source: "jobs_cz",
    baseUrl: BASE_URL,
    pattern: /^\/rpd\/(\d+)\/?$/,
  });
}

export const jobsCzSource: JobSource = {
  name: "jobs_cz",

  async *discover(context): AsyncGenerator<DiscoveryBatch> {
    let batch = 0;
    if (context.mode === "targeted") {
      for (const query of JOBS_CZ_QUERIES) {
        for (let page = 1; page <= TARGETED_PAGES; page += 1) {
          const records = await discoverPage(query, page);
          batch += 1;
          yield { records, page: batch };
          if (records.length === 0) break;
        }
      }
      return;
    }

    const signatures = new Set<string>();
    for (let page = 1; page <= JOBS_CZ_FULL_MAX_PAGES; page += 1) {
      const records = await discoverPage(null, page);
      const signature = records
        .map((record) => record.sourceId)
        .sort()
        .join(",");
      if (records.length === 0 || signatures.has(signature)) break;
      signatures.add(signature);
      yield { records, page };
    }
  },

  hydrate: hydrateHtml,
  checkActive: checkHtmlActive,
};
