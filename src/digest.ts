import { APP_URL } from "./config";
import { assertNoError, db } from "./db";
import { deliverDaily } from "./telegram";
import type { RelevanceTier } from "./types";

const tierOrder: Record<RelevanceTier, number> = {
  strong: 0,
  adjacent: 1,
  explore: 2,
  filtered_out: 3,
};

function pragueDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function buildAndDeliverDigest(dryRun = false): Promise<string> {
  const key = `daily:${pragueDate()}`;
  const { data: lastDigest, error: digestError } = await db()
    .from("notification_deliveries")
    .select("delivered_at")
    .eq("delivery_type", "daily")
    .eq("status", "completed")
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError(digestError, "Read previous digest");

  const since =
    (lastDigest?.delivered_at as string | null) ??
    new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const { data: jobs, error: jobsError } = await db()
    .from("jobs")
    .select("id, title, company, location, relevance_tier, canonical_url, first_seen_at")
    .neq("relevance_tier", "filtered_out")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false });
  assertNoError(jobsError, "Read jobs for digest");

  const { count: unseen, error: unseenError } = await db()
    .from("reviews")
    .select("job_id, jobs!inner(relevance_tier)", { count: "exact", head: true })
    .eq("state", "unseen")
    .neq("jobs.relevance_tier", "filtered_out");
  assertNoError(unseenError, "Count unseen reviews");

  const counts = { strong: 0, adjacent: 0, explore: 0 };
  for (const job of jobs ?? []) counts[job.relevance_tier as keyof typeof counts] += 1;
  const topJobs = [...(jobs ?? [])]
    .sort((a, b) => {
      const tier =
        tierOrder[a.relevance_tier as RelevanceTier] - tierOrder[b.relevance_tier as RelevanceTier];
      return tier || new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
    })
    .slice(0, 10);

  const lines = [
    `☀️ <b>Sofhunter · ${pragueDate()}</b>`,
    `Nové: <b>${counts.strong}</b> strong · ${counts.adjacent} adjacent · ${counts.explore} explore`,
  ];
  if (topJobs.length === 0) {
    lines.push("Dnes zatím nic nového. Monitoring běží.");
  } else {
    lines.push(
      topJobs
        .map((job, index) => {
          const company = job.company ? ` · ${escapeHtml(String(job.company))}` : "";
          return `${index + 1}. <a href="${escapeHtml(String(job.canonical_url))}">${escapeHtml(String(job.title))}</a>${company}`;
        })
        .join("\n"),
    );
  }
  lines.push(
    `Čeká na review: <b>${unseen ?? 0}</b>`,
    `<a href="${escapeHtml(APP_URL)}">Otevřít review frontu</a>`,
  );
  const text = lines.join("\n\n");

  if (dryRun) {
    console.log(text);
    return text;
  }
  await deliverDaily(key, text);
  return text;
}
