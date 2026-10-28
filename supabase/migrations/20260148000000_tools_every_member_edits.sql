-- =============================================================================
--  Every full member can change any tool; a member on trial cannot.
--
--  WHAT WAS WRONG. guard_tool_change() let only the owner, an administrator or whoever held a tool change
--  it (anyone else could only take a tool nobody had), and the update policy let trial members through
--  to that check. The club's actual rule is simpler: the tool list is everyone's to keep right, so any
--  member can move a tool, hand it on to someone else or correct its name; a member still on trial reads
--  the list only.
--
--  AFTER.
--   * tools_update (policy): is_active_member(), which is status = 'active' only. A trial member's update
--     matches no row, and guard_tool_change() also refuses it by name.
--   * guard_tool_change(): after the "only an active or trial member can HAVE a tool" check (a tool may be
--     handed to a trial member, who is using it but cannot change it themselves), an UPDATE is allowed to
--     any active member for item, location and held_by. Who OWNS a tool and whether it is a club tool are
--     not editable (no UPDATE grant on owner_id or shared).
--   * Listing a tool (insert) and removing one (delete) are unchanged: you list your own, and the owner
--     or an administrator removes it.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let every active member edit tools; keep trial members read-only.
--    Existing data  Untouched.
--    Locking        DROP/CREATE POLICY and CREATE OR REPLACE FUNCTION: metadata only.
--    Authorization  See above. Trial members can still read (tools_read) and still list their own tool.
--    Rollback       Restore tools_update to is_participating_member() and guard_tool_change() from
--                   20260143000050 (as patched by 20260143000100).
--    Deploy order   Any time after 20260147000000. The client hides Edit from trial members; deploy it after.
-- =============================================================================

drop policy if exists tools_update on tools;
create policy tools_update on tools for update to authenticated
  using (is_active_member()) with check (is_active_member());

create or replace function guard_tool_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return new; -- the service role and migrations
  end if;
  if new.held_by is not null and not exists (select 1 from members m where m.id = new.held_by and m.status in ('active', 'trial')) then
    raise exception 'Only an active member can have a tool.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if not is_active_member() then
    raise exception 'A member on trial can see the tools but not change them.' using errcode = '42501';
  end if;
  return new;
end $fn$;

comment on function guard_tool_change() is
  'BEFORE INSERT/UPDATE on tools: a tool can only be held by an active or trial member; any active member may change a tool''s name, place and holder; a trial member may not.';

revoke all on function guard_tool_change() from public, anon, authenticated;

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
