alter table public.monitored_companies
  drop constraint monitored_companies_detected_adapter_check;
alter table public.monitored_companies
  add constraint monitored_companies_detected_adapter_check
  check (
    detected_adapter is null
    or detected_adapter in ('ashby', 'greenhouse', 'lever', 'recruitee', 'teamio', 'generic')
  );
