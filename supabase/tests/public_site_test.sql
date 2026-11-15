-- =============================================================================
--  Public site checks for Reqon (application_questions, membership_applications, blog_posts,
--  submit_application(); migration 20260162000100).
--
--  SAFE TO RUN AGAINST THE REAL PROJECT. Everything happens inside one block
--  that always ends by raising an exception, so every change is rolled back.
--  The result arrives as an "error" that begins with
--      PUBLIC SITE CHECKS PASSED   or   PUBLIC SITE CHECKS FAILED
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
    when insufficient_privilege then return 'DENIED';
    when others then return 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
end $fn$;

do $test$
declare
  rec      uuid := gen_random_uuid();
  blogger  uuid := gen_random_uuid();
  mem      uuid := gen_random_uuid();
  q_req    uuid;
  app      uuid;
  post     uuid;
  c        record;
  got      text;
  snap     jsonb;
  author   text;
  ok_apply text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (rec, 'pub-rec@roles.test'), (blogger, 'pub-blog@roles.test'), (mem, 'pub-mem@roles.test');
  insert into members (id, full_name, role, status) values
    (rec, 'Pub Recruiter', 'Team', 'active'), (blogger, 'Pub Blogger', 'Team', 'active'), (mem, 'Pub Member', 'Team', 'active');
  insert into member_roles (member_id, role) values (rec, 'recruitment'), (blogger, 'blog');
  insert into application_questions (prompt, required, position) values ('Why join?', true, 1) returning id into q_req;
  insert into membership_applications (full_name, email, consent) values ('Seed', 'seed@example.com', true) returning id into app;
  insert into blog_posts (slug, title, content, status) values ('pub-hello', 'Hello', 'First post', 'published') returning id into post;
  insert into blog_posts (slug, title, content) values ('pub-secret', 'Secret', 'Not yet');

  ok_apply := format('select count(*) from (select submit_application(''Ann'', ''ann@example.com'', null, true, %L::jsonb)) s',
    jsonb_build_object(q_req::text, 'Bikes'));

  create temp table checks (n serial, label text, who uuid, stmt text, kind text, expected text);
  insert into checks (label, who, stmt, kind, expected) values
    ('anon          reads questions',          null,    'select count(*) from application_questions', 'read', 'ALLOWED'),
    ('anon          reads published posts',    null,    'select count(*) from blog_posts where slug = ''pub-hello''', 'read', 'ALLOWED'),
    ('anon          reads drafts',             null,    'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'DENIED'),
    ('member        reads drafts',             mem,     'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'DENIED'),
    ('blogger       reads drafts',             blogger, 'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'ALLOWED'),
    ('member        reads applications',       mem,     'select count(*) from membership_applications', 'read', 'DENIED'),
    ('blogger       reads applications',       blogger, 'select count(*) from membership_applications', 'read', 'DENIED'),
    ('recruiter     reads applications',       rec,     'select count(*) from membership_applications', 'read', 'ALLOWED'),
    ('anon          applies, missing answer',  null,    'select count(*) from (select submit_application(''Ann'', ''ann@example.com'', null, true, ''{}''::jsonb)) s', 'read', 'ERROR 23502'),
    ('anon          applies without consent',  null,    replace(ok_apply, 'null, true', 'null, false'), 'read', 'ERROR 23514'),
    ('anon          applies, bad email',       null,    replace(ok_apply, 'ann@example.com', 'nope'), 'read', 'ERROR 23514'),
    ('anon          applies',                  null,    ok_apply, 'read', 'ALLOWED'),
    ('member        adds a question',          mem,     'insert into application_questions (prompt) values (''Q'')', 'write', 'DENIED'),
    ('blogger       adds a question',          blogger, 'insert into application_questions (prompt) values (''Q'')', 'write', 'DENIED'),
    ('recruiter     adds a question',          rec,     'insert into application_questions (prompt, kind) values (''Your year?'', ''short'')', 'write', 'ALLOWED'),
    ('recruiter     adds a bad kind',          rec,     'insert into application_questions (prompt, kind) values (''Q'', ''essay'')', 'write', 'ERROR 23514'),
    ('member        sets a status',            mem,     format('update membership_applications set status = ''accepted'' where id = %L', app), 'write', 'DENIED'),
    ('recruiter     sets a status',            rec,     format('update membership_applications set status = ''contacted'' where id = %L', app), 'write', 'ALLOWED'),
    ('recruiter     adds a post',              rec,     'insert into blog_posts (slug, title, content) values (''pub-t'', ''T'', ''B'')', 'write', 'DENIED'),
    ('blogger       adds a post',              blogger, 'insert into blog_posts (slug, title, content, author_name, published_at, status) values (''pub-news'', ''News'', ''Body'', ''Forged'', ''2000-01-01'', ''published'')', 'write', 'ALLOWED'),
    ('blogger       reuses an address',        blogger, 'insert into blog_posts (slug, title, content) values (''pub-news'', ''Again'', ''B'')', 'write', 'ERROR 23505'),
    ('member        edits a post',             mem,     format('update blog_posts set title = ''x'' where id = %L', post), 'write', 'DENIED'),
    ('blogger       edits a post',             blogger, format('update blog_posts set title = ''Hello again'' where id = %L', post), 'write', 'ALLOWED'),
    ('blogger       deletes an application',   blogger, format('delete from membership_applications where id = %L', app), 'write', 'DENIED'),
    ('recruiter     deletes an application',   rec,     format('delete from membership_applications where id = %L', app), 'write', 'ALLOWED');

  for c in select * from checks order by n loop
    got := pg_temp.attempt(c.who, c.stmt, c.kind);
    if c.expected like 'ERROR %' and got like c.expected || '%' then got := c.expected; end if;
    lines := lines || format('%s  %-40s expected %-11s got %s',
      case when got = c.expected then 'ok  ' else 'FAIL' end, c.label, c.expected, got);
    if got <> c.expected then
      failures := failures || format('%s: expected %s, got %s', c.label, c.expected, got);
    end if;
  end loop;

  -- The application keeps the question's wording, so editing the form later does not change it.
  update application_questions set prompt = 'Why do you want to join?' where id = q_req;
  select answers into snap from membership_applications where email = 'ann@example.com';
  if snap is distinct from jsonb_build_array(jsonb_build_object('question', 'Why join?', 'answer', 'Bikes')) then
    failures := failures || format('application answers not snapshotted: %s', snap);
  end if;
  lines := lines || '  -> answers are stored with the question text';

  -- The database, not the browser, names the writer and dates the post.
  select author_name into author from blog_posts where slug = 'pub-news' and published_at > now() - interval '1 minute';
  if author is distinct from 'Pub Blogger' then failures := failures || format('author not stamped: %s', author); end if;
  lines := lines || '  -> a forged author and date are replaced';

  -- Back to a draft clears the date; publishing again dates it now (as the Blog member, so the stamp applies).
  perform pg_temp.attempt(blogger, format('update blog_posts set status = ''draft'' where id = %L', post), 'write');
  if (select published_at from blog_posts where id = post) is not null then failures := failures || 'unpublishing kept published_at'; end if;
  perform pg_temp.attempt(blogger, format('update blog_posts set status = ''published'' where id = %L', post), 'write');
  if (select published_at from blog_posts where id = post) is null then failures := failures || 'publishing did not set published_at'; end if;
  lines := lines || '  -> draft clears the date, publishing sets it';

  if array_length(failures, 1) > 0 then
    raise exception E'PUBLIC SITE CHECKS FAILED — % problem(s).\n%\n\nFull run:\n%',
      array_length(failures, 1), array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'PUBLIC SITE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
