-- =============================================================================
--  A task assigned to several people (20260165000000_task_assignees.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @taskasg.test addresses; the fixture season is made current inside the block only.
--
--  Result: an "error" whose message begins with
--      TASK ASSIGNEES CHECKS PASSED   or   TASK ASSIGNEES CHECKS FAILED
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
  pre    uuid := gen_random_uuid();   -- president: may assign
  ana    uuid := gen_random_uuid();   -- the lead
  ben    uuid := gen_random_uuid();   -- a co-assignee
  cat    uuid := gen_random_uuid();   -- a later co-assignee
  eve    uuid := gen_random_uuid();   -- a stranger to the task
  gone   uuid := gen_random_uuid();   -- an alumnus: cannot be assigned
  season uuid;
  t      uuid;
  n      int;
  err    text;
  who_lead uuid;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@taskasg.test'), (ana, 'ana@taskasg.test'), (ben, 'ben@taskasg.test'),
    (cat, 'cat@taskasg.test'), (eve, 'eve@taskasg.test'), (gone, 'gone@taskasg.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Ms President', 'Lead', 'active'), (ana, 'Ana Lead', 'Software', 'active'),
    (ben, 'Ben Second', 'Software', 'active'), (cat, 'Cat Third', 'Software', 'active'),
    (eve, 'Eve Stranger', 'Software', 'active'), (gone, 'Mr Former', 'Software', 'alumni');
  insert into member_roles (member_id, role) values (pre, 'president');
  update seasons set is_current = false where is_current;
  insert into seasons (label, is_current) values ('TASG-TEST', true) returning id into season;
  insert into tasks (season_id, title, owner_id) values (season, 'Shared task', ana) returning id into t;

  -- 1. The lead is an assignee from the start.
  select count(*) into n from task_assignees where task_id = t and member_id = ana;
  select * into lines, failures from pg_temp.note(lines, failures, 'a task created with an owner lists the owner as an assignee', n = 1);

  -- 2. Who may assign.
  perform pg_temp.as_user(ben);
  begin perform set_task_assignees(t, array[ana, ben]); err := 'allowed'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'a plain member cannot assign a task', err = 'refused', err);
  perform pg_temp.as_user(ana);
  begin perform set_task_assignees(t, array[ana, ben]); err := 'allowed'; exception when insufficient_privilege then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'nor can the lead, who is not a Head', err = 'refused', err);

  -- 3. The President adds two people; the lead keeps the role.
  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, array[ana, ben, cat]);
  perform pg_temp.as_owner();
  select count(*) into n from task_assignees where task_id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'three people are assigned', n = 3, 'count ' || n);
  select owner_id into who_lead from tasks where id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'the lead is unchanged while still ticked', who_lead = ana);
  select count(*) into n from activity where entity = 'task' and entity_id = t::text and action = 'assignees_changed'
    and actor_id = pre and jsonb_array_length(detail->'added') = 2 and jsonb_array_length(detail->'removed') = 0;
  select * into lines, failures from pg_temp.note(lines, failures, 'the history says who was added, by whom', n = 1);

  -- 4. A co-assignee may edit; a stranger may not.
  perform pg_temp.as_user(ben);
  select * into lines, failures from pg_temp.note(lines, failures, 'a co-assignee can edit the task', can_edit_task(t));
  update tasks set title = 'Edited by Ben' where id = t;
  get diagnostics n = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'and it saves through the table policy', n = 1, 'rows ' || n);
  perform pg_temp.as_user(eve);
  select * into lines, failures from pg_temp.note(lines, failures, 'a stranger cannot edit it', not can_edit_task(t));
  update tasks set title = 'Edited by Eve' where id = t;
  get diagnostics n = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'and the table policy refuses her too', n = 0, 'rows ' || n);
  perform pg_temp.as_owner();

  -- 5. The set is replaced as a whole; repeats and blanks are ignored; the first listed becomes lead.
  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, array[cat, null, ben, cat]);
  perform pg_temp.as_owner();
  select count(*) into n from task_assignees where task_id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'repeats and blanks are ignored', n = 2, 'count ' || n);
  select owner_id into who_lead from tasks where id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'with the lead gone, the first person listed leads', who_lead = cat);
  select count(*) into n from task_assignees where task_id = t and member_id = ana;
  select * into lines, failures from pg_temp.note(lines, failures, 'the removed lead is no longer assigned', n = 0);
  perform pg_temp.as_user(ana);
  select * into lines, failures from pg_temp.note(lines, failures, 'and can no longer edit', not can_edit_task(t));
  perform pg_temp.as_owner();

  -- 6. Only active members.
  perform pg_temp.as_user(pre);
  begin perform set_task_assignees(t, array[cat, gone]); err := 'allowed'; exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'an alumnus cannot be assigned', err = 'refused', err);
  perform pg_temp.as_owner();
  select count(*) into n from task_assignees where task_id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'the refused call changed nothing', n = 2);

  -- 7. Replacing the owner the old way (a direct update) swaps the person, as reassigning always has.
  perform pg_temp.as_user(pre);
  update tasks set owner_id = ben where id = t;
  perform pg_temp.as_owner();
  select count(*) into n from task_assignees where task_id = t and member_id = cat;
  select * into lines, failures from pg_temp.note(lines, failures, 'a direct owner change drops the previous owner', n = 0);
  select count(*) into n from task_assignees where task_id = t and member_id = ben;
  select * into lines, failures from pg_temp.note(lines, failures, '... and lists the new one', n = 1);

  -- 8. An empty set unassigns.
  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, '{}');
  perform pg_temp.as_owner();
  select count(*) into n from task_assignees where task_id = t;
  select owner_id into who_lead from tasks where id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'an empty list leaves the task unassigned', n = 0 and who_lead is null);

  -- 9. Surface: nobody writes the table directly, anon cannot call the command, deleting the task cleans up.
  perform pg_temp.as_user(pre);
  begin insert into task_assignees (task_id, member_id) values (t, eve); err := 'allowed'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'even the President cannot write task_assignees directly', err = 'refused', err);
  select * into lines, failures from pg_temp.note(lines, failures, 'anon cannot run set_task_assignees',
    not has_function_privilege('anon', 'set_task_assignees(uuid, uuid[])', 'execute'));
  insert into task_assignees (task_id, member_id) values (t, eve);
  delete from tasks where id = t;
  select count(*) into n from task_assignees where task_id = t;
  select * into lines, failures from pg_temp.note(lines, failures, 'deleting the task removes its assignees', n = 0);

  -- 10. Inbox (20260166000000): a person added as a co-assignee is told once; the lead and the actor are not.
  insert into tasks (season_id, title, owner_id) values (season, 'Inbox task', ana) returning id into t;
  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, array[ana, ben]);
  perform pg_temp.as_owner();
  select count(*) into n from notifications where entity_id = t::text and kind = 'task_assigned' and member_id = ben;
  select * into lines, failures from pg_temp.note(lines, failures, 'a co-assignee added to a task is notified', n = 1, n::text);
  select count(*) into n from notifications where entity_id = t::text and member_id in (ana, pre);
  select * into lines, failures from pg_temp.note(lines, failures, 'the existing lead and the person assigning are not notified', n = 0, n::text);

  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, array[ana, ben]);   -- no change
  perform pg_temp.as_owner();
  select count(*) into n from notifications where entity_id = t::text and member_id = ben;
  select * into lines, failures from pg_temp.note(lines, failures, 'saving the same people again notifies nobody', n = 1, n::text);

  perform pg_temp.as_user(pre);
  perform set_task_assignees(t, array[cat, ben]);   -- Ana leaves, Cat is first so becomes the lead
  perform pg_temp.as_owner();
  select count(*) into n from notifications where entity_id = t::text and member_id = cat;
  select * into lines, failures from pg_temp.note(lines, failures, 'a new lead is told once, not once as lead and again as co-assignee', n = 1, n::text);
  select count(*) into n from notifications where entity_id = t::text and member_id = ben;
  select * into lines, failures from pg_temp.note(lines, failures, 'someone already assigned is not told again, and removing Ana told nobody', n = 1 and not exists (
    select 1 from notifications where entity_id = t::text and member_id = ana), n::text);

  if array_length(failures, 1) > 0 then
    raise exception E'TASK ASSIGNEES CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TASK ASSIGNEES CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
