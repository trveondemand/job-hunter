begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select has_table('public', 'jobs', 'jobs table exists');
select has_table('public', 'source_jobs', 'source_jobs table exists');
select has_table('public', 'reviews', 'reviews table exists');
select has_table('public', 'notification_deliveries', 'delivery ledger exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.jobs'::regclass),
  'jobs has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reviews'::regclass),
  'reviews has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.jobs', 'select'),
  'anonymous users have no jobs grant'
);
select ok(
  has_table_privilege('authenticated', 'public.jobs', 'select'),
  'authenticated users receive the explicit jobs grant'
);
select results_eq(
  $$select count(*) from public.source_configs where interval_minutes <> 120$$,
  $$values (0::bigint)$$,
  'all acquisition sources use the two-hour interval'
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
