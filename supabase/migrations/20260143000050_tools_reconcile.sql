-- =============================================================================
--  Tools: bring a database made from an EARLIER draft of 20260141000000_team_tools.sql up to
--  that file's final shape.
--
--  WHAT WAS WRONG. 20260141000000 was applied to the hosted project from a first draft: a
--  `tools` table with a `status` column (workshop | borrowed | home), owner-only update
--  policies and no guard function. The migration was then rewritten in place (location +
--  held_by, an update policy for every active member, guard_tool_change()), but a recorded
--  version is never run again and the table already existed, so `create table if not exists`
--  skipped it. The hosted database therefore never got `location`, `held_by`, the guard
--  trigger or the new policies, and 20260143000100 failed trying to patch a
--  guard_tool_change() that does not exist.
--
--  AFTER. The same table the repository's 20260141000000 describes, whichever draft the
--  database started from. On a database that already has that shape this migration changes
--  nothing.
--
--  DATA. `status` becomes `location`: workshop -> workshop, home -> home, and borrowed ->
--  other (the draft recorded THAT it was borrowed, never by whom, so held_by stays empty and
--  the owner can say who has it). Then `status` is dropped. Nothing else is touched.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Make `tools` match 20260141000000 on a database made from the older draft.
--    Existing data  Every row kept; status mapped to location as above, then status dropped.
--    Locking        ALTER TABLE on a table of a handful of rows: brief.
--    Authorization  Policies, grants and guard_tool_change() as in 20260141000000;
--                   20260143000100 then widens them for trial members.
--    Rollback       Add `status text not null default 'workshop'` back, fill it from
--                   location, drop location and held_by. The old values cannot be told apart
--                   again for 'other' (it was 'borrowed' or 'other'); nothing else depends on it.
--    Deploy order   After 20260143000000, before 20260143000100.
-- =============================================================================

do $reconcile$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tools' and column_name = 'status') then
    alter table tools add column if not exists location text not null default 'workshop';
    alter table tools add column if not exists held_by uuid references members(id) on delete set null;

    update tools set location = case status when 'home' then 'home' when 'borrowed' then 'other' else 'workshop' end;

    alter table tools drop column status; -- takes tools_status_check with it
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.tools'::regclass and conname = 'tools_location_check') then
    alter table tools add constraint tools_location_check check (location in ('workshop', 'home', 'university', 'other'));
  end if;
end
$reconcile$;

create index if not exists tools_owner on tools (owner_id);
create index if not exists tools_held_by on tools (held_by) where held_by is not null;

comment on table tools is
  'Tools members own or can share: who owns it, where it is, and who has it now. Every member reads; see guard_tool_change() for who changes what.';
comment on column tools.location is 'Where it is: workshop, home, university or other.';
comment on column tools.held_by is 'Who has it right now (a member), or null for nobody: it just sits at its location.';

-- ------------------------------------------------------------------ access
alter table tools enable row level security;

revoke all on tools from anon, authenticated;
grant select, insert, delete on tools to authenticated;
-- An UPDATE can rename a tool, move it or hand it over; it can never change its owner.
grant update (item, location, held_by) on tools to authenticated;

drop policy if exists tools_read   on tools;
drop policy if exists tools_insert on tools;
drop policy if exists tools_update on tools;
drop policy if exists tools_delete on tools;
create policy tools_read on tools for select to authenticated
  using (is_member());
create policy tools_insert on tools for insert to authenticated
  with check (is_active_member() and (owner_id = auth.uid() or is_admin()));
-- Any active member may UPDATE a row; guard_tool_change() decides WHICH changes (the owner, an admin or
-- whoever has it may change it; anyone else may only take a tool nobody has).
create policy tools_update on tools for update to authenticated
  using (is_active_member()) with check (is_active_member());
create policy tools_delete on tools for delete to authenticated
  using (is_active_member() and (owner_id = auth.uid() or is_admin()));

-- ------------------------------------------------------- who may change what
create or replace function guard_tool_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return new; -- the service role and migrations
  end if;
  if new.held_by is not null and not exists (select 1 from members m where m.id = new.held_by and m.status = 'active') then
    raise exception 'Only an active member can have a tool.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if old.owner_id = auth.uid() or is_admin() or old.held_by = auth.uid() then
    -- The owner and an admin change anything; whoever has it moves it or hands it on, but does not rename it.
    if new.item is distinct from old.item and not (old.owner_id = auth.uid() or is_admin()) then
      raise exception 'Only the owner can rename a tool.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Anyone else: only to take a tool nobody has, as themselves, leaving its name alone.
  if old.held_by is null and new.held_by = auth.uid() and new.item is not distinct from old.item then
    return new;
  end if;
  raise exception 'Only the owner, an administrator or whoever has this tool can change it. You can take a tool nobody has.'
    using errcode = '42501';
end $fn$;

revoke all on function guard_tool_change() from public, anon, authenticated;

drop trigger if exists trg_guard_tool_change on tools;
create trigger trg_guard_tool_change before insert or update on tools
  for each row execute function guard_tool_change();
