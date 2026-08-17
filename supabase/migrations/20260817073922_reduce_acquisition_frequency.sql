update public.source_configs
set interval_minutes = 240
where source <> 'company_careers';

update public.source_configs
set
  enabled = true,
  consecutive_failures = 0,
  paused_reason = null
where source = 'startupjobs';
