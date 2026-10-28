-- =============================================================================
--  Weekly meeting, attendance and the club-wide notice (20260144000000_meeting_schedule_and_attendance.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @meetsched.test addresses; the fixture season is made current inside the block only.
--
--  Result: an "error" whose message begins with
--      MEETING SCHEDULE CHECKS PASSED   or   MEETING SCHEDULE CHECKS FAILED
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
  pre    uuid := gen_random_uuid();   -- president: is_admin(), may delete
  doc    uuid := gen_random_uuid();   -- documentation: edits meetings, is not an admin
  plain  uuid := gen_random_uuid();   -- an ordinary active member
  trial  uuid := gen_random_uuid();   -- on trial
  alum   uuid := gen_random_uuid();   -- retired
  hd     uuid := gen_random_uuid();   -- Head of a department
  season uuid;
  dept   text;
  today  date := (now() at time zone 'Europe/Copenhagen')::date;
  target date;
  m1     uuid;
  m2     uuid;
  m3     uuid;
  m4     uuid;
  n      int;
  rows_  int;
  err    text;
  tpl    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@meetsched.test'), (doc, 'doc@meetsched.test'), (plain, 'plain@meetsched.test'),
    (trial, 'trial@meetsched.test'), (alum, 'alum@meetsched.test'), (hd, 'hd@meetsched.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Ms President', 'Lead', 'active'), (doc, 'Ms Docs', 'Software', 'active'),
    (plain, 'Ms Plain', 'Software', 'active'), (trial, 'Ms Trial', 'Software', 'trial'),
    (alum, 'Ms Alumni', 'Software', 'alumni'), (hd, 'Ms Head', 'Chassis', 'active');
  insert into member_roles (member_id, role) values (pre, 'president'), (doc, 'documentation');
  select key into dept from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  update subteams set lead_id = hd where key = dept;
  update seasons set is_current = false where is_current;
  insert into seasons (label, is_current) values ('MS-TEST', true) returning id into season;
  select body into tpl from meeting_template where id;

  -- 1. The seeded schedule is the one the club asked for.
  select * into lines, failures from pg_temp.note(lines, failures,
    'the seeded schedule is Tuesday 16:30, 7 days ahead, in the club''s zone',
    (select weekday = 2 and starts_at = '16:30' and lead_days = 7 and enabled and timezone = 'Europe/Copenhagen'
       from meeting_schedule where id));

  -- 2. Who may change it.
  perform pg_temp.as_user(pre);
  update meeting_schedule set title = 'Weekly meeting', location = 'Workshop', weekday = extract(isodow from today + 3)::int where id;
  get diagnostics rows_ = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'the President changes the schedule', rows_ = 1);
  perform pg_temp.as_user(doc);
  update meeting_schedule set title = 'Docs edit' where id;
  get diagnostics rows_ = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'documentation, who edits meetings but is no admin, cannot change the schedule', rows_ = 0);
  perform pg_temp.as_user(plain);
  update meeting_schedule set title = 'Plain edit' where id;
  get diagnostics rows_ = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot change the schedule', rows_ = 0);
  begin
    perform pg_temp.as_user(pre);
    update meeting_schedule set timezone = 'UTC' where id;
    err := 'allowed';
  exception when insufficient_privilege then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody changes the time zone through the API', err = 'refused', err);
  perform pg_temp.as_user(plain);
  select count(*) into n from meeting_schedule;
  select * into lines, failures from pg_temp.note(lines, failures, 'every member reads the schedule', n = 1);
  perform pg_temp.as_owner();

  -- 3. The job makes the one meeting inside the lead time, from the template.
  target := today + 3;
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'the job makes exactly one meeting', n = 1, n::text);
  select id into m1 from meetings where occurrence_date = target;
  select * into lines, failures from pg_temp.note(lines, failures,
    'it has the schedule''s title, time, place and the default agenda, in the current season',
    (select title = 'Weekly meeting' and held_on = target and starts_at = '16:30' and location = 'Workshop'
            and season_id = season and subteam_key is null and created_by is null
            and agenda is not distinct from nullif(tpl, '')
       from meetings where id = m1));

  -- 4. Running it again changes nothing.
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'a second run makes nothing', n = 0, n::text);
  select * into lines, failures from pg_temp.note(lines, failures, 'still one meeting for that occurrence',
    (select count(*) from meetings where occurrence_date = target) = 1);

  -- 5. Everyone active or on trial is told once; the retired are not.
  select * into lines, failures from pg_temp.note(lines, failures, 'an active member is told once', pg_temp.told(plain, m1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'a trial member is told once', pg_temp.told(trial, m1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'a Head and the President are told too (the job is nobody)', pg_temp.told(hd, m1::text) = 1 and pg_temp.told(pre, m1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member is not told', pg_temp.told(alum, m1::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures, 'the title is copied into the notice',
    exists (select 1 from notifications where member_id = plain and entity_id = m1::text and title = 'Weekly meeting'));

  -- 6. Moving it to another day does not bring a second one.
  perform pg_temp.as_user(pre);
  update meetings set held_on = target + 1 where id = m1;
  perform pg_temp.as_owner();
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'a moved meeting is not made again', n = 0 and (select count(*) from meetings where occurrence_date = target) = 1);
  begin
    perform pg_temp.as_user(pre);
    update meetings set occurrence_date = null where id = m1;
    err := 'allowed';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the occurrence key cannot be changed through the API', err = 'refused', err);

  -- 7. A schedule change leaves a meeting that already exists alone.
  perform pg_temp.as_user(pre);
  update meeting_schedule set title = 'Renamed', starts_at = '18:00' where id;
  perform pg_temp.as_owner();
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'a changed schedule does not rewrite or duplicate the existing meeting',
    n = 0 and (select title = 'Weekly meeting' and starts_at = '16:30' from meetings where id = m1));
  update meeting_schedule set title = 'Weekly meeting', starts_at = '16:30' where id;

  -- 8. Deleting it records a skip, and it stays gone.
  perform pg_temp.as_user(pre);
  delete from meetings where id = m1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'deleting an automatic meeting records its occurrence as skipped',
    exists (select 1 from meeting_skips where occurrence_date = target));
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'a deleted meeting is not made again', n = 0 and not exists (select 1 from meetings where occurrence_date = target));

  -- 9. Skips: who may add and remove them; removing one brings the meeting back.
  perform pg_temp.as_user(plain);
  begin
    insert into meeting_skips (occurrence_date) values (target + 70);
    err := 'allowed';
  exception when others then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot skip a week', err = 'refused', err);
  perform pg_temp.as_user(pre);
  insert into meeting_skips (occurrence_date, reason) values (target + 70, 'Holiday');
  delete from meeting_skips where occurrence_date = target;
  perform pg_temp.as_owner();
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'an admin skips a week, and removing a skip brings the meeting back',
    n = 1 and exists (select 1 from meeting_skips where occurrence_date = target + 70) and exists (select 1 from meetings where occurrence_date = target));
  select id into m1 from meetings where occurrence_date = target;

  -- 10. What Settings shows comes from the same function.
  perform pg_temp.as_user(plain);
  select count(*), min(status) filter (where occurrence_date = target) into n, err from upcoming_meeting_occurrences(6);
  select * into lines, failures from pg_temp.note(lines, failures, 'a member sees six occurrences, the first already created', n = 6 and err = 'created', n || ' / ' || coalesce(err, '-'));
  perform pg_temp.as_user(null);
  begin
    perform * from upcoming_meeting_occurrences(3);
    err := 'allowed';
  exception when others then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody signed out sees the schedule', err = 'refused', err);

  -- 11. Switched off, it makes nothing.
  perform pg_temp.as_user(pre);
  update meeting_schedule set enabled = false where id;
  perform pg_temp.as_owner();
  delete from meetings where id = m1;
  delete from meeting_skips where occurrence_date = target;
  select create_scheduled_meetings() into n;
  select * into lines, failures from pg_temp.note(lines, failures, 'a schedule that is switched off makes no meeting', n = 0);
  update meeting_schedule set enabled = true where id;

  -- 12. A meeting called by hand for the whole club tells everyone but its author; for a department, only it.
  perform pg_temp.as_user(pre);
  insert into meetings (season_id, title, held_on, created_by) values (season, 'Everyone', today + 2, pre) returning id into m2;
  insert into meetings (season_id, title, held_on, subteam_key, created_by) values (season, 'Only the department', today + 2, dept, pre) returning id into m3;
  insert into meetings (season_id, title, held_on, created_by) values (season, 'Write-up', today - 5, pre) returning id into m4;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a club-wide meeting tells active and trial members',
    pg_temp.told(plain, m2::text) = 1 and pg_temp.told(trial, m2::text) = 1 and pg_temp.told(doc, m2::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'it does not tell its author or a retired member', pg_temp.told(pre, m2::text) = 0 and pg_temp.told(alum, m2::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures, 'it writes exactly one audit row', (select count(*) from activity where entity = 'meeting' and entity_id = m2::text and action = 'called') = 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'a department meeting still tells only its department (the Head), not everyone',
    pg_temp.told(hd, m3::text) = 1 and pg_temp.told(plain, m3::text) = 0 and pg_temp.told(trial, m3::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures, 'a meeting dated in the past tells nobody',
    not exists (select 1 from notifications where entity_id = m4::text));

  -- 13. Attendance.
  perform pg_temp.as_user(doc);
  perform set_meeting_attendees(m2, array[plain, trial, hd]);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'documentation records who came',
    (select count(*) from meeting_attendees where meeting_id = m2) = 3);
  perform pg_temp.as_user(pre);
  perform set_meeting_attendees(m2, array[plain, doc]);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a second save replaces the list (two stay, one added, two removed)',
    (select array_agg(member_id order by member_id) from meeting_attendees where meeting_id = m2) = (select array_agg(x order by x) from unnest(array[plain, doc]) x));
  perform pg_temp.as_user(plain);
  begin
    perform set_meeting_attendees(m2, array[plain]);
    err := 'allowed';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot record attendance', err = 'refused', err);
  perform pg_temp.as_user(plain);
  select count(*) into n from meeting_attendees where meeting_id = m2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'every member reads who came', n = 2, n::text);
  perform pg_temp.as_user(plain);
  begin
    insert into meeting_attendees (meeting_id, member_id) values (m2, hd);
    err := 'allowed';
  exception when others then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the list cannot be written around the function', err = 'refused', err);
  perform pg_temp.as_user(pre);
  begin
    perform set_meeting_attendees(gen_random_uuid(), array[plain]);
    err := 'allowed';
  exception when sqlstate 'P0002' then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a meeting that does not exist is reported', err = 'refused', err);
  delete from meetings where id = m2;
  select * into lines, failures from pg_temp.note(lines, failures, 'deleting a meeting takes its attendance with it',
    (select count(*) from meeting_attendees where meeting_id = m2) = 0);

  -- 14. The job and its helpers are not for the API.
  perform pg_temp.as_user(pre);
  begin
    perform create_scheduled_meetings();
    err := 'callable';
  exception when insufficient_privilege then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the job is not callable through the API', err = 'refused', err);
  begin
    perform notify_club_meeting();
    err := 'callable';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the notice function is not callable through the API', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'MEETING SCHEDULE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'MEETING SCHEDULE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
