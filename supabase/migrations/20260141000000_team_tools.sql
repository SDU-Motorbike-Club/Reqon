-- =============================================================================
--  Team page: a shared tool list.
--
--  WHAT WAS MISSING. The club had no record of who owns which tool, where it is and
--  who has it right now, so people asked in chat each time.
--
--  AFTER.
--   * tools: an item and THREE separate facts: who OWNS it (never changes), WHERE it
--     is (workshop / home / university / somewhere else) and WHO HAS IT right now
--     (a member, or nobody: it just sits where it is). Every member reads. A member
--     lists their own tools; a President, Vice President or Developer (is_admin) can
--     list one for anybody. The owner, an admin, or whoever has it changes where it is
--     and who has it. Anyone else may TAKE a tool nobody has (set themselves as the
--     holder). Only the owner or an admin renames or removes it.
--   * Like every public table, it gets the restore tombstone trigger.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        A shared tool list.
--    Existing data  None: the table starts empty.
--    New objects    Table tools (+ index, RLS, grants, trigger).
--    Locking        CREATE TABLE only.
--    Authorization  RLS; column grants limit what an UPDATE can touch.
--    Rollback       DROP TABLE tools (loses the tool list). Nothing depends on it.
--    Deploy order   After 20260140000000. The Team page reads this table;
--                   deploy the client after this migration.
-- =============================================================================

create table if not exists tools (
  id         uuid primary key default gen_random_uuid(),
  item       text not null check (length(btrim(item)) between 1 and 120),
  location   text not null default 'workshop' check (location in ('workshop', 'home', 'university', 'other')),
  -- Who has it right now. Null = nobody: it sits at its location. Not the owner, who never changes.
  held_by    uuid references members(id) on delete set null,
  owner_id   uuid not null references members(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tools_owner on tools (owner_id);
create index if not exists tools_held_by on tools (held_by) where held_by is not null;

comment on table tools is
  'Tools members own or can share: who owns it, where it is, and who has it now. Every member reads; see guard_tool_change() for who changes what.';
comment on column tools.location is 'Where it is: workshop, home, university or other.';
comment on column tools.held_by is 'Who has it right now (a member), or null for nobody: it just sits at its location.';

drop trigger if exists trg_touch on tools;
create trigger trg_touch before update on tools
  for each row execute function touch_updated_at();

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

-- --------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
