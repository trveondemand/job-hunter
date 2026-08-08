import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Companies } from "./Companies";
import { JobCard } from "./JobCard";
import { Login } from "./Login";
import { supabase } from "./supabase";
import type { ReviewJob, ReviewState } from "./types";
import { reviewFor } from "./types";

type Queue = "unseen" | "interested" | "skipped";
type Route = Queue | "companies";
const queues: Array<{ id: Queue; label: string }> = [
  { id: "unseen", label: "Nové" },
  { id: "interested", label: "Zajímavé" },
  { id: "skipped", label: "Přeskočené" },
];

function routeFromHash(): Route {
  const value = window.location.hash.replace(/^#\/?/, "");
  if (value === "companies") return value;
  return queues.some((queue) => queue.id === value) ? (value as Queue) : "unseen";
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [jobs, setJobs] = useState<ReviewJob[]>([]);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.location.hash = "/unseen";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const loadJobs = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const { data, error: requestError } = await supabase
      .from("jobs")
      .select(
        "id, title, company, location, remote_mode, canonical_url, published_at, relevance_tier, matched_rules, negative_rules, instant_alert_sent_at, first_seen_at, source_jobs(source, source_id, url), reviews(job_id, state, note)",
      )
      .neq("relevance_tier", "filtered_out")
      .eq("status", "active")
      .order("first_seen_at", { ascending: false });
    setLoading(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    setJobs((data ?? []) as ReviewJob[]);
  }, [session]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const counts = useMemo(
    () =>
      jobs.reduce(
        (result, job) => {
          result[reviewFor(job).state] += 1;
          return result;
        },
        { unseen: 0, interested: 0, skipped: 0 },
      ),
    [jobs],
  );
  const visibleJobs =
    route === "companies" ? [] : jobs.filter((job) => reviewFor(job).state === route);

  async function updateReview(jobId: string, state: ReviewState) {
    setBusyJob(jobId);
    const { error: updateError } = await supabase
      .from("reviews")
      .update({ state })
      .eq("job_id", jobId);
    setBusyJob(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) return job;
        return { ...job, reviews: { ...reviewFor(job), state } };
      }),
    );
  }

  if (!authReady) return <main className="center-state">Načítám Sofhunter…</main>;
  if (!session) return <Login />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Sofia's job radar</p>
          <h1>Sofhunter</h1>
        </div>
        <button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>
          Odhlásit
        </button>
      </header>

      <nav className="queue-tabs" aria-label="Sekce aplikace">
        {queues.map((item) => (
          <a className={route === item.id ? "active" : ""} href={`#/${item.id}`} key={item.id}>
            {item.label} <span>{counts[item.id]}</span>
          </a>
        ))}
        <a className={route === "companies" ? "active" : ""} href="#/companies">
          Firmy
        </a>
      </nav>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={loadJobs}>
            Zkusit znovu
          </button>
        </div>
      )}

      {route === "companies" ? (
        <Companies />
      ) : (
        <main className="jobs-list">
          {loading ? (
            <p className="empty-state">Načítám nabídky…</p>
          ) : visibleJobs.length === 0 ? (
            <section className="empty-state">
              <span>✓</span>
              <h2>{route === "unseen" ? "Fronta je čistá" : "Tady zatím nic není"}</h2>
              <p>Další crawler přidá nové nabídky automaticky.</p>
            </section>
          ) : (
            visibleJobs.map((job) => (
              <JobCard job={job} busy={busyJob === job.id} onReview={updateReview} key={job.id} />
            ))
          )}
        </main>
      )}
    </div>
  );
}
