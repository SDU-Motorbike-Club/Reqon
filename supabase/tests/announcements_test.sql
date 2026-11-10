-- =============================================================================
--  Announcements (20260155000000_announcements.sql): send_announcement() and the
--  announcements table.
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @announcetest.test addresses. The expected number of recipients is counted from the database,
--  because a real project already has members of its own.
--
--  Result: an "error" whose message begins with
--      ANNOUNCEMENT CHECKS PASSED   or   ANNOUNCEMENT CHECKS FAILED
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
  vp    uuid := gen_random_uuid();   -- Vice President (may announce)
  mem   uuid := gen_random_uuid();   -- ordinary active member
  mem2  uuid := gen_random_uuid();   -- another ordinary active member
  tri   uuid := gen_random_uuid();   -- on trial
  old   uuid := gen_random_uuid();   -- retired
  n         int;
  expected  int;
  reached   int;
  ann_id    bigint;
  err       text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (vp, 'vp@announcetest.test'), (mem, 'mem@announcetest.test'), (mem2, 'mem2@announcetest.test'),
    (tri, 'tri@announcetest.test'), (old, 'old@announcetest.test');
  insert into members (id, full_name, role, status) values
    (vp, 'Ann VP', 'Management', 'active'), (mem, 'Ann Member', 'Software', 'active'),
    (mem2, 'Ann Member Two', 'Software', 'active'), (tri, 'Ann Trial', 'Software', 'trial'),
    (old, 'Ann Old', 'Software', 'alumni');
  insert into member_roles (member_id, role) values (vp, 'vicepresident');

  -- 1. Who may send
  perform pg_temp.as_user(mem);
  begin perform send_announcement('Hello', 'Hello everyone'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot announce', err = 'refused', err);

  perform pg_temp.as_user(null);
  begin perform send_announcement('Hello', 'Hello everyone'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody signed out can announce', err = 'refused', err);

  select count(*) into n from announcements;
  select * into lines, failures from pg_temp.note(lines, failures, 'the refused attempts left nothing behind', n = 0, n::text);

  -- 2. A leader sends: the record, and one inbox row per active or trial member except the author
  select count(*) into expected from members where status in ('active', 'trial') and id <> vp;
  perform pg_temp.as_user(vp);
  reached := send_announcement('  Workshop closed  ', '  Back on Monday.  ');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'it reports how many people it reached', reached = expected, format('%s of %s', reached, expected));
  select id into ann_id from announcements where author_id = vp;
  select * into lines, failures from pg_temp.note(lines, failures, 'the announcement is recorded, trimmed, with its title and author', ann_id is not null
    and exists (select 1 from announcements where id = ann_id and title = 'Workshop closed' and body = 'Back on Monday.'));
  select * into lines, failures from pg_temp.note(lines, failures, 'every active and trial member got exactly one inbox row, and the author one more',
    (select count(*) from notifications where kind = 'announcement' and entity_id = ann_id::text) = expected + 1
    and exists (select 1 from notifications where member_id = mem and kind = 'announcement')
    and exists (select 1 from notifications where member_id = mem2 and kind = 'announcement')
    and exists (select 1 from notifications where member_id = tri and kind = 'announcement'));
  select * into lines, failures from pg_temp.note(lines, failures, 'the author has a copy that is already read, and the retired member got none',
    exists (select 1 from notifications where kind = 'announcement' and member_id = vp and read_at is not null)
    and not exists (select 1 from notifications where kind = 'announcement' and member_id = old));
  select * into lines, failures from pg_temp.note(lines, failures, 'each row names the author, carries the title and text, is unread and has no activity row',
    not exists (select 1 from notifications where kind = 'announcement' and entity_id = ann_id::text
                and member_id <> vp
                and (actor_id is distinct from vp or title is distinct from 'Workshop closed'
                     or body is distinct from 'Back on Monday.' or read_at is not null
                     or activity_id is not null or entity <> 'announcement')));

  -- 3. Each person reads their own row
  perform pg_temp.as_user(mem);
  select count(*) into n from notifications where kind = 'announcement';
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member sees their own copy only', n = 1, n::text);

  -- 4. The history
  perform pg_temp.as_user(mem);
  select count(*) into n from announcements;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an active member reads the history', n = 1, n::text);

  perform pg_temp.as_user(tri);
  select count(*) into n from announcements;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member on trial reads it too', n = 1, n::text);

  perform pg_temp.as_user(old);
  select count(*) into n from announcements;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member reads nothing', n = 0, n::text);

  perform pg_temp.as_user(null);
  begin select count(*) into n from announcements; err := 'readable'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'someone signed out cannot read it', err = 'refused', err);

  -- 5. Nobody writes around the function, not even a leader
  perform pg_temp.as_user(vp);
  begin insert into announcements (author_id, body) values (vp, 'Sneaked in'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a leader cannot insert into the table directly', err = 'refused', err);

  perform pg_temp.as_user(vp);
  begin update announcements set body = 'Rewritten'; err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'and cannot rewrite one', err = 'refused', err);

  begin
    insert into notifications (member_id, kind, entity, entity_id) values (mem, 'announcement', 'announcement', '1');
    err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'an inbox row of this kind cannot exist without text', err = 'refused', err);

  -- 6. The text
  perform pg_temp.as_user(vp);
  begin perform send_announcement('Title', '   '); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a blank description is refused', err = 'refused', err);

  perform pg_temp.as_user(vp);
  begin perform send_announcement('   ', 'Some text'); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a blank title is refused', err = 'refused', err);

  perform pg_temp.as_user(vp);
  begin perform send_announcement(repeat('x', 101), 'Some text'); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a title of 101 characters is refused', err = 'refused', err);

  perform pg_temp.as_user(vp);
  begin perform send_announcement('Title', repeat('x', 1001)); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a description of 1001 characters is refused', err = 'refused', err);

  -- 7. Flooding: 5 an hour per author (one is already sent)
  perform pg_temp.as_user(vp);
  for i in 2..5 loop
    perform send_announcement('Title ' || i, 'Announcement ' || i);
  end loop;
  begin perform send_announcement('Sixth', 'The sixth'); err := 'accepted'; exception when program_limit_exceeded then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the sixth announcement in an hour is refused', err = 'refused', err);

  -- 8. Removing the author keeps what they said
  delete from members where id = vp;
  select * into lines, failures from pg_temp.note(lines, failures, 'removing the author leaves the announcements, without a name',
    (select count(*) from announcements) = 5 and not exists (select 1 from announcements where author_id is not null));

  -- 9. Not for the API to call unauthenticated
  perform pg_temp.as_user(null);
  begin perform send_announcement('Hi', 'Hi'); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'send_announcement is not callable without signing in', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'ANNOUNCEMENT CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'ANNOUNCEMENT CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
