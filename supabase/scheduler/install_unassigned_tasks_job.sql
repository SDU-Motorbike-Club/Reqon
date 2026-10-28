-- Deployment-time operation: this file is NOT a migration.
-- Run only after 20260146000000_delete_archived_task_and_unassigned_notice.sql and after enabling
-- Supabase Cron / pg_cron in the target environment. `supabase db push` alone does NOT schedule
-- anything: until this file has been run, nobody is told about tasks that have no owner.
--
-- Every Monday at 07:00 UTC (08:00-09:00 in Copenhagen) notify_unassigned_tasks(false) puts one inbox
-- item in each active President's inbox when open tasks of the current season have no owner. Anyone
-- who still has an unread one is skipped, so a quiet week does not pile up. Running it twice sends
-- nothing extra for the same unread notice.

do $check$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed. Enable Supabase Cron explicitly, then rerun this file.';
  end if;
  if has_function_privilege('authenticated', 'public.notify_unassigned_tasks(boolean)', 'execute')
     or has_function_privilege('anon', 'public.notify_unassigned_tasks(boolean)', 'execute') then
    raise exception 'notify_unassigned_tasks() is exposed to an API user; refusing to schedule it';
  end if;
end
$check$;

-- A stable name makes a rerun an update, not a second job.
select cron.schedule(
  'paddock-control-notify-unassigned-tasks',
  '0 7 * * 1',
  $job$select public.notify_unassigned_tasks(false);$job$
);

-- Installation evidence: one active job, its owner, cadence and exact command.
select jobid, jobname, schedule, command, database, username, active
  from cron.job
 where jobname = 'paddock-control-notify-unassigned-tasks';
