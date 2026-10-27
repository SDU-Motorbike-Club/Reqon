-- =============================================================================
--  Who may change a task, and creating one directly.
--
--  WHAT CHANGES.
--   * A "task leader" is an active Head (the lead of an active department), the
--     President, the Vice President or a Developer. A task leader may edit ANY
--     task and reassign its owner, in any department. Before this a Head could
--     only act inside their own department. An ordinary member still edits only
--     the tasks they own. Treasurers are not leaders. Archiving, restoring and
--     moving a task between departments keep their existing, department-scoped
--     rules; so do proposal review and approval.
--   * create_task(): a task leader creates a task straight on the Board, with
--     no proposal. It needs a title, an active department and a deadline. A
--     milestone of the season and requirements are OPTIONAL: they can be added
--     later on the task. When BOTH are given the task keeps them, like a promoted
--     task (links_required); with either missing it is free to change. It is
--     logged as 'created' and the owner (if not the creator) is told in the inbox.
--   * v_task_list: tasks with owner, department and milestone NAMES, so the
--     Tasks page can sort and search every row in the database, not one page.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Wider edit authority for leaders; direct task creation; a list view.
--    Existing data  Unchanged.
--    New objects    Functions is_task_leader, create_task; view v_task_list.
--                   Replaced: can_edit_task, guard_task_edit (owner-reassignment
--                   check only), notify_from_activity (one new action).
--    Locking        Function and view replacement only.
--    Authorization  Widened for editing as described above; create_task is
--                   leader-only and re-checks everything after locking nothing
--                   (it only inserts). The view is security_invoker: it shows
--                   exactly what the caller may already read.
--    Rollback       Restore can_edit_task from 20260130000000, guard_task_edit
--                   from 20260128000400, notify_from_activity from
--                   20260140000000; drop create_task, is_task_leader, v_task_list.
--    Deploy order   After 20260141000000. The client's New task button, the
--                   Tasks page and the widened edit controls need this.
-- =============================================================================

create or replace function is_task_leader() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active_member() and (
    is_admin()
    or exists (select 1 from subteams s where s.lead_id = auth.uid() and s.archived_at is null)
  );
$fn$;

comment on function is_task_leader() is
  'An active Head, the President, the Vice President or a Developer: may edit any task (20260142000000).';

create or replace function can_edit_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active_member() and exists (
    select 1 from tasks t
    where t.id = p_task_id
      and t.archived_at is null
      and (t.owner_id = auth.uid() or has_department_authority(t.subteam_key) or is_task_leader())
  );
$fn$;

