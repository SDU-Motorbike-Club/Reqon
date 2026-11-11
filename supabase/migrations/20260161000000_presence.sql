-- =============================================================================
--  Who is online.
--
--  WHAT WAS MISSING. Nothing said whether a colleague was around.
--
--  AFTER.
--   * members.last_seen_at: when the member last did something in the app, stamped by the
--     SERVER clock (a wrong clock in a browser cannot fake it).
--   * touch_presence(): called by the app while the person is active (a click, a key, a scroll).
--   * end_presence(): called on sign-out; the person is offline at once.
--   * online_member_ids(): the roster members seen in the last 30 minutes. Past that, with no
--     activity, they simply count as offline; nobody is signed out because of it.
--   Retired members are never shown as online. Every roster member can read the result, which is
--   the point of the feature; it is no more than members.last_seen_at, which the members policy
--   already lets the roster read.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Show who is online.
--    Existing data  Unchanged: last_seen_at is null (offline) for everyone until they next use the app.
--    New objects    members.last_seen_at; functions touch_presence, end_presence, online_member_ids.
--    Locking        ADD COLUMN without a default is catalogue-only.
--    Authorization  touch/end are SECURITY DEFINER, pinned search_path, write only the caller's own row,
--                   revoked from public and anon. online_member_ids is a plain SQL function: row-level
--                   security of members applies, so only the roster gets an answer.
--    Rollback       DROP FUNCTION online_member_ids(), end_presence(), touch_presence();
--                   ALTER TABLE members DROP COLUMN last_seen_at.
--    Deploy order   Before the client that calls them.
-- =============================================================================

alter table members add column if not exists last_seen_at timestamptz;

comment on column members.last_seen_at is
  'Server time of the member''s last activity in the app; null after sign-out. Online = within the last 30 minutes.';

create or replace function touch_presence() returns void
language sql security definer set search_path = public as $fn$
  update members set last_seen_at = now() where id = auth.uid() and status <> 'alumni';
$fn$;

create or replace function end_presence() returns void
language sql security definer set search_path = public as $fn$
  update members set last_seen_at = null where id = auth.uid();
$fn$;

create or replace function online_member_ids() returns setof uuid
language sql stable set search_path = public as $fn$
  select id from members where status <> 'alumni' and last_seen_at > now() - interval '30 minutes';
$fn$;

comment on function online_member_ids() is 'The roster members who did something in the app in the last 30 minutes.';

revoke all on function touch_presence() from public, anon;
revoke all on function end_presence() from public, anon;
revoke all on function online_member_ids() from public, anon;
grant execute on function touch_presence() to authenticated, service_role;
grant execute on function end_presence() to authenticated, service_role;
grant execute on function online_member_ids() to authenticated, service_role;
