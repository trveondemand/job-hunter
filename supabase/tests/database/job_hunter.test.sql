begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table('public', 'jobs', 'jobs table exists');
select has_table('public', 'source_jobs', 'source_jobs table exists');
select has_table('public', 'reviews', 'reviews table exists');
select has_table('public', 'notification_deliveries', 'delivery ledger exists');
select has_table('public', 'monitored_companies', 'monitored companies table exists');
select has_column('public', 'source_jobs', 'company_id', 'source jobs identify their company');
select has_fk('public', 'source_jobs', 'source jobs company reference is enforced');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.jobs'::regclass),
  'jobs has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reviews'::regclass),
  'reviews has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.monitored_companies'::regclass),
  'monitored companies has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.jobs', 'select'),
  'anonymous users have no jobs grant'
);
select ok(
  has_table_privilege('authenticated', 'public.jobs', 'select'),
  'authenticated users receive the explicit jobs grant'
);
select ok(
  not has_table_privilege('anon', 'public.monitored_companies', 'select'),
  'anonymous users have no monitored companies grant'
);
select ok(
  has_table_privilege('authenticated', 'public.monitored_companies', 'select'),
  'authenticated users receive the explicit monitored companies grant'
);
select results_eq(
  $$select count(*) from public.source_configs where source <> 'company_careers' and interval_minutes <> 120$$,
  $$values (0::bigint)$$,
  'market acquisition sources use the two-hour interval'
);
select results_eq(
  $$select interval_minutes from public.source_configs where source = 'company_careers'$$,
  $$values (1440)$$,
  'company career pages use the daily interval'
);
select results_eq(
  $$select count(*) from public.monitored_companies$$,
  $$values (20::bigint)$$,
  'the initial curated company list contains exactly twenty entries'
);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'allowed-test@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'blocked-test@example.invalid');

insert into public.app_users (user_id)
values ('10000000-0000-0000-0000-000000000001');

insert into public.jobs (
  id,
  fingerprint,
  title,
  canonical_url,
  relevance_tier
)
values (
  '20000000-0000-0000-0000-000000000001',
  'pgtap-job-fingerprint',
  'Customer Success Manager',
  'https://example.invalid/jobs/1',
  'strong'
);

insert into public.reviews (job_id)
values ('20000000-0000-0000-0000-000000000001');

insert into public.company_profiles (company_key, company_name)
values ('pgtap company', 'Pgtap Company s.r.o.');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$select count(*) from public.jobs where id = '20000000-0000-0000-0000-000000000001'$$,
  $$values (0::bigint)$$,
  'a non-allowlisted authenticated user cannot read jobs'
);
select results_eq(
  $$update public.reviews set state = 'interested' where job_id = '20000000-0000-0000-0000-000000000001' returning 1$$,
  $$select 1 where false$$,
  'a non-allowlisted authenticated user cannot update reviews'
);
select results_eq(
  $$select count(*) from public.monitored_companies$$,
  $$values (0::bigint)$$,
  'a non-allowlisted authenticated user cannot read monitored companies'
);
select throws_ok(
  $$insert into public.monitored_companies (name, careers_url) values ('Blocked test', 'https://blocked.example.invalid/careers')$$,
  '42501',
  null,
  'a non-allowlisted authenticated user cannot add monitored companies'
);
select results_eq(
  $$select count(*) from public.company_profiles$$,
  $$values (0::bigint)$$,
  'a non-allowlisted authenticated user cannot read company profiles'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select count(*) from public.jobs where id = '20000000-0000-0000-0000-000000000001'$$,
  $$values (1::bigint)$$,
  'the allowlisted authenticated user can read jobs'
);
select results_eq(
  $$update public.reviews set state = 'interested' where job_id = '20000000-0000-0000-0000-000000000001' returning state$$,
  $$values ('interested'::text)$$,
  'the allowlisted authenticated user can update review state'
);
select results_eq(
  $$select count(*) from public.monitored_companies$$,
  $$values (20::bigint)$$,
  'the allowlisted authenticated user can read monitored companies'
);
select lives_ok(
  $$insert into public.monitored_companies (name, careers_url) values ('Policy test', 'https://policy.example.invalid/careers')$$,
  'the allowlisted authenticated user can add monitored companies'
);
select results_eq(
  $$update public.monitored_companies set enabled = false where name = 'Policy test' returning enabled$$,
  $$values (false)$$,
  'the allowlisted authenticated user can update monitored companies'
);
select lives_ok(
  $$delete from public.monitored_companies where name = 'Policy test'$$,
  'the allowlisted authenticated user can delete monitored companies'
);
select results_eq(
  $$select count(*) from public.company_profiles$$,
  $$values (1::bigint)$$,
  'the allowlisted authenticated user can read company profiles'
);
select throws_ok(
  $$insert into public.company_profiles (company_key, company_name) values ('blocked', 'Blocked')$$,
  '42501',
  null,
  'company profiles are written only by the enrich-company function'
);

reset role;

insert into public.notification_deliveries (
  delivery_type,
  idempotency_key
)
values ('daily', 'pgtap:daily:2026-08-08');

select throws_ok(
  $$insert into public.notification_deliveries (delivery_type, idempotency_key) values ('daily', 'pgtap:daily:2026-08-08')$$,
  '23505',
  null,
  'delivery idempotency keys cannot be duplicated'
);

select throws_ok(
  $$update public.reviews set state = 'not-a-state' where job_id = '20000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'review state check constraint rejects unknown states'
);

select * from finish();
rollback;
