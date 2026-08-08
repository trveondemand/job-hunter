import type { CareerAdapter, RelevanceTier, RemoteMode, SourceName } from "../src/types";

export type MonitoredCompanyRow = {
  id: string;
  name: string;
  careers_url: string;
  enabled: boolean;
  detected_adapter: CareerAdapter | null;
  adapter_key: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

export type CompanyProfileRow = {
  id: string;
  company_key: string;
  company_name: string;
  website_url: string | null;
  careers_url_guess: string | null;
  summary: string | null;
  industry: string | null;
  product: string | null;
  business_model: string | null;
  customer_profile: string | null;
  size_hint: string | null;
  hq_location: string | null;
  enriched_at: string;
};

export const COMPANY_PROFILE_COLUMNS =
  "id, company_key, company_name, website_url, careers_url_guess, summary, industry, product, business_model, customer_profile, size_hint, hq_location, enriched_at";

export type ReviewState = "unseen" | "interested" | "skipped";

export type Review = {
  job_id: string;
  state: ReviewState;
  note: string | null;
};

export type SourceJob = {
  source: SourceName;
  source_id: string;
  url: string;
};

export type ReviewJob = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  remote_mode: RemoteMode;
  canonical_url: string;
  published_at: string | null;
  relevance_tier: Exclude<RelevanceTier, "filtered_out">;
  matched_rules: string[];
  negative_rules: string[];
  instant_alert_sent_at: string | null;
  first_seen_at: string;
  source_jobs: SourceJob[];
  reviews: Review | Review[] | null;
};

export function reviewFor(job: ReviewJob): Review {
  const review = Array.isArray(job.reviews) ? job.reviews[0] : job.reviews;
  return review ?? { job_id: job.id, state: "unseen", note: null };
}
