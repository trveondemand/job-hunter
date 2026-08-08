import { JOOBLE_QUERIES } from "../config";
import { fetchJson } from "../http";
import { inferRemoteMode, parseDate } from "../parsers";
import type { DiscoveryBatch, DiscoveryRecord, JobSource, NormalizedJob } from "../types";
import { stableId } from "./shared";

type JoobleJob = {
  id?: string | number;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
};

type JoobleResponse = {
  totalCount?: number;
  jobs?: JoobleJob[];
};

function apiKey(): string {
  const value = process.env.JOOBLE_API_KEY;
  if (!value) throw new Error("JOOBLE_API_KEY is required for the Jooble connector");
  return value;
}

function toDiscovery(job: JoobleJob): DiscoveryRecord | null {
  if (!job.title || !job.link) return null;
  return {
    source: "jooble",
    sourceId: String(job.id ?? stableId(job.link)),
    title: job.title,
    url: job.link,
    company: job.company ?? null,
    location: job.location ?? null,
    snippet: job.snippet ?? null,
    publishedAt: parseDate(job.updated),
    rawData: { salary: job.salary, source: job.source, employmentType: job.type },
  };
}

export const joobleSource: JobSource = {
  name: "jooble",

  async *discover(): AsyncGenerator<DiscoveryBatch> {
    let batchNumber = 0;
    for (const query of JOOBLE_QUERIES) {
      for (let page = 1; page <= 3; page += 1) {
        const response = await fetchJson<JoobleResponse>(`https://cz.jooble.org/api/${apiKey()}`, {
          method: "POST",
          body: JSON.stringify({ keywords: query, location: "Praha", radius: "16", page }),
        });
        const records = (response.jobs ?? [])
          .map(toDiscovery)
          .filter((record): record is DiscoveryRecord => record !== null);
        batchNumber += 1;
        yield { records, page: batchNumber };
        if (records.length === 0) break;
      }
    }
  },

  async hydrate(record): Promise<NormalizedJob> {
    return {
      title: record.title,
      company: record.company ?? null,
      location: record.location ?? null,
      remoteMode: inferRemoteMode(`${record.location ?? ""} ${record.snippet ?? ""}`),
      description: record.snippet ?? null,
      canonicalUrl: record.url,
      publishedAt: parseDate(record.publishedAt),
    };
  },

  async checkActive() {
    return true;
  },
};
