create extension if not exists pgcrypto;

create table public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.source_configs (
  source text primary key check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit')),
  enabled boolean not null default true,
  interval_minutes integer not null check (interval_minutes >= 30),
  last_success_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  paused_reason text,
  updated_at timestamptz not null default now()
);

create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit')),
  mode text not null default 'targeted' check (mode in ('targeted', 'full')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_fetched integer not null default 0,
  jobs_discovered integer not null default 0,
  new_source_jobs integer not null default 0,
  jobs_hydrated integer not null default 0,
  error text
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null,
  company text,
  location text,
  remote_mode text not null default 'unknown'
    check (remote_mode in ('remote', 'hybrid', 'onsite', 'unknown')),
  description text,
  canonical_url text not null,
  published_at timestamptz,
  relevance_tier text not null
    check (relevance_tier in ('strong', 'adjacent', 'explore', 'filtered_out')),
  matched_rules text[] not null default '{}',
  negative_rules text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'closed', 'unknown')),
  instant_alert_sent_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_jobs (
  source text not null check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit')),
  source_id text not null,
  job_id uuid references public.jobs(id) on delete set null,
  url text not null,
  title text not null,
  company text,
  location text,
  snippet text,
  published_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed', 'unknown')),
  content_hash text,
  raw_data jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  primary key (source, source_id)
);

create table public.reviews (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  state text not null default 'unseen' check (state in ('unseen', 'interested', 'skipped')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  delivery_type text not null check (delivery_type in ('instant', 'daily')),
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  payload jsonb not null default '{}',
  telegram_message_id text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create index source_jobs_job_id_idx on public.source_jobs(job_id);
create index source_jobs_last_seen_idx on public.source_jobs(source, last_seen_at desc);
create index jobs_review_queue_idx on public.jobs(relevance_tier, first_seen_at desc)
  where relevance_tier <> 'filtered_out';
create index notification_deliveries_retry_idx
  on public.notification_deliveries(status, delivery_type, updated_at)
  where status <> 'completed';

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger source_configs_set_updated_at
before update on public.source_configs
for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function public.set_updated_at();

insert into public.source_configs (source, interval_minutes)
values
  ('startupjobs', 120),
  ('jooble', 240),
  ('jobs_cz', 240),
  ('datacruit', 360);

alter table public.app_users enable row level security;
alter table public.source_configs enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.jobs enable row level security;
alter table public.source_jobs enable row level security;
alter table public.reviews enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.source_configs from anon, authenticated;
revoke all on table public.crawl_runs from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.source_jobs from anon, authenticated;
revoke all on table public.reviews from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;
grant select on table public.app_users to authenticated;
grant select on table public.jobs, public.source_jobs, public.reviews to authenticated;
grant update (state, note) on table public.reviews to authenticated;
grant all on table public.app_users, public.source_configs, public.crawl_runs,
  public.jobs, public.source_jobs, public.reviews, public.notification_deliveries to service_role;

create policy "Allowlisted users can read their membership"
on public.app_users for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Allowlisted users can read jobs"
on public.jobs for select
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);

create policy "Allowlisted users can read source jobs"
on public.source_jobs for select
to authenticated
using (
  job_id is not null
  and exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);

create policy "Allowlisted users can read reviews"
on public.reviews for select
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);

create policy "Allowlisted users can update reviews"
on public.reviews for update
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);
