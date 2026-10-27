-- =============================================================================
--  The maintenance scripts, run against the real schema (so they cannot rot):
--    supabase/maintenance/2026-10-27_wipe_tasks_and_proposals.sql
--    supabase/maintenance/2026-10-27_seed_example_tools.sql
--  The statements below are those scripts' statements (without the BEGIN/ROLLBACK
--  wrapper and the result tables). Keep them in step. Rolled back at the end.
--
--  Result: an "error" whose message begins with
--      MAINTENANCE SCRIPT CHECKS PASSED   or   MAINTENANCE SCRIPT CHECKS FAILED
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
  pre uuid := gen_random_uuid();
  hd  uuid := gen_random_uuid();
  mb  uuid := gen_random_uuid();
  season uuid; dept text; clause text; p1 uuid; t1 uuid; t2 uuid; rev int;
  ms text := 'MNT-MS1';
  lines text[] := '{}'; failures text[] := '{}';
  n int; before_members int; before_ms int;
begin
  insert into auth.users (id, email) values (pre, 'pre@maint.test'), (hd, 'hd@maint.test'), (mb, 'mb@maint.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Mn President', 'Lead', 'active'), (hd, 'Mn Head', 'Chassis', 'active'), (mb, 'Mn Member', 'Chassis', 'active');
  insert into member_roles (member_id, role) values (pre, 'president');
  insert into seasons (label, is_current) values ('MNT-TEST', false) returning id into season;
  insert into milestones (key, season_id, ordinal, name) values (ms, season, 1, 'Maintenance milestone');
  select key into dept from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  update subteams set lead_id = hd where key = dept;
  select clause_key into clause from clauses order by clause_key limit 1;

  -- a real history: a proposal with a discussion, promoted to a task with a prerequisite and a requirement
  perform pg_temp.as_user(mb);
  select (submit_proposal(season, 'Wipe me', dept, current_date + 30, ms, array[clause], 'why')).id into p1;
  perform pg_temp.as_user(hd);
  select revision into rev from task_proposals where id = p1;
  perform approve_and_promote(p1, season, rev, 'Fine.', mb);
  select id into t1 from tasks where source_proposal = p1;
  perform pg_temp.as_user(pre);
  select (create_task(season, 'Second task', dept, hd, current_date + 9, ms, array[clause])).id into t2;
  perform add_task_dependency(t2, t1);
  perform pg_temp.as_owner();
  select count(*) into before_members from members; select count(*) into before_ms from milestones;
  select * into lines, failures from pg_temp.note(lines, failures, 'the fixtures exist: tasks, a proposal, its discussion, history and inbox rows',
    (select count(*) from tasks where season_id = season) = 2 and (select count(*) from proposal_comments where proposal_id = p1) >= 1
    and (select count(*) from activity where entity in ('task','proposal')) > 0 and (select count(*) from notifications) > 0);

  -- ===== the wipe script's statements
-- ------------------------------------------------------------------ 1. backup
create schema if not exists maintenance_backup;
revoke all on schema maintenance_backup from public;

create table maintenance_backup.w20261027_tasks             as select * from tasks;
create table maintenance_backup.w20261027_task_requirements as select * from task_requirements;
create table maintenance_backup.w20261027_task_dependencies as select * from task_dependencies;
create table maintenance_backup.w20261027_task_attachments  as select * from task_attachments;
create table maintenance_backup.w20261027_proposals         as select * from task_proposals;
create table maintenance_backup.w20261027_proposal_reqs     as select * from proposal_requirements;
create table maintenance_backup.w20261027_proposal_comments as select * from proposal_comments;
create table maintenance_backup.w20261027_activity          as select * from activity where entity in ('task', 'proposal');
create table maintenance_backup.w20261027_notifications     as
  select * from notifications where activity_id in (select id from activity where entity in ('task', 'proposal'));

-- ------------------------------------------------------------------- 2. before

-- ------------------------------------------------------------------- 3. delete
alter table proposal_comments disable trigger trg_guard_proposal_comment_rows;
delete from proposal_comments;
alter table proposal_comments enable trigger trg_guard_proposal_comment_rows;

delete from tasks;               -- also removes task_requirements, task_dependencies, task_attachments (cascade)
delete from task_proposals;      -- also removes proposal_requirements (cascade)
delete from activity where entity in ('task', 'proposal');   -- their inbox notifications go with them (cascade)

