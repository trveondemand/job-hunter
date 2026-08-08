import { type FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { MonitoredCompanyRow } from "./types";

type FormState = {
  id: string | null;
  name: string;
  careersUrl: string;
  enabled: boolean;
};

const emptyForm = (): FormState => ({ id: null, name: "", careersUrl: "", enabled: true });

function normalizedUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("Career URL musí používat HTTPS.");
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Career URL obsahuje nepovolené přihlašovací údaje nebo port.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function formatDate(value: string | null): string {
  if (!value) return "zatím neproběhlo";
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function Companies() {
  const [companies, setCompanies] = useState<MonitoredCompanyRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: requestError } = await supabase
      .from("monitored_companies")
      .select(
        "id, name, careers_url, enabled, detected_adapter, adapter_key, last_checked_at, last_success_at, consecutive_failures, last_error",
      )
      .order("name");
    setLoading(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    setCompanies((data ?? []) as MonitoredCompanyRow[]);
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    setBusy(form.id ?? "new");
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        careers_url: normalizedUrl(form.careersUrl),
        enabled: form.enabled,
      };
      const result = form.id
        ? await supabase.from("monitored_companies").update(payload).eq("id", form.id)
        : await supabase.from("monitored_companies").insert(payload);
      if (result.error) throw result.error;
      setForm(emptyForm());
      await loadCompanies();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function toggleCompany(company: MonitoredCompanyRow) {
    setBusy(company.id);
    setError(null);
    const { error: requestError } = await supabase
      .from("monitored_companies")
      .update({ enabled: !company.enabled })
      .eq("id", company.id);
    setBusy(null);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    await loadCompanies();
  }

  async function deleteCompany(company: MonitoredCompanyRow) {
    if (!window.confirm(`Opravdu přestat sledovat ${company.name}?`)) return;
    setBusy(company.id);
    setError(null);
    const { error: requestError } = await supabase
      .from("monitored_companies")
      .delete()
      .eq("id", company.id);
    setBusy(null);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    if (form.id === company.id) setForm(emptyForm());
    await loadCompanies();
  }

  return (
    <main className="companies-page">
      <section className="company-form-card">
        <div>
          <p className="eyebrow">Denní monitoring</p>
          <h2>{form.id ? "Upravit firmu" : "Přidat career page"}</h2>
        </div>
        <form onSubmit={saveCompany}>
          <label>
            Firma
            <input
              required
              minLength={2}
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Např. Apify"
            />
          </label>
          <label>
            Career URL
            <input
              required
              type="url"
              value={form.careersUrl}
              onChange={(event) => setForm({ ...form, careersUrl: event.target.value })}
              placeholder="https://firma.cz/careers"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Aktivní monitoring
          </label>
          <div className="form-actions">
            <button className="secondary-button" type="submit" disabled={busy !== null}>
              {form.id ? "Uložit změny" : "Přidat firmu"}
            </button>
            {form.id && (
              <button className="text-button" type="button" onClick={() => setForm(emptyForm())}>
                Zrušit
              </button>
            )}
          </div>
        </form>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={loadCompanies}>
            Zkusit znovu
          </button>
        </div>
      )}

      {loading ? (
        <p className="empty-state">Načítám firmy…</p>
      ) : (
        <section className="company-list" aria-label="Sledované firmy">
          {companies.map((company) => (
            <article
              className={`company-row ${company.enabled ? "" : "disabled"}`}
              key={company.id}
            >
              <div className="company-row-main">
                <div className="company-row-heading">
                  <h3>{company.name}</h3>
                  <span className={`status-pill ${company.last_error ? "error" : ""}`}>
                    {!company.enabled
                      ? "vypnuto"
                      : company.last_error
                        ? "chyba"
                        : (company.detected_adapter ?? "čeká na první běh")}
                  </span>
                </div>
                <a href={company.careers_url} target="_blank" rel="noreferrer">
                  {company.careers_url}
                </a>
                <p>Poslední úspěch: {formatDate(company.last_success_at)}</p>
                {company.last_error && <p className="company-error">{company.last_error}</p>}
              </div>
              <div className="company-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    setForm({
                      id: company.id,
                      name: company.name,
                      careersUrl: company.careers_url,
                      enabled: company.enabled,
                    })
                  }
                >
                  Upravit
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => toggleCompany(company)}
                >
                  {company.enabled ? "Vypnout" : "Zapnout"}
                </button>
                <button
                  className="text-button danger-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => deleteCompany(company)}
                >
                  Odstranit
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
