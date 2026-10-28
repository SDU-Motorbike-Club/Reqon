-- =============================================================================
--  Profile photo and Settings usage (20260145000000_profile_photo_and_settings_usage.sql).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block that always ends by raising an
--  exception, so Postgres rolls it all back. Fixture people are new auth.users rows with @profile.test addresses.
--
--  Result: an "error" whose message begins with
--      PROFILE CHECKS PASSED   or   PROFILE CHECKS FAILED
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

-- Does this statement get refused (any error)? Returns the SQLSTATE or 'allowed'.
create or replace function pg_temp.tries(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'allowed';
exception when others then
  return sqlstate;
end $fn$;

do $test$
declare
  pre    uuid := gen_random_uuid();   -- president: is_admin()
  ada    uuid := gen_random_uuid();   -- active member
  bo     uuid := gen_random_uuid();   -- another active member
  tri    uuid := gen_random_uuid();   -- on trial
  alum   uuid := gen_random_uuid();   -- retired
  jpg    text := 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
  webp   text := 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';
  n      int;
  s      real;
  err    text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (pre, 'pre@profile.test'), (ada, 'ada@profile.test'), (bo, 'bo@profile.test'),
    (tri, 'tri@profile.test'), (alum, 'alum@profile.test');
  insert into members (id, full_name, role, status) values
    (pre, 'Pf President', 'Lead', 'active'), (ada, 'Pf Ada', 'Software', 'active'),
    (bo, 'Pf Bo', 'Chassis', 'active'), (tri, 'Pf Trial', 'Software', 'trial'), (alum, 'Pf Alumni', 'Software', 'alumni');
  insert into member_roles (member_id, role) values (pre, 'president');

  -- 1. Photos: who may set one.
  perform pg_temp.as_user(ada);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', ada, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'a member sets their own photo (jpeg)', err = 'allowed', err);
  err := pg_temp.tries(format('update member_avatars set image = %L where member_id = %L', webp, ada));
  select * into lines, failures from pg_temp.note(lines, failures, 'and replaces it with a webp', err = 'allowed' and (select image = webp from member_avatars where member_id = ada), err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot set someone else''s photo', err <> 'allowed', err);
  perform pg_temp.as_user(tri);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', tri, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'a trial member sets their own', err = 'allowed', err);
  perform pg_temp.as_user(alum);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', alum, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'a retired member cannot set one', err <> 'allowed', err);

  -- 2. Photos: only a small jpeg or webp picture.
  perform pg_temp.as_user(bo);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='));
  select * into lines, failures from pg_temp.note(lines, failures, 'an SVG is refused (it can carry script)', err = '23514', err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, 'javascript:alert(1)'));
  select * into lines, failures from pg_temp.note(lines, failures, 'a javascript: address is refused', err = '23514', err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, 'data:image/jpeg;base64,not base64!'));
  select * into lines, failures from pg_temp.note(lines, failures, 'text that is not base64 is refused', err = '23514', err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, 'data:image/jpeg;base64,' || repeat('A', 120000)));
  select * into lines, failures from pg_temp.note(lines, failures, 'a picture over the size cap is refused', err = '23514', err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L)', bo, 'data:image/jpeg;base64,' || repeat('A', 119000)));
  select * into lines, failures from pg_temp.note(lines, failures, 'one just under the cap is accepted', err = 'allowed', err);

  -- 3. Photos: who sees and who removes them.
  perform pg_temp.as_user(bo);
  select count(*) into n from member_avatars;
  select * into lines, failures from pg_temp.note(lines, failures, 'every member reads everyone''s photo', n = 3, n::text);
  delete from member_avatars where member_id = ada;
  get diagnostics n = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'a member cannot remove someone else''s photo', n = 0, n::text);
  perform pg_temp.as_user(pre);
  delete from member_avatars where member_id = bo;
  get diagnostics n = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'an admin removes anyone''s', n = 1, n::text);
  perform pg_temp.as_user(ada);
  delete from member_avatars where member_id = ada;
  get diagnostics n = row_count;
  select * into lines, failures from pg_temp.note(lines, failures, 'and a member removes their own', n = 1, n::text);
  perform pg_temp.as_user(null);
  err := pg_temp.tries('select count(*) from member_avatars');
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody signed out reads photos', err <> 'allowed', err);
  perform pg_temp.as_owner();

  -- 3b. The statement the app really sends is PostgREST's upsert: INSERT ... ON CONFLICT (member_id) DO UPDATE SET
  --     every column in the payload. Postgres wants UPDATE privilege on each of those columns, so this is tested
  --     as written, for a first save and for a replacement, as the person themselves.
  perform pg_temp.as_user(pre);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L) on conflict (member_id) do update set member_id = excluded.member_id, image = excluded.image', pre, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'the app''s upsert saves a first photo', err = 'allowed', err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L) on conflict (member_id) do update set member_id = excluded.member_id, image = excluded.image', pre, webp));
  select * into lines, failures from pg_temp.note(lines, failures, 'and replaces it', err = 'allowed' and (select image = webp from member_avatars where member_id = pre), err);
  err := pg_temp.tries(format('insert into member_avatars (member_id, image) values (%L, %L) on conflict (member_id) do update set member_id = excluded.member_id, image = excluded.image', ada, jpg));
  select * into lines, failures from pg_temp.note(lines, failures, 'but it cannot be used to write over someone else''s photo', err <> 'allowed' or not exists (select 1 from member_avatars where member_id = ada), err);
  perform pg_temp.as_owner();

  -- 4. Usage: one use raises the score by one; the second by one more.
  perform pg_temp.as_user(ada);
  perform record_settings_open('roster');
  select score into s from settings_usage where member_id = ada and section = 'roster';
  select * into lines, failures from pg_temp.note(lines, failures, 'a first use scores 1', s = 1, s::text);
  perform record_settings_open('roster');
  select score into s from settings_usage where member_id = ada and section = 'roster';
  select * into lines, failures from pg_temp.note(lines, failures, 'a second use right after scores about 2', s > 1.99 and s < 2.01, s::text);

  -- 5. Usage: it fades by half every 30 days.
  perform pg_temp.as_owner();
  update settings_usage set score = 4, scored_at = now() - interval '30 days' where member_id = ada and section = 'roster';
  perform pg_temp.as_user(ada);
  perform record_settings_open('roster');
  select score into s from settings_usage where member_id = ada and section = 'roster';
  select * into lines, failures from pg_temp.note(lines, failures, '4 left for 30 days is worth 2, plus the new use = 3', s > 2.98 and s < 3.02, s::text);

  -- 6. Usage: privacy, and no way around the function.
  perform record_settings_open('backups');
  perform pg_temp.as_user(bo);
  perform record_settings_open('departments');
  select count(*) into n from settings_usage;
  select * into lines, failures from pg_temp.note(lines, failures, 'a member reads only their own usage', n = 1, n::text);
  err := pg_temp.tries(format('insert into settings_usage (member_id, section, score) values (%L, %L, 99)', bo, 'seasons'));
  select * into lines, failures from pg_temp.note(lines, failures, 'usage cannot be written around the function', err <> 'allowed', err);
  err := pg_temp.tries(format('update settings_usage set score = 99 where member_id = %L', bo));
  select * into lines, failures from pg_temp.note(lines, failures, 'nor edited', err <> 'allowed' or (select score < 2 from settings_usage where member_id = bo and section = 'departments'), err);

  -- 7. Usage: a stray or malicious section id is ignored; the table cannot grow without limit.
  perform record_settings_open('Bad Section!');
  perform record_settings_open(repeat('a', 41));
  perform record_settings_open(null);
  select count(*) into n from settings_usage where member_id = bo;
  select * into lines, failures from pg_temp.note(lines, failures, 'invalid section ids are ignored without an error', n = 1, n::text);
  for i in 1..45 loop
    perform record_settings_open('s' || i);
  end loop;
  select count(*) into n from settings_usage where member_id = bo;
  select * into lines, failures from pg_temp.note(lines, failures, 'a member has at most 40 sections', n = 40, n::text);
  perform record_settings_open('departments');
  select score into s from settings_usage where member_id = bo and section = 'departments';
  select * into lines, failures from pg_temp.note(lines, failures, 'a section already stored can still be counted at the cap', s > 1.99, s::text);
  perform pg_temp.as_user(null);
  err := pg_temp.tries($$select record_settings_open('roster')$$);
  select * into lines, failures from pg_temp.note(lines, failures, 'nobody signed out can record', err <> 'allowed', err);
  perform pg_temp.as_owner();

  if array_length(failures, 1) > 0 then
    raise exception E'PROFILE CHECKS FAILED — % of % checks did not behave as expected.\n%\n\nFull run:\n%',
      array_length(failures, 1), array_length(lines, 1),
      array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'PROFILE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
