export const SOURCE_NAMES = ["startupjobs", "jooble", "jobs_cz", "datacruit"] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
export type CrawlMode = "targeted" | "full";
export type RemoteMode = "remote" | "hybrid" | "onsite" | "unknown";
export type RelevanceTier = "strong" | "adjacent" | "explore" | "filtered_out";

export type DiscoveryRecord = {
  source: SourceName;
  sourceId: string;
  url: string;
  title: string;
  company?: string | null;
  location?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  rawData?: Record<string, unknown>;
};

export type NormalizedJob = {
  title: string;
  company: string | null;
  location: string | null;
  remoteMode: RemoteMode;
  description: string | null;
  canonicalUrl: string;
  publishedAt: string | null;
};

export type RelevanceResult = {
  tier: RelevanceTier;
  matchedRules: string[];
  negativeRules: string[];
  locationConfirmed: boolean;
};

export type DiscoveryBatch = {
  records: DiscoveryRecord[];
  page: number;
};

export type DiscoverContext = {
  mode: CrawlMode;
  signal?: AbortSignal;
};

export interface JobSource {
  readonly name: SourceName;
  discover(context: DiscoverContext): AsyncGenerator<DiscoveryBatch>;
  hydrate(record: DiscoveryRecord): Promise<NormalizedJob>;
  checkActive(record: DiscoveryRecord): Promise<boolean>;
}

export type CrawlStats = {
  pagesFetched: number;
  jobsDiscovered: number;
  newSourceJobs: number;
  jobsHydrated: number;
};

export type StoredJob = NormalizedJob &
  RelevanceResult & {
    id: string;
    fingerprint: string;
    firstSeenAt: string;
    instantAlertSentAt: string | null;
  };
