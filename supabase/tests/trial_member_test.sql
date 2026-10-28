-- =============================================================================
--  Trial member checks (20260143000000 / 20260143000100, docs/trial-members.md).
--
--  A trial member reads, edits and moves the tasks they own, suggests proposals and
--  reads the tool list (they can list a tool of their own, but not change any). Everything else needs a full member, and a trial member never
--  holds a role or heads a department.
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that
--  always ends by raising an exception, so Postgres rolls it all back.
--  Fixture people are new auth.users rows with @trial.test addresses.
--
--  Result: an "error" whose message begins with
--      TRIAL MEMBER CHECKS PASSED   or   TRIAL MEMBER CHECKS FAILED
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
  pre   uuid := gen_random_uuid();   -- president (an admin)
  hd    uuid := gen_random_uuid();   -- Head of a department
  nb    uuid := gen_random_uuid();   -- the trial member
  m1    uuid := gen_random_uuid();   -- active member
  season uuid;
  dept   text;
  other_dept text;
  clause text;
  ms     text := 'TRL-MS1';
  mine   uuid;
  theirs uuid;
  tool   uuid;
  p1     uuid;
  rev    int;
  err    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@trial.test'), (hd, 'hd@trial.test'), (nb, 'nb@trial.test'), (m1, 'm1@trial.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Tr President', 'Lead', 'active'), (hd, 'Tr Head', 'Chassis', 'active'),
    (nb, 'Tr Newbie', 'Chassis', 'trial'), (m1, 'Tr One', 'Chassis', 'active');
  insert into member_roles (member_id, role) values (pre, 'president');
  insert into seasons (label, is_current) values ('TRL-TEST', false) returning id into season;
  insert into milestones (key, season_id, ordinal, name) values (ms, season, 1, 'Trial milestone');
  select key into dept from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  select key into other_dept from subteams where archived_at is null and parent_key is null and key <> dept order by sort_order, key limit 1;
  update subteams set lead_id = hd where key = dept;
  select clause_key into clause from clauses order by clause_key limit 1;
  insert into tasks (season_id, title, owner_id, subteam_key, state, due_date)
    values (season, 'Newbie task', nb, dept, 'todo', current_date + 5) returning id into mine;
  insert into tasks (season_id, title, owner_id, subteam_key, state, due_date)
    values (season, 'Someone else''s task', m1, dept, 'todo', current_date + 5) returning id into theirs;

  -- ------------------------------------------------- a trial member keeps no authority
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member is not an active member', not exists (select 1 from members where id = nb and status = 'active'));

  begin
    insert into member_roles (member_id, role) values (nb, 'treasurer');
    err := 'accepted';
  exception when check_violation then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a trial member cannot be given a role', err = 'refused', err);

  begin
    update members set status = 'trial' where id = pre;
    err := 'accepted';
  exception when check_violation then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'someone who holds a role cannot be put on trial', err = 'refused', err);

  begin
    update members set status = 'trial' where id = hd;
    err := 'accepted';
  exception when check_violation then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a department Head cannot be put on trial', err = 'refused', err);

  begin
    update subteams set lead_id = nb where key = other_dept;
    err := 'accepted';
  exception when others then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a trial member cannot be made a Head', err = 'refused', err);

  -- ------------------------------------------------------------- reading
  perform pg_temp.as_user(nb);
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member reads the tasks', (select count(*) from tasks where season_id = season) = 2);
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member is a member for reading', is_member());

  -- --------------------------------------------------------------- own tasks
  update tasks set state = 'wip' where id = mine;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member moves their own task', (select state from tasks where id = mine) = 'wip');

  perform pg_temp.as_user(nb);
  update tasks set title = 'Renamed by newbie' where id = mine;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'and edits it', (select title from tasks where id = mine) = 'Renamed by newbie');

  perform pg_temp.as_user(nb);
  update tasks set state = 'wip' where id = theirs;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot move someone else''s task', (select state from tasks where id = theirs) = 'todo');

  perform pg_temp.as_user(nb);
  begin
    update tasks set owner_id = m1 where id = mine;
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot hand their task to someone else', err = 'refused', err);

  perform pg_temp.as_user(nb);
  begin
    perform create_task(season, 'Direct task', dept, nb, current_date + 7, null, '{}');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot create a task directly', err = 'refused', err);

  perform pg_temp.as_user(nb);
  begin
    perform archive_task(mine);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot archive a task', err = 'refused', err);

  -- a leader can give a trial member work
  perform pg_temp.as_user(hd);
  update tasks set owner_id = nb where id = theirs;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a Head can assign a task to a trial member', (select owner_id from tasks where id = theirs) = nb);
  perform pg_temp.as_user(hd);
  update tasks set owner_id = m1 where id = theirs;
  perform pg_temp.as_owner();

  -- ------------------------------------------------------------- proposals
  perform pg_temp.as_user(nb);
  select (submit_proposal(season, 'Newbie idea', dept, current_date + 30, ms, array[clause], 'why')).id into p1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member suggests a proposal', exists (select 1 from task_proposals where id = p1));

  perform pg_temp.as_user(nb);
  begin
    select revision into rev from task_proposals where id = p1;
    perform approve_and_promote(p1, season, rev, 'Approving my own proposal.');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot approve or promote a proposal', err = 'refused', err);

  -- ----------------------------------------------------------------- tools
  perform pg_temp.as_user(nb);
  insert into tools (item) values ('Newbie spanner') returning id into tool;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member lists a tool of their own', exists (select 1 from tools where id = tool and owner_id = nb));

  perform pg_temp.as_user(nb);
  update tools set location = 'home', held_by = nb where id = tool;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'but cannot change any tool afterwards, not even that one (a trial member reads the list)',
    exists (select 1 from tools where id = tool and location = 'workshop' and held_by is null));

  insert into tools (item, owner_id) values ('Handed jack', m1) returning id into tool;
  perform pg_temp.as_user(m1);
  update tools set held_by = nb where id = tool;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a full member can hand a tool to a trial member', exists (select 1 from tools where id = tool and held_by = nb));

  insert into tools (item, owner_id) values ('Club jack', m1) returning id into tool;
  perform pg_temp.as_user(nb);
  update tools set held_by = nb where id = tool;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot take a tool nobody has', exists (select 1 from tools where id = tool and held_by is null));

  -- ------------------------------------------- what stays closed (is_active_member)
  perform pg_temp.as_user(nb);
  begin
    insert into clause_status (clause_key, season_id, status) values (clause, season, 'done');
    err := 'accepted';
  exception when others then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot change a requirement''s status', err = 'refused', err);

  perform pg_temp.as_user(nb);
  begin
    perform add_task_dependency(mine, theirs);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot link tasks', err = 'refused', err);

  perform pg_temp.as_user(nb);
  begin
    insert into meetings (season_id, title, held_on) values (season, 'Newbie meeting', current_date);
    err := 'accepted';
  exception when others then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot call a meeting', err = 'refused', err);

  -- ------------------------------------------------------------ promotion
  perform pg_temp.as_user(nb);
  begin
    update members set status = 'active' where id = nb;
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a trial member cannot promote themselves',
    err = 'refused' and (select status from members where id = nb) = 'trial', err);

  perform pg_temp.as_user(pre);
  update members set status = 'active' where id = nb;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the President promotes a trial member to active', (select status from members where id = nb) = 'active');

  perform pg_temp.as_user(nb);
  begin
    perform create_task(season, 'Direct task', dept, nb, current_date + 7, null, '{}');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a promoted member is still not a leader (no new powers beyond a full member)', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'TRIAL MEMBER CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TRIAL MEMBER CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
