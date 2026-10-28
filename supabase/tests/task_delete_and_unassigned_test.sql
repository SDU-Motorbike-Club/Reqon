-- =============================================================================
--  Permanent delete of an archived task, and the "tasks nobody owns" notice
--  (20260146000000_delete_archived_task_and_unassigned_notice.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @taskdel.test addresses; the fixture season is made current inside the block only.
--
--  Result: an "error" whose message begins with
--      TASK DELETE CHECKS PASSED   or   TASK DELETE CHECKS FAILED
-- =============================================================================

create or replace function pg_temp.as_user(who uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', who::text, true);
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
  pre    uuid := gen_random_uuid();   -- president
  vp     uuid := gen_random_uuid();   -- vice president
  dev    uuid := gen_random_uuid();   -- developer
  hd     uuid := gen_random_uuid();   -- an ordinary member
  alum   uuid := gen_random_uuid();   -- a retired president (must not be told)
  season uuid;
  t_live uuid;
  t_arch uuid;
  t_done uuid;
  t_mine uuid;
  n      int;
  count_ int;
  err    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@taskdel.test'), (vp, 'vp@taskdel.test'), (dev, 'dev@taskdel.test'),
    (hd, 'hd@taskdel.test'), (alum, 'alum@taskdel.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Ms President', 'Lead', 'active'), (vp, 'Mr Vice', 'Lead', 'active'),
    (dev, 'Mx Dev', 'Software', 'active'), (hd, 'Ms Plain', 'Software', 'active'),
    (alum, 'Mr Former', 'Lead', 'alumni');
  insert into member_roles (member_id, role) values
    (pre, 'president'), (vp, 'vicepresident'), (dev, 'developer'), (alum, 'president');
  update seasons set is_current = false where is_current;
  insert into seasons (label, is_current) values ('TD-TEST', true) returning id into season;

  insert into tasks (season_id, title) values (season, 'Open, nobody owns it') returning id into t_live;
  insert into tasks (season_id, title) values (season, 'Archived, nobody owns it') returning id into t_arch;
  insert into tasks (season_id, title, state) values (season, 'Done, nobody owns it', 'done') returning id into t_done;
  insert into tasks (season_id, title, owner_id) values (season, 'Owned', hd) returning id into t_mine;
  -- Archived the way the product does it: the President may archive a task that has no department.
  perform pg_temp.as_user(pre);
  perform archive_task(t_arch);
  perform pg_temp.as_owner();

  -- 1. Delete: who, and only after archiving.
  perform pg_temp.as_user(hd);
  begin perform delete_archived_task(t_arch); err := 'allowed'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'an ordinary member cannot delete a task', err = 'refused', err);
  perform pg_temp.as_user(pre);
  begin perform delete_archived_task(t_live); err := 'allowed'; exception when invalid_parameter_value then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a task that is not archived cannot be deleted, even by the President', err = 'refused', err);
  select count(*) into n from tasks where id = t_live;
  select * into lines, failures from pg_temp.note(lines, failures, 'the refused delete left the task in place', n = 1);

  perform delete_archived_task(t_arch);
  perform pg_temp.as_owner();
  select count(*) into n from tasks where id = t_arch;
  select * into lines, failures from pg_temp.note(lines, failures, 'the President deletes an archived task', n = 0);
  select count(*) into n from activity where entity = 'task' and entity_id = t_arch::text and action = 'deleted'
    and detail->>'title' = 'Archived, nobody owns it' and actor_id = pre;
  select * into lines, failures from pg_temp.note(lines, failures, 'who deleted what is recorded', n = 1);

  perform pg_temp.as_user(pre);
  begin perform delete_archived_task(t_arch); err := 'allowed'; exception when no_data_found then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'deleting it twice says it is gone', err = 'refused', err);

  perform pg_temp.as_owner();
  perform pg_temp.as_user(vp);
  perform archive_task(t_done);
  perform delete_archived_task(t_done);
  perform pg_temp.as_user(dev);
  perform archive_task(t_mine);
  perform delete_archived_task(t_mine);
  perform pg_temp.as_owner();
  select count(*) into n from tasks where id in (t_done, t_mine);
  select * into lines, failures from pg_temp.note(lines, failures, 'the Vice President and a Developer may delete too', n = 0);

  -- 2. The notice. Only t_live (open, not archived, no owner) counts now.
  perform pg_temp.as_user(pre);
  begin perform notify_unassigned_tasks(false); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'the notice is not callable through the API', err = 'refused', err);
  perform pg_temp.as_owner();

  count_ := notify_unassigned_tasks(false);
  select * into lines, failures from pg_temp.note(lines, failures, 'it counts open, unarchived, unowned tasks of the current season', count_ = 1, 'got ' || count_);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre;
  select * into lines, failures from pg_temp.note(lines, failures, 'the active President is told', n = 1);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id in (vp, dev, hd, alum);
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody else is told: not the VP, the Developer, an ordinary member or a retired President', n = 0);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre and title = '1 open task is not assigned to anyone yet';
  select * into lines, failures from pg_temp.note(lines, failures, 'the text carries the count, singular', n = 1);

  perform notify_unassigned_tasks(false);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre;
  select * into lines, failures from pg_temp.note(lines, failures, 'a second run does not pile a second unread notice on the same person', n = 1);

  count_ := notify_unassigned_tasks(true);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = dev;
  select * into lines, failures from pg_temp.note(lines, failures, 'asked to include Developers (the one-off), the Developer is told', n = 1);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre;
  select * into lines, failures from pg_temp.note(lines, failures, '... and the President, who still has it unread, is not told twice', n = 1);

  update notifications set read_at = now() where member_id = pre and kind = 'tasks_unassigned';
  perform notify_unassigned_tasks(false);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre;
  select * into lines, failures from pg_temp.note(lines, failures, 'once it is read, the next week tells the President again', n = 2);

  -- Every open task now has an owner or is archived (archived through the product, by the President).
  perform pg_temp.as_user(pre);
  perform archive_task(t_live);
  perform pg_temp.as_owner();
  update notifications set read_at = now() where kind = 'tasks_unassigned';
  count_ := notify_unassigned_tasks(true);
  select count(*) into n from notifications where kind = 'tasks_unassigned' and member_id = pre and read_at is null;
  select * into lines, failures from pg_temp.note(lines, failures, 'with every task owned it says nothing', count_ = 0 and n = 0, 'count ' || count_);

  if array_length(failures, 1) > 0 then
    raise exception E'TASK DELETE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TASK DELETE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
