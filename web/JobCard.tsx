import { CompanyPanel } from "./CompanyPanel";
import type { CompanyProfileRow, ReviewJob, ReviewState } from "./types";
import { reviewFor } from "./types";

type Props = {
  job: ReviewJob;
  busy: boolean;
  profile: CompanyProfileRow | undefined;
  monitored: boolean;
  profileBusy: boolean;
  onReview: (jobId: string, state: ReviewState) => Promise<void>;
  onEnrich: (company: string, refresh: boolean) => Promise<void>;
  onWatch: (profile: CompanyProfileRow) => Promise<void>;
};

const tierLabel = { strong: "Silná shoda", adjacent: "Blízká role", explore: "K prozkoumání" };
const sourceLabel = {
  startupjobs: "StartupJobs",
  jooble: "Jooble",
  jobs_cz: "Jobs.cz",
  datacruit: "Datacruit",
  company_careers: "Career page",
};

function dateLabel(value: string | null): string {
  if (!value) return "Datum neuvedeno";
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
}

function ruleLabel(rule: string): string {
  return rule.replaceAll("_", " ");
}

export function JobCard({
  job,
  busy,
  profile,
  monitored,
  profileBusy,
  onReview,
  onEnrich,
  onWatch,
}: Props) {
  const review = reviewFor(job);
  return (
    <article className={`job-card tier-${job.relevance_tier}`}>
      <div className="job-meta-row">
        <span className="tier-pill">{tierLabel[job.relevance_tier]}</span>
        <span>{dateLabel(job.published_at ?? job.first_seen_at)}</span>
        {job.instant_alert_sent_at && <span className="alert-pill">Telegram alert</span>}
      </div>

      <div className="job-heading">
        <div>
          <h2>{job.title}</h2>
          <p className="company">{job.company ?? "Firma neuvedena"}</p>
        </div>
        <a className="open-link" href={job.canonical_url} target="_blank" rel="noreferrer">
          Otevřít ↗
        </a>
      </div>

      <p className="location">
        {job.location ?? "Lokalita se ověřuje"}
        {job.remote_mode !== "unknown" && ` · ${job.remote_mode}`}
      </p>

      <CompanyPanel
        company={job.company}
        profile={profile}
        monitored={monitored}
        busy={profileBusy}
        onEnrich={(refresh) => {
          if (job.company) void onEnrich(job.company, refresh);
        }}
        onWatch={() => {
          if (profile) void onWatch(profile);
        }}
      />

      <div className="tags">
        {job.matched_rules.map((rule) => (
          <span key={rule}>{ruleLabel(rule)}</span>
        ))}
        {job.negative_rules.map((rule) => (
          <span className="warning-tag" key={rule}>
            {ruleLabel(rule)}
          </span>
        ))}
      </div>

      <footer className="job-footer">
        <div className="source-list">
          {job.source_jobs.map((source) => (
            <a
              key={`${source.source}-${source.source_id}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {sourceLabel[source.source]}
            </a>
          ))}
        </div>
        <div className="review-actions">
          {review.state !== "interested" && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => onReview(job.id, "interested")}
            >
              Mám zájem
            </button>
          )}
          {review.state !== "skipped" && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => onReview(job.id, "skipped")}
            >
              Přeskočit
            </button>
          )}
          {review.state !== "unseen" && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => onReview(job.id, "unseen")}
            >
              Vrátit zpět
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
