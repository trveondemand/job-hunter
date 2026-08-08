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
