-- =============================================================================
--  A way to delete a task for good, and a weekly "tasks nobody owns" notice.
--
--  WHAT WAS MISSING. A task could only be archived (ADR-0004: nothing in the product deleted one), so
--  a task made by mistake, or one that is simply not valid, stayed in the archive forever. And a task
--  with no owner is invisible: nobody is told, so 57 of 67 open tasks on the real project had no one.
--
--  AFTER.
--   * delete_archived_task(task): the President, Vice President or Developer can erase a task that is
--     ALREADY ARCHIVED. Archive first, delete second, so a mistake is undoable until the last step.
--     Its dependencies and attachment rows go with it (they cascade); an activity row records who
--     deleted what. The restore tombstone triggers also keep the row for a restore.
--   * notify_unassigned_tasks(include_developers): counts the current season's open (not archived, not
--     done) tasks with no owner and, when there are any, puts one inbox item in every active President's
--     inbox (and the Developers', when asked, which is how the first one-off notice is sent). A person
--     who still has an unread one is not sent another, so a week nobody reads does not pile up.
--     Run weekly by the job in supabase/scheduler/install_unassigned_tasks_job.sql, and once by hand.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Permanent delete of an archived task; a recurring "unassigned tasks" notice.
--    Existing data  Untouched. One check constraint is widened by one notification kind.
--    Locking        ALTER TABLE ... ADD CONSTRAINT re-checks notifications once (a small table).
--    Authorization  delete_archived_task: SECURITY DEFINER, is_admin() (President, Vice President,
--                   Developer) checked inside; executable by authenticated. notify_unassigned_tasks:
--                   not executable by API roles; only the job (and a database owner) runs it.
--    Rollback       DROP both functions; restore the previous notifications_kind_known list.
--                   Run supabase/scheduler/uninstall_unassigned_tasks_job.sql first.
--                   create_task() is redefined (any start date up to the deadline).
--    Deploy order   After 20260145000000. Then run install_unassigned_tasks_job.sql ONCE (db push alone
--                   schedules nothing), and `select public.notify_unassigned_tasks(true);` once for
--                   the first notice. The client reads the new kind; deploy it after this migration.
-- =============================================================================

-- ------------------------------------------------------------ the new inbox kind
alter table notifications drop constraint if exists notifications_kind_known;
alter table notifications add constraint notifications_kind_known check (kind in (
  'task_assigned', 'task_blocked', 'review_requested', 'proposal_approved', 'changes_requested',
  'proposal_rejected', 'proposal_promoted', 'proposal_comment', 'role_granted', 'meeting_called',
  'tasks_unassigned'));

-- ------------------------------------------------------- delete an archived task
create or replace function delete_archived_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_task tasks%rowtype;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'Only the President, Vice President or a Developer can delete a task.' using errcode = '42501';
  end if;
  select * into v_task from tasks where id = p_task_id;
  if not found then
    raise exception 'That task does not exist (it may already be deleted).' using errcode = 'P0002';
  end if;
  if v_task.archived_at is null then
    raise exception 'Archive the task first. Only an archived task can be deleted.' using errcode = '22023';
  end if;
  delete from tasks where id = p_task_id;
  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (auth.uid(), v_task.season_id, 'task', p_task_id::text, 'deleted',
    jsonb_build_object('title', v_task.title, 'state', v_task.state, 'archive_reason', v_task.archive_reason));
end $fn$;

comment on function delete_archived_task(uuid) is
  'Permanently deletes an ARCHIVED task. President, Vice President or Developer only. Archive first, delete second.';

revoke all on function delete_archived_task(uuid) from public, anon;
grant execute on function delete_archived_task(uuid) to authenticated;

-- ---------------------------------------------------- the "nobody owns these" notice
create or replace function notify_unassigned_tasks(p_include_developers boolean default false) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_season uuid;
  v_count integer;
  v_activity bigint;
begin
  select id into v_season from seasons where is_current;
  if v_season is null then
    return 0;
  end if;
  select count(*) into v_count
    from tasks
   where season_id = v_season and archived_at is null and owner_id is null and state <> 'done';
  if v_count = 0 then
    return 0;
  end if;

  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (null, v_season, 'tasks', 'unassigned', 'unassigned_summary', jsonb_build_object('count', v_count))
  returning id into v_activity;

  insert into notifications (member_id, activity_id, season_id, kind, entity, entity_id, actor_id, title)
  select distinct m.id, v_activity, v_season, 'tasks_unassigned', 'tasks', 'unassigned', null::uuid,
         v_count || case when v_count = 1 then ' open task is' else ' open tasks are' end || ' not assigned to anyone yet'
    from members m
    join member_roles r on r.member_id = m.id
   where m.status = 'active'
     and (r.role = 'president' or (p_include_developers and r.role = 'developer'))
     and not exists (
       select 1 from notifications n
        where n.member_id = m.id and n.kind = 'tasks_unassigned' and n.read_at is null)
  on conflict (member_id, activity_id) do nothing;

  return v_count;
end $fn$;

comment on function notify_unassigned_tasks(boolean) is
  'Tells every active President (and the Developers, when asked) how many open tasks of the current season have no owner. Skips anyone who still has an unread one. Returns the count.';

revoke all on function notify_unassigned_tasks(boolean) from public, anon, authenticated;

-- ------------------------------------------- a task's start date is chosen, not forced to today
-- create_task() refused any start date more than a day from today, so the form could not ask for one. It now
-- accepts any start up to the deadline (and still defaults to today when none is sent). The owner check keeps
-- what 20260143000100 gave it: a trial member can be an owner.
create or replace function create_task(
  p_season_id uuid,
  p_title text,
  p_subteam_key text,
  p_owner_id uuid,
  p_due_date date,
  p_milestone_key text,
  p_clause_keys text[],
  p_detail text default null,
  p_priority task_priority default 'normal',
  p_starts_on date default null
) returns tasks
language plpgsql security definer set search_path = public as $fn$
declare
  v_title text := clean_text(coalesce(p_title, ''));
  v_detail text := nullif(clean_text(coalesce(p_detail, '')), '');
  v_keys text[] := (select coalesce(array_agg(distinct k), '{}') from unnest(coalesce(p_clause_keys, '{}')) k);
  v_start date;
  v_task tasks%rowtype;
begin
  if auth.uid() is null or not is_task_leader() then
    raise exception 'Only a Head, the President, the Vice President or a Developer may create a task directly. '
      'Everyone else suggests it as a proposal.' using errcode = '42501';
  end if;
  if length(v_title) < 1 or length(v_title) > 200 then
    raise exception 'Give the task a name of 1 to 200 characters.' using errcode = '23514';
  end if;
  if not exists (select 1 from seasons where id = p_season_id) then
    raise exception 'That season does not exist.' using errcode = '23503';
  end if;
  if p_subteam_key is null
     or not exists (select 1 from subteams s where s.key = p_subteam_key and s.archived_at is null) then
    raise exception 'Choose an active department for the task.' using errcode = '23514';
  end if;
  if p_due_date is null then
    raise exception 'Give the task a deadline.' using errcode = '23514';
  end if;
  if p_milestone_key is not null
     and not exists (select 1 from milestones m where m.key = p_milestone_key and m.season_id = p_season_id) then
    raise exception 'That milestone does not belong to this season.' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_keys) k where not exists (select 1 from clauses c where c.clause_key = k)) then
    raise exception 'One of the requirements does not exist.' using errcode = '23503';
  end if;
  if p_owner_id is not null and not exists (select 1 from members m where m.id = p_owner_id and m.status in ('active', 'trial')) then
    raise exception 'A task can only be assigned to an active member.' using errcode = '23514';
  end if;
  -- A start date is chosen by the person creating the task (the form requires it); a caller that sends none
  -- still gets today. It can be any day up to the deadline, but not after it.
  v_start := coalesce(p_starts_on, least((now() at time zone 'Europe/Copenhagen')::date, p_due_date));
  if v_start > p_due_date then
    raise exception 'The start date cannot be after the deadline.' using errcode = '23514';
  end if;

  insert into tasks (season_id, title, detail, owner_id, subteam_key, due_date, starts_on, priority,
                     milestone_key, state, source_proposal, created_by, links_required)
  values (p_season_id, v_title, v_detail, p_owner_id, p_subteam_key, p_due_date, v_start,
          coalesce(p_priority, 'normal'), p_milestone_key, 'todo', null, auth.uid(),
          -- Kept for good only when there is both a milestone and a requirement to keep.
          p_milestone_key is not null and array_length(v_keys, 1) is not null)
  returning * into v_task;

  insert into task_requirements (task_id, clause_key, created_by)
  select v_task.id, k, auth.uid() from unnest(v_keys) k;

  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (auth.uid(), p_season_id, 'task', v_task.id::text, 'created',
    jsonb_build_object('title', v_task.title, 'department', p_subteam_key));
  return v_task;
end $fn$;

revoke all on function create_task(uuid, text, text, uuid, date, text, text[], text, task_priority, date) from public, anon;
grant execute on function create_task(uuid, text, text, uuid, date, text, text[], text, task_priority, date) to authenticated, service_role;

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
