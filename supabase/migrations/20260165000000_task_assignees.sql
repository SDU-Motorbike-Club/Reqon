-- =============================================================================
--  A task can be assigned to more than one person.
--
--  tasks.owner_id stays: it is the LEAD, the one person every existing rule, notification and page already
--  keys on. task_assignees adds everybody who works on the task, the lead included:
--
--    * the lead is always one of the assignees (a trigger keeps it so, whichever code path sets owner_id);
--    * an assignee may edit the task like its owner (can_edit_task);
--    * who is assigned changes only through set_task_assignees(), by whoever may reassign the owner today:
--      the department's Head, the President, the Vice President or a Developer.
--
--  DEFAULTS decided here (see directives/task_assignees.md): the lead keeps the role while still ticked, else
--  the first ticked person takes it; contributions and notifications still count the lead only.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Assign a task to several people.
--    Existing data  Every task that has an owner gets one task_assignees row for that owner; nothing else changes.
--    Locking        One new table; the backfill reads tasks once; CREATE TRIGGER on tasks is brief.
--    Rollback       DROP TABLE task_assignees; DROP FUNCTION set_task_assignees; drop trg_sync_task_owner_assignee
--                   on tasks; restore can_edit_task from 20260143000100.
--    Deploy order   After 20260164000000.
-- =============================================================================

create table if not exists task_assignees (
  task_id    uuid        not null references tasks(id) on delete cascade,
  member_id  uuid        not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, member_id)
);
create index if not exists task_assignees_member on task_assignees (member_id);

comment on table task_assignees is
  'Everybody a task is assigned to, its lead (tasks.owner_id) included. Written only by set_task_assignees() and by the owner-sync trigger.';

alter table task_assignees enable row level security;
alter table task_assignees replica identity full;
drop policy if exists member_read on task_assignees;
create policy member_read on task_assignees for select to authenticated using (is_member());
revoke all on task_assignees from anon, authenticated;
grant select on task_assignees to authenticated;
grant all on task_assignees to service_role;

do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_assignees') then
    alter publication supabase_realtime add table task_assignees;
  end if;
end
$pub$;

-- ------------------------------------------------------- the lead is an assignee
-- Whichever code path sets owner_id (a new task, a promoted proposal, set_task_assignees), the new owner is
-- an assignee. When the owner is REPLACED the old one stops being assigned: that is what "reassign" has always
-- meant. set_task_assignees() puts back anybody it wants to keep.
create or replace function sync_task_owner_assignee() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if TG_OP = 'UPDATE' and old.owner_id is not null and old.owner_id is distinct from new.owner_id then
    delete from task_assignees where task_id = new.id and member_id = old.owner_id;
  end if;
  if new.owner_id is not null then
    insert into task_assignees (task_id, member_id) values (new.id, new.owner_id) on conflict do nothing;
  end if;
  return null;
end $fn$;
revoke all on function sync_task_owner_assignee() from public, anon, authenticated;

drop trigger if exists trg_sync_task_owner_assignee on tasks;
create trigger trg_sync_task_owner_assignee after insert or update of owner_id on tasks
  for each row execute function sync_task_owner_assignee();

insert into task_assignees (task_id, member_id)
select id, owner_id from tasks where owner_id is not null
on conflict do nothing;

-- ------------------------------------------------------ an assignee may edit
-- Same as 20260143000100, with one more way in: being assigned. The first gate is unchanged (a trial member
-- may edit what is theirs); department authority and the leader branch still need an active member.
create or replace function can_edit_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_participating_member() and exists (
    select 1 from tasks t
    where t.id = p_task_id
      and t.archived_at is null
      and (t.owner_id = auth.uid()
           or exists (select 1 from task_assignees a where a.task_id = t.id and a.member_id = auth.uid())
           or (is_active_member() and (has_department_authority(t.subteam_key) or is_task_leader())))
  );
$fn$;

-- ---------------------------------------------------------- set_task_assignees
-- Replaces the whole set. p_member_ids may be empty (the task becomes unassigned). Order matters only for
-- who becomes the lead when the current one is not in the new set: the first one listed.
create or replace function set_task_assignees(p_task_id uuid, p_member_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v         tasks%rowtype;
  v_ids     uuid[];
  v_before  uuid[];
  v_added   uuid[];
  v_removed uuid[];
  v_lead    uuid;
begin
  if auth.uid() is null or not is_active_member() then
    raise exception 'Only an active member can assign a task.' using errcode = '42501';
  end if;
  select * into v from tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task does not exist.' using errcode = 'P0002';
  end if;
  if v.archived_at is not null then
    raise exception 'An archived task cannot be reassigned. Restore it first.' using errcode = '23514';
  end if;
  if not (has_department_authority(v.subteam_key) or is_task_leader()) then
    raise exception 'Only a Head, the President, the Vice President or a Developer may change who a task is assigned to.'
      using errcode = '42501';
  end if;

  -- Drop nulls and repeats, keep the caller's order.
  select coalesce(array_agg(id order by first_pos), '{}') into v_ids
    from (select id, min(pos) as first_pos
            from unnest(coalesce(p_member_ids, '{}')) with ordinality as u(id, pos)
           where id is not null group by id) s;
  if cardinality(v_ids) > 20 then
    raise exception 'A task can have at most 20 assignees.' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_ids) u(id)
              where not exists (select 1 from members m where m.id = u.id and m.status = 'active')) then
    raise exception 'A task can only be assigned to an active member.' using errcode = '23514';
  end if;

  select coalesce(array_agg(member_id), '{}') into v_before from task_assignees where task_id = p_task_id;
  v_added   := coalesce(array(select unnest(v_ids) except select unnest(v_before)), '{}');
  v_removed := coalesce(array(select unnest(v_before) except select unnest(v_ids)), '{}');

  -- The lead keeps the role while still assigned; otherwise the first person listed takes it.
  v_lead := case when v.owner_id = any (v_ids) then v.owner_id else v_ids[1] end;
  if v_lead is distinct from v.owner_id then
    update tasks set owner_id = v_lead where id = p_task_id;   -- the trigger above moves the owner's row
  end if;
  delete from task_assignees where task_id = p_task_id and not (member_id = any (v_ids));
  insert into task_assignees (task_id, member_id) select p_task_id, u from unnest(v_ids) u on conflict do nothing;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    insert into activity (actor_id, season_id, entity, entity_id, action, detail)
    values (auth.uid(), v.season_id, 'task', v.id::text, 'assignees_changed',
      jsonb_build_object('title', v.title, 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;
end $fn$;

revoke all on function set_task_assignees(uuid, uuid[]) from public, anon;
grant execute on function set_task_assignees(uuid, uuid[]) to authenticated, service_role;

comment on function set_task_assignees(uuid, uuid[]) is
  'Replaces who a task is assigned to. The lead (owner_id) stays while still listed, else the first listed. Same authority as reassigning an owner.';

-- A new table needs the restore engine's tombstone trigger (restore_support_test.sql checks every table).
select restore.install_tombstone_triggers();