-- Same body as 20260128000400 except the owner-reassignment check.
create or replace function guard_task_edit() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_internal boolean;
begin
  v_internal := coalesce(current_setting('reqon.task_lifecycle_write', true), '') = 'on';

  if TG_OP = 'INSERT' then
    -- A task created blocked (an import) gets the stamp; an explanation is not
    -- demanded of history. Only ENTERING blocked later needs one.
    if new.state = 'blocked' then
      new.blocked_since := now();
    else
      new.blocked_reason := null;
      new.blocked_since := null;
    end if;
    if new.state = 'done' then
      new.completed_at := now();
      new.completion_source := 'recorded';
    else
      new.completed_at := null;
      new.completion_source := null;
    end if;
    return new;
  end if;

  if new.state = 'done' and old.state is distinct from 'done' then
    new.completed_at := now();
    new.completion_source := 'recorded';
  elsif new.state = 'done' and old.state = 'done' then
    new.completed_at := old.completed_at;
    new.completion_source := old.completion_source;
  else
    new.completed_at := null;
    new.completion_source := null;
  end if;


  -- ---------------------------------------------------------- blocker reason
  -- Entering Blocked needs an explanation: a written reason (an EXTERNAL
  -- blocker — a supplier, a decision, an event) or at least one prerequisite
  -- task. A task that was already Blocked before this rule existed may stay so
  -- with neither; it is only asked when someone edits the reason away.
  new.blocked_reason := nullif(clean_text(coalesce(new.blocked_reason, '')), '');
  if length(new.blocked_reason) > 500 then
    raise exception 'A blocker reason can be at most 500 characters.' using errcode = '23514';
  end if;
  if new.state = 'blocked' then
    if old.state is distinct from 'blocked' then
      new.blocked_since := now();
      if new.blocked_reason is null and not exists (select 1 from task_dependencies d join tasks p on p.id = d.depends_on_task_id
                      where d.task_id = new.id and p.state not in ('done', 'cancelled') and p.archived_at is null) then
        raise exception 'Say why this task is blocked: write the reason, or link the task it is waiting for.'
          using errcode = '23514';
      end if;
    else
      new.blocked_since := old.blocked_since;
      if old.blocked_reason is not null and new.blocked_reason is null
         and not exists (select 1 from task_dependencies d join tasks p on p.id = d.depends_on_task_id
                      where d.task_id = new.id and p.state not in ('done', 'cancelled') and p.archived_at is null) then
        raise exception 'A blocked task must say why. Write the reason, link the task it is waiting for, or move it out of Blocked.'
          using errcode = '23514';
      end if;
    end if;
  else
    if old.state <> 'blocked' and new.blocked_reason is not null then
      raise exception 'A blocker reason only applies to a Blocked task.' using errcode = '23514';
    end if;
    -- Leaving Blocked closes the blocker.
    new.blocked_reason := null;
    new.blocked_since := null;
  end if;

  if not v_internal and old.archived_at is not null then
    raise exception 'This task is archived. Restore it before editing.' using errcode = '42501';
  end if;

  if not v_internal and (
    new.season_id is distinct from old.season_id
    or new.source_proposal is distinct from old.source_proposal
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.subteam_key is distinct from old.subteam_key
    or new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason
    or new.links_required is distinct from old.links_required
  ) then
    raise exception 'That field cannot be changed through an ordinary task edit.' using errcode = '42501';
  end if;

  if old.links_required and new.milestone_key is null then
    raise exception 'A task created from a proposal must keep its milestone.' using errcode = '23514';
  end if;

  if new.owner_id is distinct from old.owner_id then
    if not v_internal and not has_department_authority(old.subteam_key) and not is_task_leader() then
      raise exception 'Only a Head, the President, the Vice President or a Developer may reassign a task''s owner.'
        using errcode = '42501';
    end if;
    if new.owner_id is not null and not exists (
      select 1 from members m where m.id = new.owner_id and m.status = 'active'
    ) then
      raise exception 'A task can only be assigned to an active member.' using errcode = '23514';
    end if;
  end if;

  if not v_internal and old.source_proposal is not null and old.due_date is not null and new.due_date is null then
    raise exception 'A promoted task''s deadline cannot be cleared. Archive or reopen it instead.'
      using errcode = '42501';
  end if;

  return new;
end $fn$;

-- ----------------------------------------------------------- create a task
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
  if p_owner_id is not null and not exists (select 1 from members m where m.id = p_owner_id and m.status = 'active') then
    raise exception 'A task can only be assigned to an active member.' using errcode = '23514';
  end if;
  if p_starts_on is not null
     and abs(p_starts_on - (now() at time zone 'Europe/Copenhagen')::date) > 1 then
    raise exception 'A new task starts today. That start date is more than a day away from today.' using errcode = '22023';
  end if;
  v_start := least(coalesce(p_starts_on, (now() at time zone 'Europe/Copenhagen')::date), p_due_date);

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

comment on function create_task(uuid, text, text, uuid, date, text, text[], text, task_priority, date) is
  'A task leader creates a task directly (no proposal): needs a title, department and deadline; milestone and requirements are optional. Logged as created.';

-- ------------------------------------------------- the list the Tasks page reads
create or replace view v_task_list with (security_invoker = on) as
select t.id, t.season_id, t.title, t.state, t.priority, t.due_date, t.starts_on,
       t.owner_id, o.full_name as owner_name,
       t.subteam_key, s.name as department_name,
       t.milestone_key, ms.name as milestone_name,
       t.archived_at, t.updated_at
  from tasks t
  left join members o on o.id = t.owner_id
  left join subteams s on s.key = t.subteam_key
  left join milestones ms on ms.key = t.milestone_key and ms.season_id = t.season_id;

comment on view v_task_list is
  'Tasks with owner, department and milestone names, for the sortable Tasks page. security_invoker: the caller sees only what they may read in tasks.';

revoke all on v_task_list from anon, authenticated;
grant select on v_task_list to authenticated;

-- 20260126000600's EXECUTE policy: internal helpers are not for the API.
revoke all on function is_task_leader() from public, anon, authenticated;
revoke all on function create_task(uuid, text, text, uuid, date, text, text[], text, task_priority, date) from public, anon;
grant execute on function create_task(uuid, text, text, uuid, date, text, text[], text, task_priority, date) to authenticated, service_role;

