-- =============================================================================
--  Profiles and direct messages (20260154000000_member_profile_and_messages.sql):
--  member_email() and send_message().
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by
--  raising an exception, so Postgres rolls it all back. Fixture people are new auth.users rows with
--  @msgtest.test addresses.
--
--  Result: an "error" whose message begins with
--      MEMBER MESSAGE CHECKS PASSED   or   MEMBER MESSAGE CHECKS FAILED
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
  ada   uuid := gen_random_uuid();   -- active
  bo    uuid := gen_random_uuid();   -- active
  cy    uuid := gen_random_uuid();   -- active, a bystander
  tri   uuid := gen_random_uuid();   -- on trial
  old   uuid := gen_random_uuid();   -- retired
  spam  uuid := gen_random_uuid();   -- active, sends a lot
  stray uuid := gen_random_uuid();   -- a login with no roster row
  n         int;
  activity_before int;
  em        text;
  err       text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (ada, 'ada@msgtest.test'), (bo, 'bo@msgtest.test'), (cy, 'cy@msgtest.test'), (tri, 'tri@msgtest.test'),
    (old, 'old@msgtest.test'), (spam, 'spam@msgtest.test'), (stray, 'stray@msgtest.test');
  insert into members (id, full_name, role, status) values
    (ada, 'Msg Ada', 'Software', 'active'), (bo, 'Msg Bo', 'Software', 'active'), (cy, 'Msg Cy', 'Software', 'active'),
    (tri, 'Msg Tri', 'Software', 'trial'), (old, 'Msg Old', 'Software', 'alumni'), (spam, 'Msg Spam', 'Software', 'active');

  -- 1. Delivery
  select count(*) into activity_before from activity;
  perform pg_temp.as_user(ada);
  perform send_message(bo, '  Can you cover Friday?  ');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a message is delivered, trimmed, from the sender, with no activity row',
    exists (select 1 from notifications where member_id = bo and kind = 'message' and body = 'Can you cover Friday?'
            and actor_id = ada and entity_id = ada::text and activity_id is null and read_at is null));
  select * into lines, failures from pg_temp.note(lines, failures, 'it is not written to the club-wide activity trail',
    (select count(*) from activity) = activity_before);

  -- 2. Privacy: only the recipient reads it
  perform pg_temp.as_user(bo);
  select count(*) into n from notifications where kind = 'message';
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the recipient sees it', n = 1, n::text);
  perform pg_temp.as_user(ada);
  select count(*) into n from notifications where kind = 'message';
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the sender cannot read it back', n = 0, n::text);
  perform pg_temp.as_user(cy);
  select count(*) into n from notifications where kind = 'message';
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a bystander does not see it', n = 0, n::text);

  -- 3. The recipient cannot rewrite it, and nobody can forge one around the function
  perform pg_temp.as_user(bo);
  begin
    update notifications set body = 'Rewritten' where kind = 'message';
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the recipient cannot change the text', err = 'refused', err);

  perform pg_temp.as_user(ada);
  begin
    insert into notifications (member_id, kind, entity, entity_id, actor_id, body) values (bo, 'message', 'member', ada::text, cy, 'Forged');
    err := 'accepted';
  exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a message cannot be inserted directly (no forged sender)', err = 'refused', err);

  begin
    insert into notifications (member_id, kind, entity, entity_id) values (bo, 'message', 'member', 'x');
    err := 'accepted';
  exception when check_violation then err := 'refused'; end;
  select * into lines, failures from pg_temp.note(lines, failures, 'even the owner cannot store a message without text', err = 'refused', err);

  -- 4. Who can send to whom
  perform pg_temp.as_user(ada);
  begin perform send_message(ada, 'Hello me'); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'you cannot message yourself', err = 'refused', err);

  perform pg_temp.as_user(ada);
  begin perform send_message(old, 'Hello'); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot receive messages', err = 'refused', err);

  perform pg_temp.as_user(old);
  begin perform send_message(ada, 'Hello'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot send messages', err = 'refused', err);

  perform pg_temp.as_user(stray);
  begin perform send_message(ada, 'Hello'); err := 'accepted'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a login that is not on the roster cannot send', err = 'refused', err);

  perform pg_temp.as_user(ada);
  begin perform send_message(gen_random_uuid(), 'Hello'); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an unknown recipient is refused', err = 'refused', err);

  perform pg_temp.as_user(tri);
  perform send_message(ada, 'Trial member here');
  perform pg_temp.as_user(ada);
  perform send_message(tri, 'Welcome');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member on trial can send and receive',
    exists (select 1 from notifications where member_id = ada and actor_id = tri and kind = 'message')
    and exists (select 1 from notifications where member_id = tri and actor_id = ada and kind = 'message'));

  -- 5. The text
  perform pg_temp.as_user(ada);
  begin perform send_message(bo, '   '); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a blank message is refused', err = 'refused', err);

  perform pg_temp.as_user(ada);
  begin perform send_message(bo, repeat('x', 1001)); err := 'accepted'; exception when invalid_parameter_value then err := 'refused'; end;
  perform send_message(bo, repeat('x', 1000));
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, '1001 characters are refused, 1000 are fine', err = 'refused', err);

  -- 6. Flooding: 30 an hour per sender, counted per sender
  perform pg_temp.as_user(spam);
  for i in 1..30 loop
    perform send_message(bo, 'Message ' || i);
  end loop;
  begin perform send_message(bo, 'The 31st'); err := 'accepted'; exception when program_limit_exceeded then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'the 31st message in an hour is refused', err = 'refused', err);
  perform pg_temp.as_user(cy);
  perform send_message(bo, 'Someone else is unaffected');
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'one sender''s limit does not block another',
    exists (select 1 from notifications where actor_id = cy and body = 'Someone else is unaffected'));

  -- 7. Email
  perform pg_temp.as_user(ada);
  em := member_email(bo);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'an active member reads a colleague''s login email', em = 'bo@msgtest.test', em);

  perform pg_temp.as_user(tri);
  em := member_email(bo);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a member on trial reads it too', em = 'bo@msgtest.test', em);

  perform pg_temp.as_user(old);
  em := member_email(bo);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member gets nothing', em is null, em);

  perform pg_temp.as_user(stray);
  em := member_email(bo);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'a login that is not on the roster gets nothing', em is null, em);

  perform pg_temp.as_user(ada);
  em := member_email(stray);
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'it cannot look up a login that is not a member', em is null, em);

  -- 8. Not for anonymous callers
  perform pg_temp.as_user(null);
  begin perform member_email(bo); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'member_email is not callable without signing in', err = 'refused', err);

  perform pg_temp.as_user(null);
  begin perform send_message(bo, 'Hi'); err := 'callable'; exception when insufficient_privilege then err := 'refused'; end;
  perform pg_temp.as_owner();
  select * into lines, failures from pg_temp.note(lines, failures, 'send_message is not callable without signing in', err = 'refused', err);

  if array_length(failures, 1) > 0 then
    raise exception E'MEMBER MESSAGE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'MEMBER MESSAGE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
