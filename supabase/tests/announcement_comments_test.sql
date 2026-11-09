-- =============================================================================
--  Announcement comments (20260158000000): who may read, write and delete.
--
--  SAFE TO RUN AGAINST THE REAL PROJECT: one DO block that always raises, so every
--  fixture rolls back. Fixture people are new @comment-test.test identities.
--
--  Result: ANNOUNCEMENT COMMENT CHECKS PASSED / FAILED.
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
    when others then result := 'ERROR ' || sqlstate;
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
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); gone uuid := gen_random_uuid(); pre uuid := gen_random_uuid();
  ann bigint; ca bigint; total int; bad int; report text;
begin
  insert into auth.users (id, email) values (a, 'a@comment-test.test'), (b, 'b@comment-test.test'), (gone, 'gone@comment-test.test'), (pre, 'pre@comment-test.test');
  insert into members (id, full_name, role, status) values (a, 'CT A', 'Member', 'active'), (b, 'CT B', 'Member', 'active'),
    (gone, 'CT Alumni', 'Member', 'alumni'), (pre, 'CT President', 'Member', 'active');
  insert into member_roles (member_id, role) values (pre, 'president');
  insert into announcements (author_id, title, body) values (pre, 'T', 'Body') returning id into ann;

  perform pg_temp.expect('an active member comments as themselves',
    pg_temp.attempt(a, format('insert into announcement_comments (announcement_id, author_id, body) values (%s, %L, ''Hello'')', ann, a)), 'ALLOWED');
  select id into ca from announcement_comments where author_id = a;
  perform pg_temp.expect('... and cannot comment as someone else',
    pg_temp.attempt(a, format('insert into announcement_comments (announcement_id, author_id, body) values (%s, %L, ''Hi'')', ann, b)), 'DENIED');
  perform pg_temp.expect('an empty comment is refused',
    pg_temp.attempt(a, format('insert into announcement_comments (announcement_id, author_id, body) values (%s, %L, ''   '')', ann, a)), 'ERROR 23514');
  perform pg_temp.expect('a 501-character comment is refused',
    pg_temp.attempt(a, format('insert into announcement_comments (announcement_id, author_id, body) values (%s, %L, %L)', ann, a, repeat('x', 501))), 'ERROR 23514');
  perform pg_temp.expect('an alumnus cannot comment',
    pg_temp.attempt(gone, format('insert into announcement_comments (announcement_id, author_id, body) values (%s, %L, ''Hi'')', ann, gone)), 'DENIED');
  perform pg_temp.expect('another member reads the thread',
    pg_temp.attempt(b, format('select 1 from announcement_comments where announcement_id = %s', ann)), 'ALLOWED');
  perform pg_temp.expect('an alumnus reads nothing',
    pg_temp.attempt(gone, format('select 1 from announcement_comments where announcement_id = %s', ann)), 'DENIED');
  perform pg_temp.expect('comments cannot be edited',
    pg_temp.attempt(a, format('update announcement_comments set body = ''edited'' where id = %s', ca)), 'DENIED');
  perform pg_temp.expect('another member cannot delete my comment',
    pg_temp.attempt(b, format('delete from announcement_comments where id = %s', ca)), 'DENIED');
  perform pg_temp.expect('the President can delete any comment',
    pg_temp.attempt(pre, format('delete from announcement_comments where id = %s', ca)), 'ALLOWED');
  insert into announcement_comments (announcement_id, author_id, body) values (ann, a, 'Mine');
  perform pg_temp.expect('the author can delete their own comment',
    pg_temp.attempt(a, format('delete from announcement_comments where author_id = %L', a)), 'ALLOWED');
  insert into announcement_comments (announcement_id, author_id, body) values (ann, a, 'Orphan check');
  delete from announcements where id = ann;
  perform pg_temp.expect('deleting an announcement removes its comments', (select count(*)::text from announcement_comments where announcement_id = ann), '0');

  select count(*), count(*) filter (where not (got like expected || '%')),
         string_agg(case when not (got like expected || '%') then format('  FAIL  %s — expected %s, got %s', label, expected, got) end, E'\n' order by n)
    into total, bad, report from pg_temp.results;
  if bad > 0 then
    raise exception E'ANNOUNCEMENT COMMENT CHECKS FAILED — % of % checks did not behave as expected.\n%', bad, total, report;
  end if;
  raise exception 'ANNOUNCEMENT COMMENT CHECKS PASSED — all % checks', total;
end
$test$;
