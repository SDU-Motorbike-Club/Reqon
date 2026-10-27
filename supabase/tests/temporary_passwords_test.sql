-- =============================================================================
--  Temporary password checks (20260138000000_temporary_passwords.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything it creates happens inside
--  one block that always ends by raising an exception, so Postgres rolls every
--  change back. The fixture people are new auth.users rows with
--  @temppw.test addresses.
--
--  Result: an "error" whose message begins with
--      TEMPORARY PASSWORD CHECKS PASSED   or   TEMPORARY PASSWORD CHECKS FAILED
--
--  Covers what the three Edge Functions rely on: no API caller can set or clear
--  must_change_password (not even on their own row, not even an admin); a new
--  row may carry it; can_reset_password() follows can_grant_role() for every
--  role the person holds and never answers true for yourself; and
--  mark_password_reset() sets the flag and logs who did it.
-- =============================================================================

create or replace function pg_temp.attempt(who uuid, stmt text, kind text)
returns text language plpgsql as $fn$
declare
  n bigint;
begin
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

    if kind = 'read' then
      execute stmt into n;
    else
      execute stmt;
      get diagnostics n = row_count;
    end if;

    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    return case when n > 0 then 'ALLOWED' else 'DENIED' end;
  exception
    when insufficient_privilege then
      perform set_config('role', 'none', true);
      return 'DENIED';
    when others then
      perform set_config('role', 'none', true);
      return 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
end $fn$;

do $test$
declare
  pre      uuid := gen_random_uuid();   -- president
  vp       uuid := gen_random_uuid();   -- vice president
  dev      uuid := gen_random_uuid();   -- developer
  dev2     uuid := gen_random_uuid();   -- a second developer
  tre      uuid := gen_random_uuid();   -- treasurer
  mem      uuid := gen_random_uuid();   -- member, no privileged role
  mem2     uuid := gen_random_uuid();   -- another member
  fresh    uuid := gen_random_uuid();   -- added by create-member, flag set
  retired  uuid := gen_random_uuid();   -- vice president, now alumni
  newbie   uuid := gen_random_uuid();   -- a login create-member adds below
  c        record;
  got      text;
  lines    text[] := '{}';
  failures text[] := '{}';
  can_stmt  constant text := 'select count(*) from (select 1 where can_reset_password(%L)) x';
  mark_stmt constant text := 'select count(*) from (select mark_password_reset(%L)) x';
  flag_stmt constant text := 'update members set must_change_password = %L where id = %L';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@temppw.test'), (vp, 'vp@temppw.test'), (dev, 'dev@temppw.test'),
    (dev2, 'dev2@temppw.test'), (tre, 'tre@temppw.test'), (mem, 'mem@temppw.test'),
    (mem2, 'mem2@temppw.test'), (fresh, 'fresh@temppw.test'),
    (retired, 'retired@temppw.test'), (newbie, 'newbie@temppw.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Tpw President', 'Team lead', 'active'), (vp, 'Tpw Vice', 'Operations', 'active'),
    (dev, 'Tpw Developer', 'Software', 'active'), (dev2, 'Tpw Developer Two', 'Software', 'active'),
    (tre, 'Tpw Treasurer', 'Finance', 'active'), (mem, 'Tpw Member', 'Chassis', 'active'),
    (mem2, 'Tpw Member Two', 'Chassis', 'active'), (retired, 'Tpw Retired VP', 'Operations', 'alumni');
  insert into members (id, full_name, role, must_change_password) values
    (fresh, 'Tpw Fresh', 'Member', true);
  insert into member_roles (member_id, role) values
    (pre, 'president'), (vp, 'vicepresident'), (dev, 'developer'), (dev2, 'developer'),
    (tre, 'treasurer'), (retired, 'vicepresident');

  -- Existing people are left alone: the column's default is false.
  if exists (select 1 from members where id in (pre, vp, dev, dev2, tre, mem, mem2, retired) and must_change_password) then
    failures := failures || 'a member added without the flag has it set'::text;
    lines := lines || 'FAIL  members added without the flag do not have it'::text;
  else
    lines := lines || 'ok    members added without the flag do not have it'::text;
  end if;

  for c in
    select * from (values
      -- The flag itself: nobody writes it through the API.
      ('member clears their own flag',           fresh, format(flag_stmt, false, fresh), 'write', 'DENIED'),
      ('member sets their own flag',             mem,   format(flag_stmt, true, mem),    'write', 'DENIED'),
      ('president sets a member''s flag',        pre,   format(flag_stmt, true, mem),    'write', 'DENIED'),
      ('developer clears a member''s flag',      dev,   format(flag_stmt, false, fresh), 'write', 'DENIED'),
      ('flagged member edits their phone',       fresh, format('update members set phone = %L where id = %L', '123', fresh), 'write', 'ALLOWED'),
      ('create-member inserts a flagged row',    pre,   format('insert into members (id, full_name, role, must_change_password) values (%L, %L, ''Member'', true)', newbie, 'Tpw Newbie'), 'write', 'ALLOWED'),

      -- Who may reset whom.
      ('president   may reset a member',         pre,     format(can_stmt, mem),   'read', 'ALLOWED'),
      ('president   may reset the VP',           pre,     format(can_stmt, vp),    'read', 'ALLOWED'),
      ('president   may reset the treasurer',    pre,     format(can_stmt, tre),   'read', 'ALLOWED'),
      ('president   may not reset a developer',  pre,     format(can_stmt, dev),   'read', 'DENIED'),
      ('president   may not reset themselves',   pre,     format(can_stmt, pre),   'read', 'DENIED'),
      ('VP          may reset a member',         vp,      format(can_stmt, mem),   'read', 'ALLOWED'),
      ('VP          may reset the treasurer',    vp,      format(can_stmt, tre),   'read', 'ALLOWED'),
      ('VP          may not reset the president', vp,     format(can_stmt, pre),   'read', 'DENIED'),
      ('VP          may not reset a developer',  vp,      format(can_stmt, dev),   'read', 'DENIED'),
      ('developer   may reset the president',    dev,     format(can_stmt, pre),   'read', 'ALLOWED'),
      ('developer   may reset another developer', dev,    format(can_stmt, dev2),  'read', 'ALLOWED'),
      ('developer   may not reset themselves',   dev,     format(can_stmt, dev),   'read', 'DENIED'),
      ('treasurer   may not reset a member',     tre,     format(can_stmt, mem),   'read', 'DENIED'),
      ('member      may not reset a member',     mem,     format(can_stmt, mem2),  'read', 'DENIED'),
      ('retired VP  may not reset a member',     retired, format(can_stmt, mem),   'read', 'DENIED'),
      ('anon        cannot call the check',      null,    format(can_stmt, mem),   'read', 'DENIED'),
      ('nobody      resets a login not on the roster', pre, format(can_stmt, gen_random_uuid()), 'read', 'DENIED'),

      -- The database half of a reset.
      ('VP          marks the president reset',  vp,      format(mark_stmt, pre),  'read', 'DENIED'),
      ('member      marks a member reset',       mem,     format(mark_stmt, mem2), 'read', 'DENIED'),
      ('anon        marks a member reset',       null,    format(mark_stmt, mem2), 'read', 'DENIED'),
      ('president   marks a member reset',       pre,     format(mark_stmt, mem),  'read', 'ALLOWED')
    ) as t(label, who, stmt, kind, expected)
  loop
    got := pg_temp.attempt(c.who, c.stmt, c.kind);
    lines := lines || format('%s  %-45s expected %-7s got %s',
      case when got = c.expected then 'ok  ' else 'FAIL' end, c.label, c.expected, got);
    if got <> c.expected then
      failures := failures || format('%s: expected %s, got %s', c.label, c.expected, got);
    end if;
  end loop;

  -- What the refused writes left behind, and what the allowed reset did.
  if (select must_change_password from members where id = fresh) is not true
     or (select must_change_password from members where id = newbie) is not true then
    failures := failures || 'a flag set by create-member was lost'::text;
    lines := lines || 'FAIL  flags set by create-member are still set'::text;
  else
    lines := lines || 'ok    flags set by create-member are still set'::text;
  end if;
  if (select must_change_password from members where id = mem2) then
    failures := failures || 'a refused reset set the flag'::text;
    lines := lines || 'FAIL  refused resets left the flag alone'::text;
  else
    lines := lines || 'ok    refused resets left the flag alone'::text;
  end if;
  if (select must_change_password from members where id = mem) is not true then
    failures := failures || 'mark_password_reset() did not set the flag'::text;
    lines := lines || 'FAIL  mark_password_reset() sets the flag'::text;
  else
    lines := lines || 'ok    mark_password_reset() sets the flag'::text;
  end if;
  if not exists (
    select 1 from activity
    where entity = 'member' and entity_id = mem::text and action = 'password_reset'
      and actor_id = pre and detail = '{}'::jsonb
  ) or exists (
    select 1 from activity where entity = 'member' and entity_id in (pre::text, mem2::text) and action = 'password_reset'
  ) then
    failures := failures || 'the reset was not logged once, to the president, with an empty detail'::text;
    lines := lines || 'FAIL  only the allowed reset is logged, to whoever did it'::text;
  else
    lines := lines || 'ok    only the allowed reset is logged, to whoever did it'::text;
  end if;

  -- The service role (no auth.uid()) is how set-own-password clears it.
  update members set must_change_password = false where id = fresh;
  if (select must_change_password from members where id = fresh) then
    failures := failures || 'the service role could not clear the flag'::text;
    lines := lines || 'FAIL  the service role clears the flag'::text;
  else
    lines := lines || 'ok    the service role clears the flag'::text;
  end if;

  if array_length(failures, 1) > 0 then
    raise exception E'TEMPORARY PASSWORD CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'TEMPORARY PASSWORD CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
