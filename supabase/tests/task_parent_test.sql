-- =============================================================================
--  Task hierarchy (migration 20260151000000): parent_id, one level only, and a
--  parent that completes / reopens with its subtasks.
--
--  SAFE TO RUN AGAINST THE REAL PROJECT: one DO block that always raises, so every
--  fixture rolls back. Fixture people are new @parent-task.test identities.
--
--  Result: TASK PARENT CHECKS PASSED / FAILED.
-- =============================================================================

create or replace function pg_temp.attempt(who uuid, stmt text) returns text language plpgsql as $fn$
declare n bigint; result text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  begin
    execute stmt;
    get diagnostics n = row_count;
    result := case when n > 0 then 'ALLOWED' else 'DENIED' end;
  exception
    when insufficient_privilege then result := 'DENIED';
    when others then result := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return result;
end $fn$;

create temp table results (n serial, label text, got text, expected text);
create or replace function pg_temp.expect(label text, got text, expected text) returns void
language sql as $fn$ insert into pg_temp.results (label, got, expected) values (label, got, expected); $fn$;

do $test$
declare
  season uuid; s2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); mem uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); pre uuid := gen_random_uuid();
  xp uuid; xc uuid; dp uuid; dc uuid;
  pa text; ms text; ms2 text;
  p uuid; c1 uuid; c2 uuid; q uuid; q1 uuid; q2 uuid; b uuid; b1 uuid; other uuid; x uuid;
  m1 uuid; m1a uuid; m1b uuid; m2 uuid; m2c uuid;
  total int; bad int; report text;
