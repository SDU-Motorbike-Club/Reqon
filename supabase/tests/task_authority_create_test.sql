-- =============================================================================
--  Task authority and direct creation (20260142000000_task_authority_and_direct_create.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block
--  that always ends by raising an exception, so Postgres rolls it all back.
--  Fixture people are new auth.users rows with @leader.test addresses.
--
--  Result: an "error" whose message begins with
--      TASK AUTHORITY CHECKS PASSED   or   TASK AUTHORITY CHECKS FAILED
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

do $test$
declare
  pre  uuid := gen_random_uuid();   -- president
  hA   uuid := gen_random_uuid();   -- Head of department A
  hB   uuid := gen_random_uuid();   -- Head of department B
  tre  uuid := gen_random_uuid();   -- treasurer: not a leader
  m1   uuid := gen_random_uuid();   -- member, owns the task
  m2   uuid := gen_random_uuid();   -- member
  alum uuid := gen_random_uuid();   -- retired
  season uuid;
  other_season uuid;
  dA text; dB text; dArch text;
  ms text := 'AUT-MS1';
  ms_other text := 'AUT-MS2';
  clause text;
  t1 uuid; t2 uuid; t2b uuid; t2c uuid; p1 uuid;
  rev int;
  n int;
  err text;
  lines text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@leader.test'), (hA, 'ha@leader.test'), (hB, 'hb@leader.test'), (tre, 'tre@leader.test'),
    (m1, 'm1@leader.test'), (m2, 'm2@leader.test'), (alum, 'alum@leader.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Ld President', 'Lead', 'active'), (hA, 'Ld Head A', 'Chassis', 'active'), (hB, 'Ld Head B', 'Chassis', 'active'),
    (tre, 'Ld Treasurer', 'Ops', 'active'), (m1, 'Ld One', 'Chassis', 'active'), (m2, 'Ld Two', 'Chassis', 'active'),
    (alum, 'Ld Alumni', 'Chassis', 'alumni');
  insert into member_roles (member_id, role) values (pre, 'president'), (tre, 'treasurer');
  insert into seasons (label, is_current) values ('AUT-TEST', false) returning id into season;
  insert into seasons (label, is_current) values ('AUT-OTHER', false) returning id into other_season;
  insert into milestones (key, season_id, ordinal, name) values (ms, season, 1, 'Leader milestone'), (ms_other, other_season, 1, 'Other season');
  select key into dA from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  select key into dB from subteams where archived_at is null and parent_key is null and key <> dA order by sort_order, key limit 1;
  update subteams set lead_id = hA where key = dA;
  update subteams set lead_id = hB where key = dB;
  insert into subteams (key, name, sort_order, archived_at) values ('AUT_ARCH', 'Archived dept', 99, now()) returning key into dArch;
  select clause_key into clause from clauses order by clause_key limit 1;
  insert into tasks (season_id, title, owner_id, subteam_key, state, milestone_key, due_date)
    values (season, 'Owned by one', m1, dA, 'todo', null, current_date + 5) returning id into t1;

  -- ------------------------------------------------ who may edit a task
  perform pg_temp.as_user(m2);
  update tasks set title = 'Hijacked' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member cannot edit another member''s task', (select title from tasks where id = t1) = 'Owned by one');

  perform pg_temp.as_user(tre);
  update tasks set title = 'By the treasurer' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the Treasurer is not a leader and cannot edit it either', (select title from tasks where id = t1) = 'Owned by one');

  perform pg_temp.as_user(m1);
  update tasks set title = 'Mine, renamed' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the owner edits their own task', (select title from tasks where id = t1) = 'Mine, renamed');
  perform pg_temp.as_user(m1);
  begin
    update tasks set owner_id = m2 where id = t1;
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the owner cannot hand the task to someone else', err = 'refused', err);

  perform pg_temp.as_user(hB);
  update tasks set title = 'Edited by another department''s Head' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a Head edits a task of ANOTHER department',
    (select title from tasks where id = t1) = 'Edited by another department''s Head');
  perform pg_temp.as_user(hB);
  update tasks set owner_id = m2 where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'and reassigns its owner', (select owner_id from tasks where id = t1) = m2);
  perform pg_temp.as_user(pre);
  update tasks set priority = 'urgent' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the President edits any task', (select priority from tasks where id = t1) = 'urgent');

  -- ---------------------------------------------------- a Head's own proposal
  perform pg_temp.as_user(hA);
  select (submit_proposal(season, 'Head''s own idea', dA, current_date + 30, ms, array[clause], 'why')).id into p1;
  select revision into rev from task_proposals where id = p1;
  perform approve_and_promote(p1, season, rev, 'Approved by its own author, the Head.');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a Head approves and promotes their OWN proposal in their department',
    exists (select 1 from tasks where source_proposal = p1) and (select outcome from task_proposals where id = p1) = 'approved');

  -- ------------------------------------------------------ direct creation
  perform pg_temp.as_user(hB);
  select (create_task(season, '  Direct task  ', dA, m2, current_date + 10, ms, array[clause], 'detail', 'urgent')).id into t2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a Head creates a task in ANY department, with the title cleaned',
    exists (select 1 from tasks where id = t2 and title = 'Direct task' and subteam_key = dA and owner_id = m2
            and priority = 'urgent' and state = 'todo' and source_proposal is null and links_required));
  select * into lines, failures from pg_temp.note(lines, failures,
    'it carries its requirement, starts today and says who made it',
    exists (select 1 from task_requirements where task_id = t2 and clause_key = clause)
      and exists (select 1 from tasks where id = t2 and starts_on = (now() at time zone 'Europe/Copenhagen')::date and created_by = hB));
  -- Only a title and a deadline are required: no department, no start date, no owner, no milestone.
  perform pg_temp.as_user(hB);
  select (create_task(season, 'Title and deadline only', null, null, current_date + 6, null, '{}'::text[])).id into t2c;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a task needs only a title and a deadline: no department, no start date',
    exists (select 1 from tasks where id = t2c and subteam_key is null and owner_id is null
            and starts_on = (now() at time zone 'Europe/Copenhagen')::date and due_date = current_date + 6));
  begin
    perform pg_temp.as_user(hB);
    perform create_task(season, 'Bad department', 'NO_SUCH_DEPT', null, current_date + 6, null, '{}'::text[]);
    err := 'allowed';
  exception when check_violation then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a department that IS given must still be a real, active one', err = 'refused', err);

  -- A chosen start date: any day up to the deadline, never after it.
  perform pg_temp.as_user(hB);
  select (create_task(season, 'Early start', dA, m2, current_date + 10, ms, array[clause], null, 'normal', current_date - 20)).id into t2b;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a chosen start date is kept, even weeks from today',
    exists (select 1 from tasks where id = t2b and starts_on = current_date - 20));
  begin
    perform pg_temp.as_user(hB);
    perform create_task(season, 'Backwards', dA, m2, current_date + 10, ms, array[clause], null, 'normal', current_date + 11);
    err := 'allowed';
  exception when check_violation then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a start date after the deadline is refused', err = 'refused', err);
  select * into lines, failures from pg_temp.note(lines, failures,
    'it is logged as created, once',
    (select count(*) from activity where entity = 'task' and entity_id = t2::text and action = 'created') = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'its owner is told, and the creator is not',
    (select count(*) from notifications where member_id = m2 and kind = 'task_assigned' and entity_id = t2::text) = 1
      and (select count(*) from notifications where member_id = hB and entity_id = t2::text) = 0);

  perform pg_temp.as_user(m1);
  begin
    perform create_task(season, 'Sneaky', dA, m1, current_date + 10, ms, array[clause]);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot create a task directly', err = 'refused', err);
  perform pg_temp.as_user(tre);
  begin
    perform create_task(season, 'Sneaky', dA, m1, current_date + 10, ms, array[clause]);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nor can the Treasurer', err = 'refused', err);

  perform pg_temp.as_user(pre);
  select count(*) into n from tasks where season_id = season;
  begin perform create_task(season, 'No deadline', dA, m1, null, ms, array[clause]); err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a task with no deadline is refused', err = 'refused', err);
  begin perform create_task(season, 'Archived dept', dArch, m1, current_date + 10, ms, array[clause]); err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'an archived department is refused', err = 'refused', err);
  begin perform create_task(season, 'Wrong season', dA, m1, current_date + 10, ms_other, array[clause]); err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a milestone of another season is refused', err = 'refused', err);
  begin perform create_task(season, 'Retired owner', dA, alum, current_date + 10, ms, array[clause]); err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired owner is refused', err = 'refused', err);
  begin perform create_task(season, '   ', dA, m1, current_date + 10, ms, array[clause]); err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a blank title is refused', err = 'refused', err);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'every refusal left nothing behind', (select count(*) from tasks where season_id = season) = n);

  -- Milestone and requirements are optional: they can be added later on the task.
  perform pg_temp.as_user(pre);
  perform create_task(season, 'Bare task', dA, m1, current_date + 10, null, array[]::text[]);
  perform create_task(season, 'Milestone only', dA, m1, current_date + 10, ms, array[]::text[]);
  perform create_task(season, 'Requirement only', dA, m1, current_date + 10, null, array[clause]);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a task needs no milestone and no requirement at creation, and is not locked to what is missing',
    (select count(*) from tasks where title in ('Bare task', 'Milestone only', 'Requirement only') and not links_required) = 3
      and (select milestone_key from tasks where title = 'Milestone only') = ms
      and exists (select 1 from task_requirements r join tasks t on t.id = r.task_id where t.title = 'Requirement only'));
  select * into lines, failures from pg_temp.note(lines, failures,
    'with a milestone AND a requirement it keeps them, like a promoted task',
    (select links_required from tasks where id = t2));
  delete from tasks where title in ('Bare task', 'Milestone only', 'Requirement only', 'Early start', 'Title and deadline only');

  -- ---------------------------------------------------------- the list view
  perform pg_temp.as_user(m2);
  select count(*) into n from v_task_list where season_id = season;
  select * into lines, failures from pg_temp.note(lines, failures,
    'any member reads the task list with names',
    n = 3 and exists (select 1 from v_task_list where id = t2 and owner_name = 'Ld Two' and department_name is not null and milestone_name = 'Leader milestone'));
  perform pg_temp.as_user(null);
  begin perform 1 from v_task_list; err := 'readable'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'signed-out visitors cannot read it', err = 'refused', err);
  perform pg_temp.as_user(hA);
  begin perform is_task_leader(); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the leader helper is not callable through the API', err = 'refused', err);
  perform pg_temp.as_owner();

  if array_length(failures, 1) > 0 then
    raise exception E'TASK AUTHORITY CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TASK AUTHORITY CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
