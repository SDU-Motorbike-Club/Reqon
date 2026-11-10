-- =============================================================================
--  Usernames (20260160000000_member_username.sql): members.username and set_my_username().
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @usernametest.test addresses.
--
--  Result: an "error" whose message begins with
--      USERNAME CHECKS PASSED   or   USERNAME CHECKS FAILED
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
  got  text;
  stored text;
  err  text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (a, 'a@usernametest.test'), (b, 'b@usernametest.test'), (old, 'old@usernametest.test');
  insert into members (id, full_name, role, status) values
    (a, 'User A', 'Software', 'active'), (b, 'User B', 'Software', 'active'), (old, 'User Old', 'Software', 'alumni');

  -- 1. A member sets their own, trimmed and lower-cased
  perform pg_temp.as_user(a);
  got := set_my_username('  Ada.Rider  ');
  perform pg_temp.as_owner();
  select username into stored from members where id = a;
  select * into lines, failures from pg_temp.note(lines, failures, 'a member sets their own username, trimmed and lower case',
    got = 'ada.rider' and stored = 'ada.rider', format('%s / %s', got, stored));

  -- 2. Nobody else's row changes
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody else gets a username',
    not exists (select 1 from members where id <> a and username is not null and id in (b, old)));

  -- 3. Taken, whatever the case
  perform pg_temp.as_user(b);
  begin perform set_my_username('ADA.RIDER'); err := 'accepted'; exception when unique_violation then err := 'taken'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a name that is taken is refused, case does not matter', err = 'taken', err);

  -- 4. Format
  perform pg_temp.as_user(b);
  err := 'accepted';
  begin perform set_my_username('ab'); exception when invalid_parameter_value then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'two characters are too short', err = 'refused', err);
  err := 'accepted';
  begin perform set_my_username('has space'); exception when invalid_parameter_value then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a space is refused', err = 'refused', err);
  err := 'accepted';
  begin perform set_my_username('me@club.test'); exception when invalid_parameter_value then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'an @ is refused, so a username never looks like an e-mail', err = 'refused', err);
  err := 'accepted';
  begin perform set_my_username('-leading'); exception when invalid_parameter_value then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'it must start with a letter or digit', err = 'refused', err);
  perform pg_temp.as_owner();

  -- 5. Clearing
  perform pg_temp.as_user(a);
  got := set_my_username('   ');
  perform pg_temp.as_owner();
  select username into stored from members where id = a;
  select * into lines, failures from pg_temp.note(lines, failures, 'an empty value clears it', got is null and stored is null, coalesce(got, 'null'));

  -- 6. Who may
  perform pg_temp.as_user(old);
  begin perform set_my_username('retired.one'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot set one', err = 'refused', err);

  perform pg_temp.as_user(null);
  begin perform set_my_username('nobody'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'set_my_username is not callable without signing in', err = 'refused', err);

  -- 7. The table itself refuses a bad name, even for the owner
  begin update members set username = 'Not Allowed' where id = b; err := 'accepted'; exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the table refuses a malformed username', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'USERNAME CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'USERNAME CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
