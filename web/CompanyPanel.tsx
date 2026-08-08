import type { CompanyProfileRow } from "./types";

type Props = {
  company: string | null;
  profile: CompanyProfileRow | undefined;
  monitored: boolean;
  busy: boolean;
  onEnrich: (refresh: boolean) => void;
  onWatch: () => void;
};

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function CompanyPanel({ company, profile, monitored, busy, onEnrich, onWatch }: Props) {
  if (!company) return null;

  if (!profile) {
    return (
      <div className="company-panel">
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => onEnrich(false)}
        >
          {busy ? "Zjišťuji…" : "Prozkoumat firmu"}
        </button>
      </div>
    );
  }

  const facts: Array<[string, string | null]> = [
    ["Obor", profile.industry],
    ["Produkt", profile.product],
    ["Model", profile.business_model],
    ["Zákazníci", profile.customer_profile],
    ["Velikost", profile.size_hint],
    ["Sídlo", profile.hq_location],
  ];
  const shown = facts.filter((fact): fact is [string, string] => Boolean(fact[1]));

  return (
    <div className="company-panel filled">
      {profile.summary ? (
        <p className="company-summary">{profile.summary}</p>
      ) : (
        <p className="company-summary muted">Z webu se nepodařilo vyčíst popis firmy.</p>
      )}

      {shown.length > 0 && (
        <dl className="company-facts">
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="company-panel-actions">
        {profile.website_url && (
          <a href={profile.website_url} target="_blank" rel="noreferrer">
            {hostname(profile.website_url)} ↗
          </a>
        )}
        {profile.careers_url_guess && !monitored && (
          <button className="text-button" type="button" disabled={busy} onClick={onWatch}>
            {busy ? "Přidávám…" : "Sledovat firmu"}
          </button>
        )}
        {monitored && <span className="status-pill">Sledovaná firma</span>}
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => onEnrich(true)}
        >
          Načíst znovu
        </button>
      </div>
    </div>
  );
}