-- Same body as 20260140000000 plus the 'created' action (a task made directly tells its owner).
create or replace function notify_from_activity() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_kind text;
  v_to text[] := '{}';
  v_title text := nullif(btrim(coalesce(new.detail->>'title', '')), '');
  v_task tasks%rowtype;
  v_prop task_proposals%rowtype;
  v_meet meetings%rowtype;
begin
  if new.entity = 'task' and new.action in ('owner_changed', 'created_from_proposal', 'created', 'state_changed') then
    -- Compared as text throughout: a notification must never be the reason an
    -- audited change fails, so nothing here casts a payload value.
    select * into v_task from tasks where id::text = new.entity_id;
    if not found then return null; end if;
    v_title := coalesce(v_title, v_task.title);
    if new.action = 'owner_changed' then
      v_kind := 'task_assigned';
      v_to := array[new.detail->>'to'];
    elsif new.action in ('created_from_proposal', 'created') then
      v_kind := 'task_assigned';
      v_to := array[v_task.owner_id::text];
    elsif new.detail->>'to' = 'blocked' and new.detail->>'from' is distinct from 'blocked' then
      v_kind := 'task_blocked';
      v_to := array[v_task.owner_id::text]
        || coalesce((select array_agg(s.lead_id::text) from subteams s where s.key = v_task.subteam_key and s.lead_id is not null), '{}')
        || coalesce((select array_agg(p.lead_id::text) from subteams s join subteams p on p.key = s.parent_key
                      where s.key = v_task.subteam_key and p.lead_id is not null), '{}');
    end if;

  elsif new.entity = 'proposal'
        and new.action in ('submitted', 'revised', 'approved', 'commented', 'outcome_changed', 'promoted') then
    select * into v_prop from task_proposals where id::text = new.entity_id;
    if not found then return null; end if;
    v_title := coalesce(v_title, v_prop.title);
    -- A revision asks for review only when the author made it; a reviewer
    -- editing the wording is not a request to themselves.
    if new.action = 'submitted'
       or (new.action = 'revised' and new.actor_id is not distinct from v_prop.raised_by) then
      v_kind := 'review_requested';
      v_to := proposal_reviewers(v_prop.subteam_key)::text[];
    elsif new.action = 'approved' then
      v_kind := 'proposal_approved';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'commented' and new.detail->>'kind' = 'changes_requested' then
      v_kind := 'changes_requested';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'commented' and new.detail->>'kind' = 'comment' then
      v_kind := 'proposal_comment';
      v_to := case when new.actor_id is not distinct from v_prop.raised_by
                   then proposal_reviewers(v_prop.subteam_key)::text[]
                   else array[v_prop.raised_by::text] end;
    elsif new.action = 'outcome_changed' and new.detail->>'to' = 'rejected' then
      v_kind := 'proposal_rejected';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'promoted' then
      v_kind := 'proposal_promoted';
      v_to := array[v_prop.raised_by::text];
    end if;

  elsif new.entity = 'meeting' and new.action = 'called' then
    -- A meeting called for a department tells that department: its members
    -- this season and its Head (and the parent's). A meeting dated in the past
    -- is a record being written up, not a call, so it tells nobody.
    select * into v_meet from meetings where id::text = new.entity_id;
    if not found or v_meet.subteam_key is null or v_meet.held_on < current_date then return null; end if;
    v_title := coalesce(v_title, v_meet.title);
    v_kind := 'meeting_called';
    v_to := coalesce((select array_agg(d.member_id::text) from department_members d
                       where d.season_id = v_meet.season_id and d.subteam_key = v_meet.subteam_key), '{}')
      || coalesce((select array_agg(s.lead_id::text) from subteams s
                    where s.key = v_meet.subteam_key and s.lead_id is not null), '{}')
      || coalesce((select array_agg(p.lead_id::text) from subteams s join subteams p on p.key = s.parent_key
                    where s.key = v_meet.subteam_key and p.lead_id is not null), '{}');

  elsif new.entity = 'member_role' and new.action = 'role_granted' then
    v_kind := 'role_granted';
    v_to := array[new.entity_id];
    v_title := new.detail->>'role';
  end if;

  if v_kind is null then
    return null;
  end if;

  insert into notifications (member_id, activity_id, season_id, kind, entity, entity_id, actor_id, title)
  select m.id, new.id, new.season_id, v_kind, new.entity, new.entity_id, new.actor_id, left(v_title, 300)
    from members m
   where m.id::text = any(v_to)
     and m.status = 'active'
     and m.id is distinct from new.actor_id
  on conflict (member_id, activity_id) do nothing;
  return null;
end $fn$;

revoke all on function notify_from_activity() from public, anon, authenticated;
