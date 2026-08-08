import { type FormEvent, useState } from "react";
import { supabase } from "./supabase";

const allowSignup = import.meta.env.VITE_ALLOW_SIGNUP === "true";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) setMessage("Přihlášení se nepovedlo. Zkontroluj e-mail a heslo.");
  }

  async function signUp() {
    setPending(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setPending(false);
    setMessage(error ? error.message : "Účet je vytvořený. Teď ho přidej na databázový allowlist.");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Sofia's job radar</p>
        <h1>Sofhunter</h1>
        <p className="login-intro">Nové pražské role bez nekonečného procházení portálů.</p>
        <form onSubmit={submit}>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Heslo
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Přihlašuji…" : "Přihlásit se"}
          </button>
          {allowSignup && (
            <button className="text-button" type="button" onClick={signUp} disabled={pending}>
              Vytvořit první účet
            </button>
          )}
          {message && <p className="form-message">{message}</p>}
        </form>
      </section>
    </main>
  );
}
