# Project Guidelines

This is a small hobby project whose ultimate goal is to help the owner's girlfriend find a job.

## Core principles

- Keep the project simple. It is not a commercial product, so prefer the smallest implementation that works over elaborate architecture, abstractions, or infrastructure.
- Use Supabase for the backend and data layer.
- A small frontend may be published on GitHub Pages later.
- Always interact with Supabase through the Supabase CLI. Do not use Supabase plugins, MCP servers, connectors, dashboard automation, or similar integrations.
- Always run Supabase CLI commands with `env -u SUPABASE_ACCESS_TOKEN supabase ...` so this repository uses the locally authenticated personal Supabase account instead of any inherited work access token.
- Always interact with GitHub through the GitHub CLI (`gh`). Do not use GitHub plugins, MCP servers, connectors, or similar integrations.
- Before using a Supabase or GitHub CLI command, inspect the relevant CLI help when the command or flags are not already established in this repository.

## No local Supabase stack

There is no Docker on this machine, so the whole local Supabase stack is unavailable. Do not try to start it, and do not suggest installing Docker.

- Never run `supabase start`, `supabase stop`, `supabase db reset`, `supabase functions serve`, or any command with `--local`. They will fail.
- `bun run test:db` (`supabase test db --local`) therefore cannot run here. Database policy tests still live in `supabase/tests/database` and are meant to be reviewed by reading them.
- Generate types against the remote project instead: `env -u SUPABASE_ACCESS_TOKEN supabase gen types typescript --linked > src/database.types.ts`. This only reflects migrations that have already been pushed, so after adding a migration either push it first or hand-edit `src/database.types.ts` to match, keeping the generator's alphabetical table order and `Row`/`Insert`/`Update`/`Relationships` shape.
- Applying a migration means `supabase db push` against production. Ask the owner before running it.

## Edge functions

`supabase/functions` is Deno, not Bun. It is excluded from `tsconfig.json`, so `bun run typecheck` does not cover it; Biome still formats and lints it.

- Only files inside `supabase/functions` are bundled on deploy. Code shared with `src/` has to be duplicated under `supabase/functions/_shared` and pinned by a test (see `tests/companyKey.test.ts`).
- Deploy: `env -u SUPABASE_ACCESS_TOKEN supabase functions deploy <name>`. Secrets: `env -u SUPABASE_ACCESS_TOKEN supabase secrets set KEY=value`.
- Functions are called from GitHub Pages, so they must answer `OPTIONS` with CORS headers.
