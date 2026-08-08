create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  company_key text not null unique check (length(btrim(company_key)) between 1 and 120),
  company_name text not null,
  monitored_company_id uuid references public.monitored_companies(id) on delete set null,
  website_url text check (website_url is null or website_url ~ '^https://[^[:space:]]+$'),
  careers_url_guess text check (careers_url_guess is null or careers_url_guess ~ '^https://[^[:space:]]+$'),
  summary text,
  industry text,
  product text,
  business_model text,
  customer_profile text,
  size_hint text,
  hq_location text,
  source_urls jsonb not null default '[]'::jsonb,
  credits_used integer not null default 0 check (credits_used >= 0),
  enriched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_profiles_monitored_company_id_idx
  on public.company_profiles(monitored_company_id)
  where monitored_company_id is not null;

create index company_profiles_enriched_at_idx
  on public.company_profiles(enriched_at desc);

create trigger company_profiles_set_updated_at
before update on public.company_profiles
for each row execute function public.set_updated_at();

alter table public.company_profiles enable row level security;

-- Profiles are written exclusively by the enrich-company edge function via
-- service_role. Allowlisted users only read them.
revoke all on table public.company_profiles from anon, authenticated;
grant select on table public.company_profiles to authenticated;
grant all on table public.company_profiles to service_role;

create policy "Allowlisted users can read company profiles"
on public.company_profiles for select
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);
