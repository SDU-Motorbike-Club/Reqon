-- =============================================================================
--  Bug reports (20260150000000_bug_reports.sql): any member adds one, only a Developer reads,
--  resolves or deletes, and one member cannot flood the table.
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @bugrep.test addresses.
--
--  Result: an "error" whose message begins with
--      BUG REPORT CHECKS PASSED   or   BUG REPORT CHECKS FAILED
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
  dev   uuid := gen_random_uuid();   -- a Developer
  mem   uuid := gen_random_uuid();   -- an ordinary member
  other uuid := gen_random_uuid();   -- another ordinary member
  trial uuid := gen_random_uuid();   -- a member on trial
  r1    uuid;
  r2    uuid;
  n     int;
  err   text;
  rows_ int;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (dev, 'dev@bugrep.test'), (mem, 'mem@bugrep.test'), (other, 'other@bugrep.test'), (trial, 'trial@bugrep.test');
  insert into members (id, full_name, role, status) values
    (dev, 'Bug Dev', 'Software', 'active'), (mem, 'Bug Member', 'Software', 'active'),
    (other, 'Bug Other', 'Software', 'active'), (trial, 'Bug Trial', 'Software', 'trial');
  insert into member_roles (member_id, role) values (dev, 'developer');

  -- 1. Reporting
  perform pg_temp.as_user(mem);
  -- No RETURNING: a member may add a report but not read one back, so the app never asks for the row.
  insert into bug_reports (source, message, page, user_agent) values ('manual', 'The board froze', '/board', 'Firefox');
  perform pg_temp.as_owner();
  select id into r1 from bug_reports where reported_by = mem and message = 'The board froze';
  select * into lines, failures from pg_temp.note(lines, failures, 'a member reports a bug, in their own name',
    exists (select 1 from bug_reports where id = r1 and reported_by = mem and status = 'open' and source = 'manual'));

  perform pg_temp.as_user(trial);
  insert into bug_reports (source, details) values ('error', 'TypeError: x is undefined');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member on trial can report too, with only the error text',
    exists (select 1 from bug_reports where reported_by = trial and details = 'TypeError: x is undefined'));

  begin
    perform pg_temp.as_user(mem);
    insert into bug_reports (source, message, reported_by) values ('manual', 'Pretending to be someone', other);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody reports in another member''s name', err = 'refused', err);

  begin
    perform pg_temp.as_user(mem);
    insert into bug_reports (source, message) values ('manual', '   ');
    err := 'accepted';
  exception when check_violation then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a report with no text and no error is refused', err = 'refused', err);

  begin
    perform pg_temp.as_user(mem);
    insert into bug_reports (source, message) values ('manual', repeat('x', 2001));
    err := 'accepted';
  exception when check_violation then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a report over 2000 characters is refused', err = 'refused', err);

  begin
    perform pg_temp.as_user(mem);
    insert into bug_reports (source, message, status) values ('manual', 'Closing my own', 'done');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot set the status when reporting', err = 'refused', err);

  begin
    perform pg_temp.as_user(null);
    insert into bug_reports (source, message) values ('manual', 'Anonymous');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'someone not signed in cannot report', err = 'refused', err);

  -- 2. Reading
  perform pg_temp.as_user(mem);
  begin select count(*) into n from bug_reports; exception when others then n := -1; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member sees no reports, not even their own', n = 0, 'saw ' || n);

  perform pg_temp.as_user(dev);
  select count(*) into n from bug_reports;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a Developer sees every report', n = 2, 'saw ' || n);

  -- 3. Triage
  perform pg_temp.as_user(mem);
  update bug_reports set status = 'done' where id = r1;
  get diagnostics rows_ = row_count;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot mark a report done', rows_ = 0);

  perform pg_temp.as_user(dev);
  update bug_reports set status = 'done' where id = r1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a Developer marks it done: who and when are stamped',
    exists (select 1 from bug_reports where id = r1 and status = 'done' and resolved_by = dev and resolved_at is not null));

  perform pg_temp.as_user(dev);
  update bug_reports set status = 'open' where id = r1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'reopening clears them',
    exists (select 1 from bug_reports where id = r1 and status = 'open' and resolved_by is null and resolved_at is null));

  begin
    perform pg_temp.as_user(dev);
    update bug_reports set message = 'Rewritten' where id = r1;
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'even a Developer cannot rewrite what was reported', err = 'refused', err);

  perform pg_temp.as_user(mem);
  delete from bug_reports where id = r1;
  get diagnostics rows_ = row_count;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot delete a report', rows_ = 0);

  perform pg_temp.as_user(dev);
  delete from bug_reports where id = r1;
  get diagnostics rows_ = row_count;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a Developer deletes one', rows_ = 1);

  -- 4. Flooding: 20 an hour per member, counted per member
  perform pg_temp.as_user(other);
  for i in 1..20 loop
    insert into bug_reports (source, message) values ('manual', 'Report ' || i);
  end loop;
  begin
    insert into bug_reports (source, message) values ('manual', 'The 21st');
    err := 'accepted';
  exception when program_limit_exceeded then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the 21st report in an hour is refused', err = 'refused', err);

  perform pg_temp.as_user(mem);
  insert into bug_reports (source, message) values ('manual', 'Someone else is unaffected');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'one member''s limit does not block another',
    exists (select 1 from bug_reports where reported_by = mem and message = 'Someone else is unaffected'));

  -- 5. The trigger functions are not for the API
  perform pg_temp.as_user(mem);
  begin perform limit_bug_reports(); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the limit function is not callable through the API', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'BUG REPORT CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'BUG REPORT CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
