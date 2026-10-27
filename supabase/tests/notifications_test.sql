-- =============================================================================
--  Notification checks (20260139000000_notifications.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything it creates happens inside
--  one block that always ends by raising an exception, so Postgres rolls every
--  change back. The fixture people are new auth.users rows with
--  @notify.test addresses.
--
--  Result: an "error" whose message begins with
--      NOTIFICATION CHECKS PASSED   or   NOTIFICATION CHECKS FAILED
--
--  Drives the real commands (raise, request changes, revise, approve, promote,
--  reassign, block, comment, reject, grant a role) as the people who would do
--  them, and checks who is told: the right person, exactly once per event,
--  never the person who acted, never a retired member. Then checks that each
--  member sees and marks read only their own, that read_at is stamped by the
--  server, and that the purge keeps unread notifications.
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

-- How many notifications of this kind about this entity a member has (read as the owner).
create or replace function pg_temp.told(who uuid, k text, ent text) returns int
language sql as $fn$
  select count(*)::int from notifications where member_id = who and kind = k and entity_id = ent;
$fn$;

do $test$
declare
  pre    uuid := gen_random_uuid();   -- president
  vp     uuid := gen_random_uuid();   -- vice president
  dev    uuid := gen_random_uuid();   -- developer: never a reviewer recipient
  hd     uuid := gen_random_uuid();   -- Head of dept
  au     uuid := gen_random_uuid();   -- author of the proposals
  own    uuid := gen_random_uuid();   -- the task's first owner
  alum   uuid := gen_random_uuid();   -- retired member
  season uuid;
  dept   text;
  clause text;
  ms     text := 'NTF-MS1';
  p1     uuid;  -- in dept: reviewed by its Head
  p2     uuid;  -- no department: reviewed by the President and VP
  t1     uuid;
  rev    int;
  n      int;
  n2     int;
  err    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@notify.test'), (vp, 'vp@notify.test'), (dev, 'dev@notify.test'), (hd, 'hd@notify.test'),
    (au, 'au@notify.test'), (own, 'own@notify.test'), (alum, 'alum@notify.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Ntf President', 'Lead', 'active'), (vp, 'Ntf Vice', 'Ops', 'active'), (dev, 'Ntf Developer', 'Software', 'active'),
    (hd, 'Ntf Head', 'Chassis', 'active'), (au, 'Ntf Author', 'Chassis', 'active'), (own, 'Ntf Owner', 'Chassis', 'active'),
    (alum, 'Ntf Alumni', 'Chassis', 'alumni');
  insert into member_roles (member_id, role) values (pre, 'president'), (vp, 'vicepresident'), (dev, 'developer');
  insert into seasons (label, is_current) values ('NTF-TEST', false) returning id into season;
  insert into milestones (key, season_id, ordinal, name) values (ms, season, 1, 'Notify milestone');
  select key into dept from subteams where archived_at is null and parent_key is null order by sort_order, key limit 1;
  update subteams set lead_id = hd where key = dept;
  select clause_key into clause from clauses order by clause_key limit 1;

  -- 1. Raising a proposal asks its reviewers.
  perform pg_temp.as_user(au);
  select (submit_proposal(season, 'Lighter subframe', dept, '2026-12-01', ms, array[clause], 'why')).id into p1;
  perform pg_temp.as_owner();
  -- A proposal with no department (older ones, imports): submit_proposal now
  -- always asks for one, so it is written directly here.
  insert into task_proposals (season_id, title, context, raised_by)
    values (season, 'Paddock tent', 'why', au) returning id into p2;
  select * into lines, failures from pg_temp.note(lines, failures,
    'a new proposal in a department with a Head asks that Head',
    pg_temp.told(hd, 'review_requested', p1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    '...and not the President, VP, Developer or the author',
    pg_temp.told(pre, 'review_requested', p1::text) + pg_temp.told(vp, 'review_requested', p1::text)
      + pg_temp.told(dev, 'review_requested', p1::text) + pg_temp.told(au, 'review_requested', p1::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures,
    'a proposal with no department asks the President and the VP, not the Developer',
    pg_temp.told(pre, 'review_requested', p2::text) = 1 and pg_temp.told(vp, 'review_requested', p2::text) = 1
      and pg_temp.told(dev, 'review_requested', p2::text) = 0);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the title is copied in', exists (select 1 from notifications where member_id = hd and title = 'Lighter subframe'));

  -- 2. Changes requested, then revised by the author.
  perform pg_temp.as_user(hd);
  perform request_proposal_changes(p1, 1, 'Please add the weight target.');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'changes requested tells the author exactly once',
    pg_temp.told(au, 'changes_requested', p1::text) = 1, pg_temp.told(au, 'changes_requested', p1::text)::text);
  select revision into rev from task_proposals where id = p1;
  perform pg_temp.as_user(au);
  perform revise_proposal(p1, rev, '{"title": "Lighter subframe, 2 kg target"}'::jsonb, 'Added the target.');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the author''s revision asks the Head again', pg_temp.told(hd, 'review_requested', p1::text) = 2);

  -- 3. Approved and promoted.
  select revision into rev from task_proposals where id = p1;
  perform pg_temp.as_user(hd);
  perform approve_proposal(p1, rev, 'Good.');
  perform promote_proposal(p1, season, own);
  perform pg_temp.as_owner();
  select id into t1 from tasks where source_proposal = p1;
  select * into lines, failures from pg_temp.note(lines, failures,
    'approval tells the author exactly once', pg_temp.told(au, 'proposal_approved', p1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'promotion tells the author', pg_temp.told(au, 'proposal_promoted', p1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the new task''s owner is told it is theirs', pg_temp.told(own, 'task_assigned', t1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'the Head who did all of it is told nothing about their own actions',
    (select count(*) from notifications where member_id = hd and actor_id = hd) = 0);

  -- 4. Reassigned, then blocked.
  perform pg_temp.as_user(hd);
  update tasks set owner_id = au where id = t1;
  update tasks set state = 'blocked', blocked_reason = 'Waiting for the tube supplier' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'reassigning tells the new owner', pg_temp.told(au, 'task_assigned', t1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    '...and not the previous one again', pg_temp.told(own, 'task_assigned', t1::text) = 1);
  select * into lines, failures from pg_temp.note(lines, failures,
    'blocking tells the owner, not the Head who blocked it',
    pg_temp.told(au, 'task_blocked', t1::text) = 1 and pg_temp.told(hd, 'task_blocked', t1::text) = 0);
  perform pg_temp.as_user(au);
  update tasks set state = 'wip' where id = t1;
  update tasks set state = 'blocked', blocked_reason = 'Still waiting' where id = t1;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'when the owner blocks it, the Head is told', pg_temp.told(hd, 'task_blocked', t1::text) = 1);

  -- 5. Discussion and rejection on the proposal with no department.
  perform pg_temp.as_user(au);
  perform add_proposal_comment(p2, 'Do we have a budget for this?');
  perform pg_temp.as_user(pre);
  perform add_proposal_comment(p2, 'Yes, up to 300 euros.');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the author''s comment tells the reviewers, and a reply tells the author',
    pg_temp.told(pre, 'proposal_comment', p2::text) = 1 and pg_temp.told(vp, 'proposal_comment', p2::text) = 1
      and pg_temp.told(au, 'proposal_comment', p2::text) = 1);
  select revision into rev from task_proposals where id = p2;
  perform pg_temp.as_user(vp);
  perform review_proposal(p2, 'reject', rev, 'Not this season.');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'rejection tells the author', pg_temp.told(au, 'proposal_rejected', p2::text) = 1);

  -- 6. Roles.
  perform pg_temp.as_user(pre);
  insert into member_roles (member_id, role, assigned_by) values (own, 'treasurer', pre);
  insert into member_roles (member_id, role, assigned_by) values (alum, 'documentation', pre);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a granted role tells its holder', pg_temp.told(own, 'role_granted', own::text) = 1
      and (select title from notifications where member_id = own and kind = 'role_granted') = 'treasurer');
  select * into lines, failures from pg_temp.note(lines, failures,
    'a retired member is never notified', (select count(*) from notifications where member_id = alum) = 0);

  -- 7. Each member sees and changes only their own.
  select count(*) into n from notifications where member_id = au;
  perform pg_temp.as_user(au);
  select count(*) into n2 from notifications;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member reads exactly their own notifications', n > 0 and n2 = n, format('%s of %s', n2, n));
  perform pg_temp.as_user(null);
  begin
    select count(*) into n2 from notifications;
  exception when insufficient_privilege then n2 := 0;
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'anon reads none', n2 = 0);

  perform pg_temp.as_user(au);
  begin
    insert into notifications (member_id, activity_id, kind, entity, entity_id)
      values (au, (select max(id) from activity), 'role_granted', 'member_role', au::text);
    err := 'inserted';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody can write a notification', err = 'refused', err);

  perform pg_temp.as_user(au);
  begin
    update notifications set title = 'forged' where member_id = au;
    err := 'updated';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'only read_at can be changed', err = 'refused', err);

  perform pg_temp.as_user(au);
  update notifications set read_at = '2000-01-01' where kind = 'proposal_approved';
  get diagnostics n = row_count;
  update notifications set read_at = null where kind = 'proposal_approved';
  update notifications set read_at = now() where member_id = hd;
  get diagnostics n2 = row_count;
  begin
    delete from notifications where member_id = au;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures,
    'marking read stamps the server''s time and cannot be undone',
    n = 1 and (select read_at > now() - interval '1 minute' from notifications where member_id = au and kind = 'proposal_approved'));
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member cannot mark someone else''s', n2 = 0 and not exists (select 1 from notifications where member_id = hd and read_at is not null));
  select * into lines, failures from pg_temp.note(lines, failures,
    'a member cannot delete their own', (select count(*) from notifications where member_id = au) > 0);

  -- 8. The purge drops only notifications read long ago.
  alter table notifications disable trigger trg_stamp_notification_read;
  update notifications set read_at = now() - interval '91 days' where member_id = au and kind = 'proposal_approved';
  alter table notifications enable trigger trg_stamp_notification_read;
  select count(*) into n from notifications where member_id = au;
  n2 := purge_read_notifications();
  select * into lines, failures from pg_temp.note(lines, failures,
    'the purge removes what was read over 90 days ago, and nothing unread',
    n2 >= 1 and (select count(*) from notifications where member_id = au) = n - 1
      and not exists (select 1 from notifications where member_id = au and kind = 'proposal_approved'));
  perform pg_temp.as_user(au);
  begin
    perform purge_read_notifications();
    err := 'callable';
  exception when insufficient_privilege then err := 'refused';
  end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'members cannot run the purge', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'NOTIFICATION CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'NOTIFICATION CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
