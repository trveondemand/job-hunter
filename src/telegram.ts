import { APP_URL } from "./config";
import { assertNoError, db, markInstantAlertSent } from "./db";
import type { StoredJob } from "./types";

type TelegramResponse = {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
};

function credentials() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required");
  return { token, chatId };
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function sendMessage(text: string): Promise<string> {
  const { token, chatId } = credentials();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as TelegramResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return String(payload.result?.message_id ?? "");
}

async function deliver(
  key: string,
  type: "instant" | "daily",
  text: string,
  jobId: string | null,
): Promise<boolean> {
  const { data: existing, error: existingError } = await db()
    .from("notification_deliveries")
    .select("id, status, attempts")
    .eq("idempotency_key", key)
    .maybeSingle();
  assertNoError(existingError, "Read notification delivery");
  if (existing?.status === "completed") return false;

  const attempts = Number(existing?.attempts ?? 0) + 1;
  const { data: delivery, error: upsertError } = await db()
    .from("notification_deliveries")
    .upsert(
      {
        id: existing?.id,
        job_id: jobId,
        delivery_type: type,
        idempotency_key: key,
        status: "pending",
        payload: { text },
        attempts,
        error: null,
      },
      { onConflict: "idempotency_key" },
    )
    .select("id")
    .single();
  assertNoError(upsertError, "Prepare notification delivery");
  if (!delivery) throw new Error("Prepare notification delivery: query returned no data");

  try {
    const messageId = await sendMessage(text);
    const deliveredAt = new Date().toISOString();
    const { error } = await db()
      .from("notification_deliveries")
      .update({
        status: "completed",
        telegram_message_id: messageId,
        delivered_at: deliveredAt,
        error: null,
      })
      .eq("id", delivery.id);
    assertNoError(error, "Complete notification delivery");
    if (jobId && type === "instant") await markInstantAlertSent(jobId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: updateError } = await db()
      .from("notification_deliveries")
      .update({ status: "failed", error: message.slice(0, 1_000) })
      .eq("id", delivery.id);
    assertNoError(updateError, "Fail notification delivery");
    console.error(`Telegram delivery ${key} failed: ${message}`);
    return false;
  }
}

export function instantMessage(job: StoredJob, source: string): string {
  const company = job.company ? `\n<b>${escapeHtml(job.company)}</b>` : "";
  const location = job.location ? `\n📍 ${escapeHtml(job.location)}` : "";
  const rules = job.matchedRules.map(escapeHtml).join(", ");
  return [
    "🚨 <b>Nový high-fit job</b>",
    `<b>${escapeHtml(job.title)}</b>${company}${location}`,
    `Fit: ${rules}`,
    `Zdroj: ${escapeHtml(source)}`,
    `<a href="${escapeHtml(job.canonicalUrl)}">Otevřít nabídku</a> · <a href="${escapeHtml(APP_URL)}">Review fronta</a>`,
  ].join("\n\n");
}

export async function deliverInstant(job: StoredJob, source: string): Promise<boolean> {
  return deliver(`instant:${job.fingerprint}`, "instant", instantMessage(job, source), job.id);
}

export async function deliverDaily(key: string, text: string): Promise<boolean> {
  return deliver(key, "daily", text, null);
}

export async function retryFailedInstantDeliveries(): Promise<number> {
  const { data, error } = await db()
    .from("notification_deliveries")
    .select("id, idempotency_key, job_id, payload, attempts")
    .eq("delivery_type", "instant")
    .in("status", ["pending", "failed"])
    .lt("attempts", 3)
    .order("updated_at", { ascending: true })
    .limit(20);
  assertNoError(error, "Read failed instant deliveries");
  let delivered = 0;
  for (const row of data ?? []) {
    const payload = row.payload as { text?: string };
    if (!payload.text) continue;
    if (
      await deliver(
        String(row.idempotency_key),
        "instant",
        payload.text,
        row.job_id as string | null,
      )
    ) {
      delivered += 1;
    }
  }
  return delivered;
}
