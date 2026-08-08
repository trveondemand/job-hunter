// Deno copy of src/normalize.ts. Edge functions only bundle files inside
// supabase/functions, so the two live apart; tests/companyKey.test.ts asserts
// they stay in sync.
export function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const legalForms = /\b(spol s r o|s r o|a s|k s|v o s|gmbh|limited|ltd|inc|llc|plc|b v|n v)\b/g;

export function companyKey(value: string | null | undefined): string {
  return normalize(value).replace(legalForms, " ").replace(/\s+/g, " ").trim();
}