-- -------------------------------------------------------------------- 4. after


  select * into lines, failures from pg_temp.note(lines, failures, 'no task, proposal, discussion row, link, history row or inbox notice about them is left',
    (select count(*) from tasks) = 0 and (select count(*) from task_proposals) = 0 and (select count(*) from proposal_comments) = 0
    and (select count(*) from task_requirements) = 0 and (select count(*) from task_dependencies) = 0 and (select count(*) from proposal_requirements) = 0
    and (select count(*) from activity where entity in ('task','proposal')) = 0
    and (select count(*) from notifications where entity in ('task','proposal')) = 0);
  select * into lines, failures from pg_temp.note(lines, failures, 'people, milestones and seasons are untouched',
    (select count(*) from members) = before_members and (select count(*) from milestones) = before_ms and exists (select 1 from seasons where id = season));
  select * into lines, failures from pg_temp.note(lines, failures, 'the backup holds what was removed',
    (select count(*) from maintenance_backup.w20261027_tasks) >= 2 and (select count(*) from maintenance_backup.w20261027_proposals) >= 1
    and (select count(*) from maintenance_backup.w20261027_proposal_comments) >= 1);
  select * into lines, failures from pg_temp.note(lines, failures, 'the discussion guard is back on afterwards',
    (select tgenabled from pg_trigger where tgname = 'trg_guard_proposal_comment_rows') = 'O');

  -- ===== the example-tools script's statements (twice: it is safe to repeat)
execute $outer$ do $seedrun$
declare
  owners uuid[];
  n int;
  i int := 0;
  t record;
begin
  select coalesce(array_agg(id), '{}') into owners from (
    select m.id
      from members m
      left join member_roles r on r.member_id = m.id and r.role in ('developer', 'president', 'vicepresident')
     where m.status = 'active'
     group by m.id
     order by (count(r.role) > 0) desc, min(m.full_name)
     limit 3
  ) picked;
  n := coalesce(array_length(owners, 1), 0);
  if n = 0 then
    raise exception 'There is no active member to own the example tools. Add a member first.';
  end if;

  for t in
    select * from (values
      ('Torque wrench 3/8" (10–110 Nm)', 'workshop',   false),
      ('Cordless drill 18 V',            'workshop',   false),
      ('Digital caliper 150 mm',         'workshop',   false),
      ('Metric socket set',              'workshop',   false),
      ('Multimeter',                     'university', true),
      ('Soldering station',              'workshop',   false),
      ('Heat gun',                       'home',       true),
      ('Angle grinder 125 mm',           'workshop',   false),
      ('Laptop with the ECU software',   'home',       true),
      ('Bench vise',                     'workshop',   false)
    ) as v(item, location, held)
  loop
    i := i + 1;
    -- held = true: the owner has it (at home, at the university); false: nobody has it, it just sits there.
    insert into tools (item, location, owner_id, held_by)
    select t.item, t.location, owners[1 + (i - 1) % n], case when t.held then owners[1 + (i - 1) % n] end
     where not exists (select 1 from tools x where x.item = t.item and x.owner_id = owners[1 + (i - 1) % n]);
  end loop;
end
$seedrun$ $outer$;

  select count(*) into n from tools;
execute $outer$ do $seedrun$
declare
  owners uuid[];
  n int;
  i int := 0;
  t record;
begin
  select coalesce(array_agg(id), '{}') into owners from (
    select m.id
      from members m
      left join member_roles r on r.member_id = m.id and r.role in ('developer', 'president', 'vicepresident')
     where m.status = 'active'
     group by m.id
     order by (count(r.role) > 0) desc, min(m.full_name)
     limit 3
  ) picked;
  n := coalesce(array_length(owners, 1), 0);
  if n = 0 then
    raise exception 'There is no active member to own the example tools. Add a member first.';
  end if;

  for t in
    select * from (values
      ('Torque wrench 3/8" (10–110 Nm)', 'workshop',   false),
      ('Cordless drill 18 V',            'workshop',   false),
      ('Digital caliper 150 mm',         'workshop',   false),
      ('Metric socket set',              'workshop',   false),
      ('Multimeter',                     'university', true),
      ('Soldering station',              'workshop',   false),
      ('Heat gun',                       'home',       true),
      ('Angle grinder 125 mm',           'workshop',   false),
      ('Laptop with the ECU software',   'home',       true),
      ('Bench vise',                     'workshop',   false)
    ) as v(item, location, held)
  loop
    i := i + 1;
    -- held = true: the owner has it (at home, at the university); false: nobody has it, it just sits there.
    insert into tools (item, location, owner_id, held_by)
    select t.item, t.location, owners[1 + (i - 1) % n], case when t.held then owners[1 + (i - 1) % n] end
     where not exists (select 1 from tools x where x.item = t.item and x.owner_id = owners[1 + (i - 1) % n]);
  end loop;
end
$seedrun$ $outer$;

  select * into lines, failures from pg_temp.note(lines, failures, 'the example tools are added once, even if the script runs twice',
    (select count(*) from tools) = n and n = 10, n::text);
  select * into lines, failures from pg_temp.note(lines, failures, 'they use several places and owners, some held and some not',
    (select count(distinct location) from tools) >= 3 and (select count(distinct owner_id) from tools) >= 2 and exists (select 1 from tools where held_by is not null) and exists (select 1 from tools where held_by is null));

  if array_length(failures, 1) > 0 then
    raise exception E'MAINTENANCE SCRIPT CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1), array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'MAINTENANCE SCRIPT CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
