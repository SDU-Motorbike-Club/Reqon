-- =============================================================================
--  Announcements: one message from the leadership to every member at once.
--
--  WHAT WAS MISSING. A person could message one colleague (20260154000000), but there
--  was no way to tell the whole club something, and nowhere to read it again later.
--
--  AFTER.
--   * announcements: the permanent record (who, what, when). The inbox rows below are
--     purged 90 days after they are read, so the history must not be read from them.
--     Every active or trial member reads it; nobody writes to it except send_announcement().
--   * send_announcement(p_body): President, Vice President or Developer (is_admin()).
--     Writes the record and one inbox row of kind 'announcement' for every active or
--     trial member except the author. Retired members receive nothing. Returns how many
--     people it reached. 1 to 1000 characters; at most 5 an hour per author.
--   * author_id is ON DELETE SET NULL: a member is retired, not deleted, in normal use,
--     but a removed fixture or a purged account must not be blocked by what they wrote.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Club-wide announcements with a readable history.
--    Existing data  Unchanged. Nothing is announced retroactively.
--    New objects    Table announcements (+ index, RLS, restore tombstone trigger);
--                   function send_announcement; kind 'announcement' in
--                   notifications_kind_known; notifications_body_matches_kind now also
--                   requires text for 'announcement'.
--    Locking        CREATE TABLE; two constraint swaps on notifications (one brief scan).
--                   At runtime one announcement inserts one row per member in one statement.
--    Authorization  New table: members read, nobody writes directly. The function is
--                   SECURITY DEFINER, pinned search_path, revoked from public and anon.
--    Rollback       DROP FUNCTION send_announcement(text); delete from notifications where
--                   kind = 'announcement'; DROP TABLE announcements; restore the two
--                   constraints from 20260154000000.
--    Deploy order   After 20260154000000, before the client that calls it.
-- =============================================================================

create table if not exists announcements (
  id         bigserial primary key,
  author_id  uuid references members(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint announcements_body_length check (char_length(btrim(body)) between 1 and 1000)
);

comment on table announcements is
  'Club-wide announcements, newest last. Written only by send_announcement(); read by active and trial members.';

create index if not exists announcements_recent on announcements (created_at desc, id desc);
create index if not exists announcements_author on announcements (author_id, created_at desc);

alter table announcements enable row level security;

drop policy if exists announcements_member_read on announcements;
create policy announcements_member_read on announcements for select to authenticated
  using (exists (select 1 from members m where m.id = auth.uid() and m.status in ('active', 'trial')));

revoke all on announcements from anon, authenticated;
grant select on announcements to authenticated;
grant all on announcements to service_role;
revoke all on sequence announcements_id_seq from anon, authenticated;

-- ------------------------------------------------------------ inbox: the new kind
alter table notifications drop constraint if exists notifications_kind_known;
alter table notifications add constraint notifications_kind_known check (kind in (
  'task_assigned', 'task_blocked', 'review_requested', 'proposal_approved', 'changes_requested',
  'proposal_rejected', 'proposal_promoted', 'proposal_comment', 'role_granted', 'meeting_called',
  'tasks_unassigned', 'message', 'announcement'));

-- Messages and announcements carry text; nothing else does.
alter table notifications drop constraint if exists notifications_body_matches_kind;
alter table notifications add constraint notifications_body_matches_kind
  check ((kind in ('message', 'announcement')) = (body is not null and btrim(body) <> ''));

-- -------------------------------------------------------------------- sending
create or replace function send_announcement(p_body text) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   bigint;
  v_n    integer;
begin
  if v_me is null or not is_admin() then
    raise exception 'Only the President, the Vice President or a Developer can send announcements.' using errcode = '42501';
  end if;
  if v_body = '' or char_length(v_body) > 1000 then
    raise exception 'An announcement is between 1 and 1000 characters.' using errcode = '22023';
  end if;
  -- Counted on announcements, not on the inbox rows: one announcement writes one row per member.
  if (select count(*) from announcements where author_id = v_me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many announcements in the last hour. Please wait a little.' using errcode = '54000';
  end if;

  insert into announcements (author_id, body) values (v_me, v_body) returning id into v_id;

  insert into notifications (member_id, season_id, kind, entity, entity_id, actor_id, body)
  select m.id, null, 'announcement', 'announcement', v_id::text, v_me, v_body
    from members m
   where m.status in ('active', 'trial') and m.id <> v_me;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

comment on function send_announcement(text) is
  'Sends an announcement to every active and trial member except the author, and records it. President, Vice President, Developer.';

revoke all on function send_announcement(text) from public, anon;
grant execute on function send_announcement(text) to authenticated, service_role;

select restore.install_tombstone_triggers();
