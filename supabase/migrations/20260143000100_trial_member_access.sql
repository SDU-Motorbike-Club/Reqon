-- =============================================================================
--  Trial members, step 2 of 2: what a trial member may do. See docs/trial-members.md.
--
--  A trial member reads everything a member reads, edits and moves the tasks they own,
--  suggests proposals, records spec measurements, attaches files to their own tasks and
--  uses the tool list. Everything else needs a full member.
--
--  FAIL CLOSED. is_active_member() is NOT widened: it stays "status = 'active'", so every
--  write gate that uses it keeps refusing a trial member (requirement status, specs,
--  handover notes, task links, department membership, ...). A new
--  is_participating_member() ("active or trial") is used in exactly the places below.
--
--  A trial member holds no role and heads no department. The trial ends when someone
--  changes the status in Settings -> Roster (guard_member_edit() already limits that to
--  the President, Vice President and Developer). No end date, no scheduled job.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let a trial member do the work above and nothing more.
--    Existing data  Untouched: nobody is trial until someone sets it.
--    New objects    is_participating_member(); guard_trial_member() with a trigger on
--                   members and one on member_roles.
--    Changed        can_edit_task, the tools policies, and the guard line of
--                   submit_proposal, record_spec_measurement, request_attachment_upload,
--                   delete_attachment, set_attachment_caption (patched in place, so the
--                   rest of each body is the live definition, not a copy), plus the
--                   "assign to an active member" checks in guard_task_edit, create_task,
--                   promote_proposal, guard_tool_change and notify_from_activity.
--    Locking        CREATE OR REPLACE and CREATE TRIGGER: brief.
--    Authorization  Only widens what a trial member may do, never what anyone else may.
--    Rollback       Re-run the earlier definitions of the changed functions and drop the
--                   triggers. No data depends on this.
--    Deploy order   After 20260143000000. The client reads the new status afterwards.
-- =============================================================================

create or replace function is_participating_member() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from members m where m.id = auth.uid() and m.status in ('active', 'trial'));
$fn$;

comment on function is_participating_member() is
  'An active or trial member. Opened only for the work a trial member may do; every other write gate keeps is_active_member().';

revoke all on function is_participating_member() from public, anon;
grant execute on function is_participating_member() to authenticated, service_role;

-- ---------------------------------------------- a trial member holds no authority
create or replace function guard_trial_member() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_table_name = 'member_roles' then
    if exists (select 1 from members m where m.id = new.member_id and m.status = 'trial') then
      raise exception 'A trial member cannot hold a role. Make them a full member first.' using errcode = '23514';
    end if;
    return new;
  end if;
  -- members: setting someone to trial
  if new.status = 'trial' and old.status is distinct from 'trial' then
    if exists (select 1 from member_roles r where r.member_id = new.id) then
      raise exception 'Take this person''s roles away before putting them on trial.' using errcode = '23514';
    end if;
    if exists (select 1 from subteams s where s.lead_id = new.id and s.archived_at is null) then
      raise exception 'This person is the Head of a department. Appoint someone else before putting them on trial.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $fn$;

revoke all on function guard_trial_member() from public, anon, authenticated;

drop trigger if exists trg_guard_trial_member on members;
create trigger trg_guard_trial_member before update of status on members
  for each row execute function guard_trial_member();

drop trigger if exists trg_guard_trial_role on member_roles;
create trigger trg_guard_trial_role before insert or update of member_id on member_roles
  for each row execute function guard_trial_member();

-- ------------------------------------------------------------- own tasks
-- Same as 20260142000000 except the first gate: the OWNER branch needs only a participating
-- member, while department authority and the leader branch still need an active one.
create or replace function can_edit_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_participating_member() and exists (
    select 1 from tasks t
    where t.id = p_task_id
      and t.archived_at is null
      and (t.owner_id = auth.uid()
           or (is_active_member() and (has_department_authority(t.subteam_key) or is_task_leader())))
  );
$fn$;

-- ----------------------------------------------------------- tools
drop policy if exists tools_insert on tools;
drop policy if exists tools_update on tools;
drop policy if exists tools_delete on tools;
create policy tools_insert on tools for insert to authenticated
  with check (is_participating_member() and (owner_id = auth.uid() or is_admin()));
create policy tools_update on tools for update to authenticated
  using (is_participating_member()) with check (is_participating_member());
create policy tools_delete on tools for delete to authenticated
  using (is_participating_member() and (owner_id = auth.uid() or is_admin()));

-- ------------------------------------------------ patch the guard line in place
-- Replaces p_from with p_to in the live definition of every function called p_name, and
-- refuses to continue unless exactly p_functions functions change and each contained
-- p_hits occurrences. A definition that drifted from what this migration expects fails
-- the migration instead of being silently skipped.
create or replace function pg_temp.patch_function(
  p_name text, p_from text, p_to text, p_functions int, p_hits int
) returns void language plpgsql as $fn$
declare
  r record;
  v_def text;
  v_hits int;
  v_done int := 0;
begin
  for r in select p.oid from pg_proc p where p.proname = p_name and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(r.oid);
    v_hits := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
    if v_hits = 0 then
      continue;
    end if;
    if v_hits <> p_hits then
      raise exception 'patch_function(%): % contains % occurrences of %, expected %',
        p_name, r.oid::regprocedure, v_hits, p_from, p_hits;
    end if;
    execute replace(v_def, p_from, p_to);
    v_done := v_done + 1;
  end loop;
  if v_done <> p_functions then
    raise exception 'patch_function(%): patched % functions, expected %', p_name, v_done, p_functions;
  end if;
end $fn$;

-- Who may act: a trial member suggests, records, attaches to their own tasks.
select pg_temp.patch_function('submit_proposal',            'is_active_member()', 'is_participating_member()', 1, 1);
select pg_temp.patch_function('record_spec_measurement',    'is_active_member()', 'is_participating_member()', 1, 1);
select pg_temp.patch_function('request_attachment_upload',  'is_active_member()', 'is_participating_member()', 1, 1);
select pg_temp.patch_function('delete_attachment',          'is_active_member()', 'is_participating_member()', 1, 1);
select pg_temp.patch_function('set_attachment_caption',     'is_active_member()', 'is_participating_member()', 1, 1);

-- Who may be given work, hold a tool, or hear about their own tasks.
select pg_temp.patch_function('guard_task_edit',     'm.status = ''active''', 'm.status in (''active'', ''trial'')', 1, 1);
select pg_temp.patch_function('create_task',         'm.status = ''active''', 'm.status in (''active'', ''trial'')', 1, 1);
select pg_temp.patch_function('promote_proposal',    'm.status = ''active''', 'm.status in (''active'', ''trial'')', 1, 1);
select pg_temp.patch_function('guard_tool_change',   'm.status = ''active''', 'm.status in (''active'', ''trial'')', 1, 1);
select pg_temp.patch_function('notify_from_activity','m.status = ''active''', 'm.status in (''active'', ''trial'')', 1, 1);
