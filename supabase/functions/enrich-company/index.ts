import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { companyKey } from "../_shared/company.ts";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const DAILY_LIMIT = Number(Deno.env.get("ENRICH_DAILY_LIMIT") ?? 25);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Everything is optional: an unfilled field is better than a hallucinated one,
// and Firecrawl only fills what it actually found on the page.
const profileSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Dvě až tři věty česky o tom, čím se firma zabývá.",
    },
    industry: { type: "string", description: "Obor, česky, pár slov." },
    product: { type: "string", description: "Hlavní produkt nebo služba, česky, jedna věta." },
    business_model: {
      type: "string",
      description: "Jedno z: b2b, b2c, b2b2c, marketplace, agentura, jiné.",
    },
    customer_profile: { type: "string", description: "Kdo jsou typičtí zákazníci, česky." },
    size_hint: {
      type: "string",
      description: "Počet zaměstnanců, pouze pokud je na stránce uveden.",
    },
    hq_location: { type: "string", description: "Město a země sídla, pokud jsou uvedeny." },
  },
} as const;

type ExtractedProfile = {
  summary?: string;
  industry?: string;
  product?: string;
  business_model?: string;
  customer_profile?: string;
  size_hint?: string;
  hq_location?: string;
};

type MonitoredMatch = { id: string; careers_url: string };

