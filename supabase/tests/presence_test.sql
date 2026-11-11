-- =============================================================================
--  Presence (20260161000000_presence.sql): touch_presence(), end_presence(), online_member_ids().
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @presencetest.test addresses.
--
--  Result: an "error" whose message begins with
--      PRESENCE CHECKS PASSED   or   PRESENCE CHECKS FAILED
-- =============================================================================

create or replace function pg_temp.as_user(who uuid) returns void
language plpgsql as $fn$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', who::text, true);
  end if;
end $fn$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create or replace function pg_temp.note(
  inout lines text[], inout failures text[], label text, ok boolean, detail text default null
) returns record language plpgsql as $fn$
begin
  lines := lines || format('%s  %s%s', case when coalesce(ok, false) then 'ok  ' else 'FAIL' end, label,
    case when detail is null then '' else ' — ' || detail end);
  if not coalesce(ok, false) then
    failures := failures || format('%s%s', label, case when detail is null then '' else ': ' || detail end);
  end if;
end $fn$;

do $test$
declare
  a    uuid := gen_random_uuid();   -- active member
  b    uuid := gen_random_uuid();   -- another active member
  old  uuid := gen_random_uuid();   -- retired
  seen timestamptz;
  err  text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (a, 'a@presencetest.test'), (b, 'b@presencetest.test'), (old, 'old@presencetest.test');
  insert into members (id, full_name, role, status) values
    (a, 'Pres A', 'Software', 'active'), (b, 'Pres B', 'Software', 'active'), (old, 'Pres Old', 'Software', 'alumni');

  -- 1. Nobody is online until they do something
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody is online before any activity',
    not exists (select 1 from online_member_ids() id where id in (a, b, old)));

  -- 2. Activity makes the caller (and only the caller) online, and everyone on the roster can see it
  perform pg_temp.as_user(a);
  perform touch_presence();
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'a member who was active shows as online to a colleague',
    exists (select 1 from online_member_ids() id where id = a)
    and not exists (select 1 from online_member_ids() id where id = b));
  perform pg_temp.as_owner();
  select last_seen_at into seen from members where id = a;
  select * into lines, failures from pg_temp.note(lines, failures, 'the time is the server''s, just now', seen > now() - interval '1 minute' and seen <= now());

  -- 3. Sign-out ends it at once
  perform pg_temp.as_user(a);
  perform end_presence();
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'signing out takes a member offline at once',
    not exists (select 1 from online_member_ids() id where id = a));

  -- 4. 30 minutes of inactivity ends it, with no sign-out
  perform pg_temp.as_owner();
  update members set last_seen_at = now() - interval '29 minutes' where id = a;
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'seen 29 minutes ago is still online',
    exists (select 1 from online_member_ids() id where id = a));
  perform pg_temp.as_owner();
  update members set last_seen_at = now() - interval '31 minutes' where id = a;
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'seen 31 minutes ago is offline',
    not exists (select 1 from online_member_ids() id where id = a));
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'going offline signs nobody out: the member row is untouched', exists (select 1 from members where id = a and status = 'active'));

  -- 5. Retired members are never online
  perform pg_temp.as_user(old);
  perform touch_presence();
  perform pg_temp.as_owner();
  update members set last_seen_at = now() where id = old;
  perform pg_temp.as_user(b);
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member never shows as online',
    not exists (select 1 from online_member_ids() id where id = old));

  -- 6. Nobody signed out can use any of it
  perform pg_temp.as_user(null);
  begin perform touch_presence(); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'touch_presence is not callable without signing in', err = 'refused', err);
  begin perform end_presence(); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'end_presence is not callable without signing in', err = 'refused', err);
  begin perform online_member_ids(); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the online list is not readable without signing in', err = 'refused', err);
  perform pg_temp.as_owner();

  if array_length(failures, 1) > 0 then
    raise exception E'PRESENCE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'PRESENCE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
