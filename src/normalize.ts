export function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Job boards publish legal entity names ("MEWS SYSTEMS S.R.O.") while the
// monitored company list uses brand names ("Mews"), so company profiles are
// keyed on the name with the legal form removed.
const legalForms = /\b(spol s r o|s r o|a s|k s|v o s|gmbh|limited|ltd|inc|llc|plc|b v|n v)\b/g;

export function companyKey(value: string | null | undefined): string {
  return normalize(value).replace(legalForms, " ").replace(/\s+/g, " ").trim();
}
