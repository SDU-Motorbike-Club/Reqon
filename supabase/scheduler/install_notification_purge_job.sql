-- Deployment-time operation: this file is NOT a migration.
-- Run only after 20260139000000_notifications.sql and after enabling
-- Supabase Cron / pg_cron in the target environment.
--
-- Once a day, notifications read more than 90 days ago are deleted
-- (purge_read_notifications()). Unread ones are never purged.

do $check$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed. Enable Supabase Cron explicitly, then rerun this file.';
  end if;
  if has_function_privilege('authenticated', 'public.purge_read_notifications()', 'execute')
     or has_function_privilege('anon', 'public.purge_read_notifications()', 'execute') then
    raise exception 'purge_read_notifications() is exposed to an API user; refusing to schedule it';
  end if;
end
$check$;

-- A stable name makes a rerun an update, not a second job.
select cron.schedule(
  'paddock-control-purge-read-notifications',
  '41 3 * * *',
  $job$select public.purge_read_notifications();$job$
);

-- Installation evidence: one active job, its owner, cadence and exact command.
select jobid, jobname, schedule, command, database, username, active
  from cron.job
 where jobname = 'paddock-control-purge-read-notifications';
