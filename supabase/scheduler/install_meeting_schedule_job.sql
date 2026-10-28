-- Deployment-time operation: this file is NOT a migration.
-- Run only after 20260144000000_meeting_schedule_and_attendance.sql and after enabling
-- Supabase Cron / pg_cron in the target environment. `supabase db push` alone does NOT schedule
-- anything: until this file has been run, no weekly meeting is ever created.
--
-- Once a day (05:10 UTC, about 06:10-07:10 in Copenhagen) create_scheduled_meetings() makes the
-- weekly meeting for every occurrence inside the lead time that does not exist yet and is not
-- skipped. Running it more often, or twice, creates nothing extra: it is idempotent.

do $check$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed. Enable Supabase Cron explicitly, then rerun this file.';
  end if;
  if has_function_privilege('authenticated', 'public.create_scheduled_meetings()', 'execute')
     or has_function_privilege('anon', 'public.create_scheduled_meetings()', 'execute') then
    raise exception 'create_scheduled_meetings() is exposed to an API user; refusing to schedule it';
  end if;
end
$check$;

-- A stable name makes a rerun an update, not a second job.
select cron.schedule(
  'paddock-control-create-scheduled-meetings',
  '10 5 * * *',
  $job$select public.create_scheduled_meetings();$job$
);

-- Installation evidence: one active job, its owner, cadence and exact command.
select jobid, jobname, schedule, command, database, username, active
  from cron.job
 where jobname = 'paddock-control-create-scheduled-meetings';
