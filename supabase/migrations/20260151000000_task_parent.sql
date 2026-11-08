-- =============================================================================
--  Task hierarchy: a task can be part of ONE parent task (one level only).
--
--  * parent_id            nullable, the parent task. on delete set null: deleting
--                         (only ever an archived) parent releases its subtasks.
--  * enforce_task_parent  same season, no self-parent, no second level either way.
--  * sync_parent_task_state
--                         a parent is Done once every subtask is Done or Cancelled
--                         and at least one is Done; a Done parent goes back to
--                         In progress when a subtask is reopened or a new one is
--                         added. Archived and Cancelled parents are left alone.
--
--  Setting parent_id is an ordinary task edit (RLS can_edit_task); create_task is
--  deliberately unchanged, so there is no second overload for PostgREST to confuse.
-- =============================================================================

alter table tasks add column if not exists parent_id uuid references tasks (id) on delete set null;
create index if not exists tasks_parent_id_idx on tasks (parent_id) where parent_id is not null;

create or replace function enforce_task_parent() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'A task cannot be part of itself.' using errcode = '23514';
  end if;
  select season_id, parent_id into p from tasks where id = new.parent_id;
  if not found then
    raise exception 'That parent task does not exist.' using errcode = '23514';
  end if;
  if p.season_id is distinct from new.season_id then
    raise exception 'A task and its parent must be in the same season.' using errcode = '23514';
  end if;
  if p.parent_id is not null then
    raise exception 'Tasks nest one level only: that task is already part of another task.' using errcode = '23514';
  end if;
  if exists (select 1 from tasks where parent_id = new.id) then
    raise exception 'This task has subtasks of its own, so it cannot become a subtask.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_task_parent on tasks;
create trigger trg_task_parent before insert or update of parent_id on tasks
  for each row execute function enforce_task_parent();

-- SECURITY DEFINER because the person finishing a subtask need not be allowed to edit the
-- parent; the change is system-driven. It is a trigger function only, never callable as an RPC.
create or replace function sync_parent_task_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid; v_state task_state; v_archived timestamptz; v_open int; v_done int;
begin
  for pid in
    select distinct x from unnest(array[new.parent_id, case when tg_op = 'UPDATE' then old.parent_id end]) x where x is not null
  loop
    select state, archived_at into v_state, v_archived from tasks where id = pid for update;
    if not found or v_archived is not null or v_state = 'cancelled' then continue; end if;
    select count(*) filter (where state in ('todo', 'wip', 'blocked')), count(*) filter (where state = 'done')
      into v_open, v_done from tasks where parent_id = pid;
    if v_open = 0 and v_done > 0 and v_state <> 'done' then
      update tasks set state = 'done' where id = pid;
    elsif v_open > 0 and v_state = 'done' then
      update tasks set state = 'wip' where id = pid;
    end if;
  end loop;
  return null;
end $$;

revoke execute on function sync_parent_task_state() from public, anon, authenticated;
revoke execute on function enforce_task_parent() from public, anon, authenticated;

drop trigger if exists trg_sync_parent_task_insert on tasks;
create trigger trg_sync_parent_task_insert after insert on tasks
  for each row when (new.parent_id is not null) execute function sync_parent_task_state();

drop trigger if exists trg_sync_parent_task_update on tasks;
create trigger trg_sync_parent_task_update after update of state, parent_id on tasks
  for each row when (new.parent_id is not null or old.parent_id is not null) execute function sync_parent_task_state();
