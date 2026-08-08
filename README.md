# Sofhunter

Small personal job monitor for Prague-based customer success, onboarding, implementation and adjacent roles.

It discovers public job listings, applies transparent deterministic rules, stores the results in Supabase and provides a private review queue. Strict high-fit jobs trigger an immediate Telegram alert; a compact digest is sent every morning.

## Architecture

- `src/sources/` contains the StartupJobs, Jooble, Jobs.cz and Datacruit connectors.
- `src/crawler.ts` handles idempotent discovery, hydration, deduplication and alerts.
- `web/` is the authenticated React review queue deployed to GitHub Pages.
- `supabase/migrations/` is the only source of truth for the database schema, grants and RLS.
- `.github/workflows/` runs acquisition every two hours, a nightly full sweep, the 08:00 digest and Pages deployment.

No browser automation, Firecrawl, LinkedIn scraping, LLM scoring, CV generation or application sending is part of this pilot.

## Local setup

Prerequisites: Bun, Docker-compatible runtime for local Supabase tests, Supabase CLI and GitHub CLI.

```sh
bun install --frozen-lockfile
env -u SUPABASE_ACCESS_TOKEN supabase link --project-ref flpaxmbjkwsdnpcspntw
env -u SUPABASE_ACCESS_TOKEN supabase start
env -u SUPABASE_ACCESS_TOKEN supabase db reset
cp .env.example .env
bun run check
```

Fill `.env` locally. Never commit it. `SUPABASE_SECRET_KEY`, `JOOBLE_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are server-only.

Run safe live discovery without database writes:

```sh
bun src/cli.ts crawl --source startupjobs --dry-run --force
bun src/cli.ts crawl --source jobs_cz --dry-run --force
bun src/cli.ts crawl --source datacruit --dry-run --force
bun src/cli.ts crawl --source jooble --dry-run --force
```

Run the web app with remote Supabase Auth:

```sh
VITE_ALLOW_SIGNUP=true bun run dev
```

The signup switch is for the one-time shared-account bootstrap only. Production builds omit it.

## Shared account bootstrap

1. Temporarily enable email/password signup through the tracked Supabase Auth config and push it with the CLI.
2. Start the frontend locally with `VITE_ALLOW_SIGNUP=true` and create the shared account.
3. Use `env -u SUPABASE_ACCESS_TOKEN supabase db query` to find that user ID and insert it into `public.app_users`.
4. Disable signup in `supabase/config.toml`, push the config again and verify that a second account cannot register.

The review tables remain unreadable until the account ID exists in `app_users`.

## Deployment inputs

Repository Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `JOOBLE_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Push migrations and run database advisors only through the personal CLI context:

```sh
env -u SUPABASE_ACCESS_TOKEN supabase db push
env -u SUPABASE_ACCESS_TOKEN supabase db lint --linked --fail-on error
env -u SUPABASE_ACCESS_TOKEN supabase db advisors --linked --type all --fail-on error
```

The GitHub Pages shell is public. Data access is protected by Supabase Auth, explicit grants and RLS; the service/secret key must never be added to `VITE_*` variables.

## Operations

Every connector records a `crawl_runs` row. Three consecutive 403/429 failures pause that source rather than attempting to bypass its protection. Telegram deliveries use stable idempotency keys and retry at most three times.

After 14 days, compare source-specific unique jobs, duplicates, crawl errors, discovery freshness, `interested` decisions and useful instant alerts before expanding the system.
