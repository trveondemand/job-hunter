alter table public.source_configs
  drop constraint source_configs_source_check;
alter table public.source_configs
  add constraint source_configs_source_check
  check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit', 'company_careers'));

alter table public.crawl_runs
  drop constraint crawl_runs_source_check;
alter table public.crawl_runs
  add constraint crawl_runs_source_check
  check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit', 'company_careers'));

alter table public.source_jobs
  drop constraint source_jobs_source_check;
alter table public.source_jobs
  add constraint source_jobs_source_check
  check (source in ('startupjobs', 'jooble', 'jobs_cz', 'datacruit', 'company_careers'));

create table public.monitored_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  careers_url text not null check (careers_url ~ '^https://[^[:space:]]+$'),
  enabled boolean not null default true,
  detected_adapter text check (
    detected_adapter is null
    or detected_adapter in ('ashby', 'greenhouse', 'lever', 'generic')
  ),
  adapter_key text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index monitored_companies_careers_url_key
  on public.monitored_companies (lower(rtrim(careers_url, '/')));

alter table public.source_jobs
  add column company_id uuid references public.monitored_companies(id) on delete set null;
create index source_jobs_company_id_idx
  on public.source_jobs(company_id, last_seen_at desc)
  where company_id is not null;

create trigger monitored_companies_set_updated_at
before update on public.monitored_companies
for each row execute function public.set_updated_at();

insert into public.source_configs (source, interval_minutes)
values ('company_careers', 1440)
on conflict (source) do update
set interval_minutes = excluded.interval_minutes;

insert into public.monitored_companies (name, careers_url)
values
  ('Apify', 'https://apify.com/jobs'),
  ('GoodData', 'https://www.gooddata.ai/company/careers/'),
  ('Mews', 'https://www.mews.com/en/careers'),
  ('Productboard', 'https://www.productboard.com/careers/open-positions/'),
  ('Keboola', 'https://www.keboola.com/about/jobs'),
  ('Make', 'https://www.make.com/en/careers'),
  ('Sloneek', 'https://www.sloneek.com/open-positions/'),
  ('Keyloop', 'https://jobs.lever.co/keyloop'),
  ('Rossum', 'https://rossum.ai/careers/'),
  ('Resistant AI', 'https://resistant.ai/career/'),
  ('Better Stack', 'https://betterstack.com/careers'),
  ('ShipMonk', 'https://www.shipmonk.com/resources/careers'),
  ('Rohlik Group', 'https://career.rohlik.group/group'),
  ('DODO', 'https://www.pracujvdodo.cz/volne-pozice/'),
  ('Shoptet', 'https://kariera.shoptet.cz/'),
  ('Disivo', 'https://www.disivo.cz/careers/'),
  ('Similarweb', 'https://job-boards.greenhouse.io/similarweb'),
  ('Kontent.ai', 'https://kontent.ai/careers/'),
  ('JetBrains', 'https://www.jetbrains.com/careers/jobs/'),
  ('Dataddo', 'https://www.dataddo.com/careers')
on conflict do nothing;

alter table public.monitored_companies enable row level security;

revoke all on table public.monitored_companies from anon, authenticated;
grant select on table public.monitored_companies to authenticated;
grant insert (name, careers_url, enabled) on table public.monitored_companies to authenticated;
grant update (name, careers_url, enabled) on table public.monitored_companies to authenticated;
grant delete on table public.monitored_companies to authenticated;
grant all on table public.monitored_companies to service_role;

create policy "Allowlisted users can read monitored companies"
on public.monitored_companies for select
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);

create policy "Allowlisted users can add monitored companies"
on public.monitored_companies for insert
to authenticated
with check (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);

create policy "Allowlisted users can update monitored companies"
on public.monitored_companies for update
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

create policy "Allowlisted users can delete monitored companies"
on public.monitored_companies for delete
to authenticated
using (
  exists (
    select 1 from public.app_users
    where app_users.user_id = (select auth.uid())
  )
);
