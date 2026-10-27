-- =============================================================================
--  Meeting-for-a-department checks (20260140000000_meeting_department.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block
--  that always ends by raising an exception, so Postgres rolls it all back.
--  Fixture people are new auth.users rows with @meetdept.test addresses.
--
--  Result: an "error" whose message begins with
--      MEETING DEPARTMENT CHECKS PASSED   or   MEETING DEPARTMENT CHECKS FAILED
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
    perform set_config('request.jwt.claims',
      json_build_object('sub', who, 'role', 'authenticated')::text, true);
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

create or replace function pg_temp.told(who uuid, ent text) returns int
language sql as $fn$
  select count(*)::int from notifications where member_id = who and kind = 'meeting_called' and entity_id = ent;
$fn$;

do $test$
declare
  pre    uuid := gen_random_uuid();   -- president: calls the meetings
  hd     uuid := gen_random_uuid();   -- Head of the department
  mem    uuid := gen_random_uuid();   -- on the department this season
  mem2   uuid := gen_random_uuid();   -- on the department, but retired
  other  uuid := gen_random_uuid();   -- not on it
  plain  uuid := gen_random_uuid();   -- an ordinary member
  season uuid;
  dept   text;
  dept2  text;
  m1     uuid;
  m2     uuid;
  m3     uuid;
  m4     uuid;
  n      int;
  err    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@meetdept.test'), (hd, 'hd@meetdept.test'), (mem, 'mem@meetdept.test'),
    (mem2, 'mem2@meetdept.test'), (other, 'other@meetdept.test'), (plain, 'plain@meetdept.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Md President', 'Lead', 'active'), (hd, 'Md Head', 'Chassis', 'active'),
    (mem, 'Md Member', 'Chassis', 'active'), (mem2, 'Md Alumni', 'Chassis', 'alumni'),
    (other, 'Md Other', 'Software', 'active'), (plain, 'Md Plain', 'Software', 'active');
  insert into member_roles (member_id, role) values (pre, 'president');
  insert into seasons (label, is_current) values ('MD-TEST', false) returning id into season;
  select key into dept from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  select key into dept2 from subteams where archived_at is null and parent_key is null and key <> dept order by sort_order, key limit 1;
  update subteams set lead_id = hd where key = dept;
  insert into department_members (season_id, subteam_key, member_id) values
    (season, dept, mem), (season, dept, mem2);

  -- 1. A meeting called for a department tells that department.
  perform pg_temp.as_user(pre);
  insert into meetings (season_id, title, held_on, subteam_key)
    values (season, 'Chassis sync', current_date + 3, dept) returning id into m1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member of the department is told', pg_temp.told(mem, m1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the department''s Head is told', pg_temp.told(hd, m1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the person who called it is not told', pg_temp.told(pre, m1::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures,
    'someone outside the department is not told', pg_temp.told(other, m1::text) + pg_temp.told(plain, m1::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures,
    'a retired member of the department is not told', pg_temp.told(mem2, m1::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the title is copied in', exists (select 1 from notifications where member_id = mem and title = 'Chassis sync'));
  select * into lines, failures from pg_temp.note(lines, failures,
    'exactly one audit row says it was called',
    (select count(*) from activity where entity = 'meeting' and entity_id = m1::text and action = 'called') = 1);

  -- 2. Editing something else about it tells nobody again.
  perform pg_temp.as_user(pre);
  update meetings set location = 'Workshop' where id = m1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'changing the place is not a new call', pg_temp.told(mem, m1::text) = 1);

  -- 3. A club-wide meeting is logged nowhere and tells nobody.
  perform pg_temp.as_user(pre);
  insert into meetings (season_id, title, held_on) values (season, 'Everyone', current_date + 3) returning id into m2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a meeting with no department writes no audit row and no notification',
    not exists (select 1 from activity where entity = 'meeting' and entity_id = m2::text)
      and not exists (select 1 from notifications where entity = 'meeting' and entity_id = m2::text));

  -- 4. Choosing the department afterwards calls it then.
  perform pg_temp.as_user(pre);
  update meetings set subteam_key = dept where id = m2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'adding a department later tells that department', pg_temp.told(mem, m2::text) = 1 and pg_temp.told(hd, m2::text) = 1);
  perform pg_temp.as_user(pre);
  update meetings set subteam_key = dept2 where id = m2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'moving it to another department does not repeat the first one''s notice',
    pg_temp.told(mem, m2::text) = 1);

  -- 5. A meeting already in the past is a record, not a call.
  perform pg_temp.as_user(pre);
  insert into meetings (season_id, title, held_on, subteam_key)
    values (season, 'Last week', current_date - 7, dept) returning id into m3;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a past meeting is logged but tells nobody',
    exists (select 1 from activity where entity = 'meeting' and entity_id = m3::text and action = 'called')
      and pg_temp.told(mem, m3::text) + pg_temp.told(hd, m3::text) = 0);

  -- 6. Today still counts as upcoming.
  perform pg_temp.as_user(pre);
  insert into meetings (season_id, title, held_on, subteam_key)
    values (season, 'Tonight', current_date, dept) returning id into m4;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a meeting today still tells the department', pg_temp.told(mem, m4::text) = 1);

  -- 7. The department must exist; an ordinary member cannot call a meeting.
  perform pg_temp.as_user(pre);
  begin
    insert into meetings (season_id, title, held_on, subteam_key) values (season, 'Ghost', current_date + 1, 'no-such-dept');
    err := 'accepted';
  exception when foreign_key_violation then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an unknown department is refused', err = 'refused', err);
  perform pg_temp.as_user(plain);
  begin
    insert into meetings (season_id, title, held_on, subteam_key) values (season, 'Sneaky', current_date + 1, dept);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot call a meeting', err = 'refused', err);

  -- 8. The members' inbox shows only their own.
  perform pg_temp.as_user(mem);
  select count(*) into n from notifications where kind = 'meeting_called';
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member reads only their own meeting notices (3 for them: m1, m2, m4)', n = 3, n::text);

  -- 9. Nobody can call the trigger functions from the API.
  perform pg_temp.as_user(pre);
  begin
    perform log_meeting_department();
    err := 'callable';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the audit function is not callable through the API', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'MEETING DEPARTMENT CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'MEETING DEPARTMENT CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
