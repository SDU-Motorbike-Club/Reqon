-- =============================================================================
--  Team page checks (20260141000000_team_tools.sql): a tool has an OWNER, a LOCATION
--  (where it is) and a HOLDER (who has it).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block
--  that always ends by raising an exception, so Postgres rolls it all back.
--  Fixture people are new auth.users rows with @team.test addresses.
--
--  Result: an "error" whose message begins with
--      TEAM PAGE CHECKS PASSED   or   TEAM PAGE CHECKS FAILED
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
  m1    uuid := gen_random_uuid();   -- active member
  m2    uuid := gen_random_uuid();   -- active member
  m3    uuid := gen_random_uuid();   -- active member
  alum  uuid := gen_random_uuid();   -- retired member
  t1    uuid;
  t2    uuid;
  err   text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@team.test'), (m1, 'm1@team.test'), (m2, 'm2@team.test'), (m3, 'm3@team.test'), (alum, 'alum@team.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Tm President', 'Lead', 'active'), (m1, 'Tm One', 'Chassis', 'active'),
    (m2, 'Tm Two', 'Chassis', 'active'), (m3, 'Tm Three', 'Chassis', 'active'), (alum, 'Tm Alumni', 'Chassis', 'alumni');
  insert into member_roles (member_id, role) values (pre, 'president');

  -- ---------------------------------------------------------- listing a tool
  perform pg_temp.as_user(m1);
  insert into tools (item) values ('Torque wrench') returning id into t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a new tool is the member''s own, in the workshop, and nobody has it',
    exists (select 1 from tools where id = t1 and owner_id = m1 and location = 'workshop' and held_by is null));

  perform pg_temp.as_user(m2);
  begin
    insert into tools (item, owner_id) values ('Stolen listing', m1);
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused';
  end;
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody lists a tool in another member''s name', err = 'refused', err);
  select * into lines, failures from pg_temp.note(lines, failures, 'every member reads the list', (select count(*) from tools) = 1);

  -- ------------------------------------------------ two separate facts to change
  perform pg_temp.as_user(m1);
  update tools set location = 'home', held_by = m1 where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the owner says where it is and that they have it',
    exists (select 1 from tools where id = t1 and location = 'home' and held_by = m1));
  perform pg_temp.as_user(m1);
  begin update tools set location = 'moon' where id = t1; err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a made-up place is refused', err = 'refused', err);
  begin update tools set held_by = alum where id = t1; err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot be the one who has it', err = 'refused', err);
  begin update tools set owner_id = m2 where id = t1; err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the owner of a tool can never be changed', err = 'refused', err);

  -- ---------------------------------------------- someone else, while m1 has it
  perform pg_temp.as_user(m2);
  begin update tools set location = 'workshop' where id = t1; err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'another member cannot move a tool someone else has', err = 'refused', err);
  begin update tools set held_by = m2 where id = t1; err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'nor take it while someone has it', err = 'refused', err);
  delete from tools where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nor remove it', exists (select 1 from tools where id = t1));

  -- --------------------------------------------- handing it back, then taking it
  perform pg_temp.as_user(m1);
  update tools set location = 'workshop', held_by = null where id = t1;
  perform pg_temp.as_user(m2);
  update tools set held_by = m2 where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the owner puts it back (nobody has it) and another member takes it',
    exists (select 1 from tools where id = t1 and held_by = m2 and location = 'workshop'));
  perform pg_temp.as_user(m3);
  begin update tools set held_by = m3 where id = t1; err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a third member cannot take what m2 now has', err = 'refused', err);
  perform pg_temp.as_user(m2);
  update tools set location = 'university', held_by = m3 where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'whoever has it says where it is and hands it on',
    exists (select 1 from tools where id = t1 and location = 'university' and held_by = m3));
  perform pg_temp.as_user(m3);
  begin update tools set item = 'Renamed by the holder' where id = t1; err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the holder cannot rename it', err = 'refused', err);
  perform pg_temp.as_user(m1);
  update tools set item = 'Torque wrench 3/8' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the owner renames it', exists (select 1 from tools where id = t1 and item = 'Torque wrench 3/8'));

  -- ----------------------------------------------------------------- an admin
  perform pg_temp.as_user(pre);
  insert into tools (item, owner_id, location, held_by) values ('Club jack', m2, 'workshop', m3) returning id into t2;
  update tools set location = 'home', held_by = null where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'an admin lists a tool for a member and changes anyone''s tool',
    exists (select 1 from tools where id = t2 and owner_id = m2 and held_by = m3) and exists (select 1 from tools where id = t1 and location = 'home' and held_by is null));
  perform pg_temp.as_user(pre);
  delete from tools where id = t2;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'and removes it', not exists (select 1 from tools where id = t2));

  perform pg_temp.as_user(alum);
  begin insert into tools (item) values ('Alumni drill'); err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot list a tool', err = 'refused', err);

  perform pg_temp.as_user(m1);
  delete from tools where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the owner removes their own tool', not exists (select 1 from tools where id = t1));

  perform pg_temp.as_user(null);
  begin perform 1 from tools; err := 'readable'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'signed-out visitors read nothing', err = 'refused', err);
  perform pg_temp.as_user(m1);
  begin perform guard_tool_change(); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the guard function is not callable through the API', err = 'refused', err);
  perform pg_temp.as_owner();

  if array_length(failures, 1) > 0 then
    raise exception E'TEAM PAGE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TEAM PAGE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