async function firecrawl<T>(path: string, body: unknown, key: string): Promise<T> {
  const response = await fetch(`${FIRECRAWL_BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`Firecrawl ${path} vrátil HTTP ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

const aggregatorHosts =
  /(^|\.)(linkedin|facebook|twitter|x|instagram|crunchbase|glassdoor|indeed|jobs\.cz|startupjobs|jooble|wikipedia|youtube|github)\./i;

async function findWebsite(
  name: string,
  key: string,
): Promise<{ url: string | null; credits: number }> {
  const result = await firecrawl<{
    data?: { web?: Array<{ url?: string }> };
    creditsUsed?: number;
  }>("/search", { query: `${name} oficiální web firmy`, limit: 10, country: "CZ" }, key);
  const credits = result.creditsUsed ?? 2;
  for (const item of result.data?.web ?? []) {
    const origin = item.url ? httpsOrigin(item.url) : null;
    if (origin && !aggregatorHosts.test(new URL(origin).hostname)) return { url: origin, credits };
  }
  return { url: null, credits };
}

const careersPath =
  /\/(careers?|jobs?|kariera|kariéra|volna-mista|volne-pozice|pozice|join-us|work-with-us|prace)(\/|$)/i;
const aboutPath = /\/(about|about-us|company|o-nas|o-firme|kdo-jsme)(\/|$)/i;

async function mapSite(
  website: string,
  key: string,
): Promise<{ careers: string | null; about: string | null }> {
  const result = await firecrawl<{ links?: Array<{ url?: string }> }>(
    "/map",
    { url: website, search: "careers jobs about company kariera o nas", limit: 200 },
    key,
  );
  let careers: string | null = null;
  let about: string | null = null;
  for (const { url } of result.links ?? []) {
    if (!url?.startsWith("https://")) continue;
    const path = new URL(url).pathname;
    if (!careers && careersPath.test(path)) careers = url;
    if (!about && aboutPath.test(path)) about = url;
    if (careers && about) break;
  }
  return { careers, about };
}

async function extractProfile(
  url: string,
  key: string,
): Promise<{ profile: ExtractedProfile; credits: number }> {
  const result = await firecrawl<{
    data?: { json?: ExtractedProfile };
    creditsUsed?: number;
  }>(
    "/scrape",
    {
      url,
      onlyMainContent: true,
      formats: [
        {
          type: "json",
          schema: profileSchema,
          prompt:
            "Popiš firmu, které patří tento web, pro uchazečku o pozici v customer success / onboardingu / projektovém řízení. Odpovídej česky a věcně. Pole, jehož hodnotu na stránce nenajdeš, vynech.",
        },
      ],
    },
    key,
  );
  return { profile: result.data?.json ?? {}, credits: result.creditsUsed ?? 0 };
}

async function findMonitoredCompany(
  admin: SupabaseClient,
  key: string,
): Promise<MonitoredMatch | null> {
  const { data } = await admin.from("monitored_companies").select("id, name, careers_url");
  for (const row of (data ?? []) as Array<MonitoredMatch & { name: string }>) {
    if (companyKey(row.name) === key) return { id: row.id, careers_url: row.careers_url };
  }
  return null;
}

// Asking for missing fields to be omitted is not enough: the extractor likes
// to answer "Není uvedeno." instead. An empty field reads better than that.
const notStated =
  /nen[íi] uveden|neuveden|nezji[šs]t[ěe]n|nen[íi] k dispozici|not (specified|stated|available|mentioned|provided)|^(unknown|nezn[áa]m[éo]|n\/a|-|—)$/i;

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/\s+/g, " ").trim();
  if (!result) return null;
  if (result.length < 80 && notStated.test(result)) return null;
  return result.slice(0, 600);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Použij POST." });

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) return json(500, { error: "FIRECRAWL_API_KEY není nastavený." });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await admin.auth.getUser(token);
  if (!userData?.user) return json(401, { error: "Přihlaš se prosím znovu." });
  const { data: allowed } = await admin
    .from("app_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!allowed) return json(403, { error: "Tento účet nemá přístup." });

  const body = (await request.json().catch(() => null)) as {
    company?: unknown;
    refresh?: unknown;
  } | null;
  const name = typeof body?.company === "string" ? body.company.trim() : "";
  const key = companyKey(name);
  if (!name || !key) return json(400, { error: "Chybí název firmy." });

  const { data: cached } = await admin
    .from("company_profiles")
    .select("*")
    .eq("company_key", key)
    .maybeSingle();
  if (cached && body?.refresh !== true) return json(200, { profile: cached, cached: true });

  const { count } = await admin
    .from("company_profiles")
    .select("id", { count: "exact", head: true })
    .gte("enriched_at", new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) {
    return json(429, { error: `Denní limit ${DAILY_LIMIT} firem je vyčerpaný, zkus to zítra.` });
  }

  try {
    const monitored = await findMonitoredCompany(admin, key);
    let credits = 0;
    let website = monitored ? httpsOrigin(monitored.careers_url) : null;
    if (!website) {
      const found = await findWebsite(name, firecrawlKey);
      credits += found.credits;
      website = found.url;
    }
    if (!website) return json(404, { error: `Web firmy ${name} se nepodařilo dohledat.` });

    const links = await mapSite(website, firecrawlKey);
    credits += 1;

    const sourceUrls = [website];
    let extracted = await extractProfile(website, firecrawlKey);
    credits += extracted.credits;
    // Single-page marketing sites often say nothing useful on the homepage;
    // the about page is the cheapest second guess.
    if (!extracted.profile.summary && links.about) {
      const fallback = await extractProfile(links.about, firecrawlKey);
      credits += fallback.credits;
      if (fallback.profile.summary) {
        extracted = { profile: { ...extracted.profile, ...fallback.profile }, credits: 0 };
        sourceUrls.push(links.about);
      }
    }

    const row = {
      company_key: key,
      company_name: name.slice(0, 120),
      monitored_company_id: monitored?.id ?? null,
      website_url: website,
      careers_url_guess: monitored ? monitored.careers_url : links.careers,
      summary: trimmed(extracted.profile.summary),
      industry: trimmed(extracted.profile.industry),
      product: trimmed(extracted.profile.product),
      business_model: trimmed(extracted.profile.business_model),
      customer_profile: trimmed(extracted.profile.customer_profile),
      size_hint: trimmed(extracted.profile.size_hint),
      hq_location: trimmed(extracted.profile.hq_location),
      source_urls: sourceUrls,
      credits_used: credits,
      enriched_at: new Date().toISOString(),
    };

    const { data: saved, error } = await admin
      .from("company_profiles")
      .upsert(row, { onConflict: "company_key" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return json(200, { profile: saved, cached: false });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return json(502, { error: message.slice(0, 500) });
  }
});