begin
  select id into season from seasons where is_current limit 1;
  select key into ms from milestones where season_id = season order by ordinal limit 1;
  select key into pa from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;

  insert into auth.users (id, email) values (o1, 'o1@parent-task.test'), (mem, 'mem@parent-task.test'), (o2, 'o2@parent-task.test'), (pre, 'pre@parent-task.test');
  insert into members (id, full_name, role, status) values (o1, 'PT owner', 'Member', 'active'), (mem, 'PT member', 'Member', 'active'),
    (o2, 'PT second owner', 'Member', 'active'), (pre, 'PT president', 'Member', 'active');
  insert into member_roles (member_id, role) values (pre, 'president');
  insert into seasons (id, label, regs_ref) select s2, 'PT other season', regs_ref from seasons where id = season;
  insert into milestones (key, season_id, ordinal, name) values ('PTP-M2', s2, 1, 'Other season milestone');
  ms2 := 'PTP-M2';

  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'Parent', o1, pa, ms) returning id into p;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'Child 1', o1, pa, ms, p) returning id into c1;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'Child 2', o1, pa, ms, p) returning id into c2;
  perform pg_temp.expect('a subtask stores its parent', (select parent_id = p from tasks where id = c1)::text, 'true');
  perform pg_temp.expect('adding subtasks leaves a To do parent alone', (select state::text from tasks where id = p), 'todo');

  -- ============================================================ completing
  perform pg_temp.expect('finishing one of two subtasks is allowed', pg_temp.attempt(o1, format('update tasks set state = ''done'' where id = %L', c1)), 'ALLOWED');
  perform pg_temp.expect('... the parent is not done yet', (select state::text from tasks where id = p), 'todo');
  perform pg_temp.expect('finishing the last subtask is allowed', pg_temp.attempt(o1, format('update tasks set state = ''done'' where id = %L', c2)), 'ALLOWED');
  perform pg_temp.expect('... the parent is Done, with a completion time', (select state::text || ':' || (completed_at is not null)::text from tasks where id = p), 'done:true');
  perform pg_temp.expect('reopening a subtask is allowed', pg_temp.attempt(o1, format('update tasks set state = ''todo'' where id = %L', c2)), 'ALLOWED');
  perform pg_temp.expect('... sends the Done parent back to In progress', (select state::text || ':' || (completed_at is null)::text from tasks where id = p), 'wip:true');
  perform pg_temp.expect('cancelling the open subtask counts as finished', pg_temp.attempt(o1, format('update tasks set state = ''cancelled'' where id = %L', c2)), 'ALLOWED');
  perform pg_temp.expect('... so the parent is Done again', (select state::text from tasks where id = p), 'done');
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'Late subtask', o1, pa, ms, p);
  perform pg_temp.expect('a new subtask reopens a Done parent', (select state::text from tasks where id = p), 'wip');

  -- all cancelled: nothing was achieved, the parent is not completed
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'Q', o1, pa, ms) returning id into q;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'Q1', o1, pa, ms, q) returning id into q1;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'Q2', o1, pa, ms, q) returning id into q2;
  update tasks set state = 'cancelled' where id in (q1, q2);
  perform pg_temp.expect('all subtasks cancelled leaves the parent unchanged', (select state::text from tasks where id = q), 'todo');

  -- a Blocked parent with a reason must not stop its last subtask from finishing
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, state, blocked_reason) values (season, 'B', o1, pa, ms, 'blocked', 'waiting for the sponsor') returning id into b;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'B1', o1, pa, ms, b) returning id into b1;
  perform pg_temp.expect('finishing the last subtask of a Blocked parent is allowed', pg_temp.attempt(o1, format('update tasks set state = ''done'' where id = %L', b1)), 'ALLOWED');
  perform pg_temp.expect('... the Blocked parent became Done and its reason is cleared', (select state::text || ':' || coalesce(blocked_reason, '-') from tasks where id = b), 'done:-');

  -- ============================================================ one level only
  perform pg_temp.expect('a task cannot be its own parent', pg_temp.attempt(o1, format('update tasks set parent_id = id where id = %L', q)), 'ERROR 23514: A task cannot be part of itself.');
  perform pg_temp.expect('a task that has subtasks cannot become a subtask', pg_temp.attempt(o1, format('update tasks set parent_id = %L where id = %L', q, p)), 'ERROR 23514: This task has subtasks of its own%');
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'X', o1, pa, ms) returning id into x;
  perform pg_temp.expect('a subtask cannot be a parent', pg_temp.attempt(o1, format('update tasks set parent_id = %L where id = %L', c1, x)), 'ERROR 23514: Tasks nest one level only%');
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (s2, 'Elsewhere', o1, pa, ms2) returning id into other;
  perform pg_temp.expect('a parent from another season is refused', pg_temp.attempt(o1, format('update tasks set parent_id = %L where id = %L', other, x)), 'ERROR 23514: A task and its parent must be in the same season.');
  perform pg_temp.expect('a member with no authority over the task cannot set its parent', pg_temp.attempt(mem, format('update tasks set parent_id = %L where id = %L', p, x)), 'DENIED');
  perform pg_temp.expect('the owner can set a parent', pg_temp.attempt(o1, format('update tasks set parent_id = %L where id = %L', q, x)), 'ALLOWED');
  perform pg_temp.expect('... and take it away again', pg_temp.attempt(o1, format('update tasks set parent_id = null where id = %L', x)), 'ALLOWED');

  -- ======================================================= moving between parents
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'M1', o1, pa, ms) returning id into m1;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id, state) values (season, 'M1 done', o1, pa, ms, m1, 'done') returning id into m1a;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'M1 open', o1, pa, ms, m1) returning id into m1b;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'M2', o1, pa, ms) returning id into m2;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id, state) values (season, 'M2 done', o1, pa, ms, m2, 'done') returning id into m2c;
  -- M1 completed through its done subtask, then the open one reopened it.
  perform pg_temp.expect('setup: M1 is In progress (one done, one open subtask), M2 is Done through its only subtask', (select string_agg(state::text, ',' order by title) from tasks where id in (m1, m2)), 'wip,done');
  perform pg_temp.expect('moving the open subtask to another parent is allowed', pg_temp.attempt(o1, format('update tasks set parent_id = %L where id = %L', m2, m1b)), 'ALLOWED');
  perform pg_temp.expect('... the old parent completes and the new one reopens', (select string_agg(state::text, ',' order by title) from tasks where id in (m1, m2)), 'done,wip');

  -- ============================================ the parent follows a subtask its owner cannot edit
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'XP', o1, pa, ms) returning id into xp;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'XC', o2, pa, ms, xp) returning id into xc;
  perform pg_temp.expect('setup: the subtask owner cannot edit the parent task', pg_temp.attempt(o2, format('update tasks set title = ''hijack'' where id = %L', xp)), 'DENIED');
  perform pg_temp.expect('... yet finishing their own subtask is allowed', pg_temp.attempt(o2, format('update tasks set state = ''done'' where id = %L', xc)), 'ALLOWED');
  perform pg_temp.expect('... and the parent, which they cannot edit, is Done', (select state::text from tasks where id = xp), 'done');

  -- ============================================ deleting an archived parent
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'DP', o1, pa, ms) returning id into dp;
  insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id, state) values (season, 'DC', o1, pa, ms, dp, 'done') returning id into dc;
  perform pg_temp.expect('the President archives the done subtask', pg_temp.attempt(pre, format('select archive_task(%L)', dc)), 'ALLOWED');
  perform pg_temp.expect('... and the parent', pg_temp.attempt(pre, format('select archive_task(%L)', dp)), 'ALLOWED');
  perform pg_temp.expect('the President deletes the archived parent', pg_temp.attempt(pre, format('select delete_archived_task(%L)', dp)), 'ALLOWED');
  perform pg_temp.expect('... its archived subtask survives, no longer a subtask', (select (archived_at is not null and parent_id is null)::text from tasks where id = dc), 'true');

  -- ============================================ a Done parent completes its open subtasks
  declare fp uuid; f1 uuid; f2 uuid; f3 uuid;
  begin
    insert into tasks (season_id, title, owner_id, subteam_key, milestone_key) values (season, 'F parent', o1, pa, ms) returning id into fp;
    insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'F1 todo', o1, pa, ms, fp) returning id into f1;
    insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id, state) values (season, 'F2 blocked', o1, pa, ms, fp, 'blocked') returning id into f2;
    insert into tasks (season_id, title, owner_id, subteam_key, milestone_key, parent_id) values (season, 'F3 cancelled', o1, pa, ms, fp) returning id into f3;
    update tasks set state = 'cancelled' where id = f3;
    perform pg_temp.expect('marking the parent Done is allowed', pg_temp.attempt(o1, format('update tasks set state = ''done'' where id = %L', fp)), 'ALLOWED');
    perform pg_temp.expect('... the parent stays Done', (select state::text from tasks where id = fp), 'done');
    perform pg_temp.expect('... open and Blocked subtasks are Done, a cancelled one stays cancelled',
      (select string_agg(state::text, ',' order by title) from tasks where parent_id = fp), 'done,done,cancelled');
    perform pg_temp.expect('... a completed subtask has a completion time and no blocker reason',
      (select (completed_at is not null and blocked_reason is null)::text from tasks where id = f2), 'true');
  end;

  -- ================================================================= verdict
  select count(*), count(*) filter (where not (got like expected)),
         string_agg(case when not (got like expected) then format('  FAIL  %s — expected %s, got %s', label, expected, got) end, E'\n' order by n)
    into total, bad, report from pg_temp.results;
  if bad > 0 then
    raise exception E'TASK PARENT CHECKS FAILED — % of % checks did not behave as expected.\n%', bad, total, report;
  end if;
  raise exception 'TASK PARENT CHECKS PASSED — all % checks', total;
end
$test$;
