-- =============================================================================
--  Public site checks for Reqon (membership_applications, blog_posts, events,
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
  evm      uuid := gen_random_uuid();
  vp       uuid := gen_random_uuid();
  mem      uuid := gen_random_uuid();
  app      uuid;
  post     uuid;
  ev       uuid;
  c        record;
  got      text;
  author   text;
  ok_apply text;
  lines    text[] := '{}';
  failures text[] := '{}';
begin
  insert into auth.users (id, email) values
    (rec, 'pub-rec@roles.test'), (blogger, 'pub-blog@roles.test'), (mem, 'pub-mem@roles.test'),
    (evm, 'pub-ev@roles.test'), (vp, 'pub-vp@roles.test');
  insert into members (id, full_name, role, status) values
    (rec, 'Pub Recruiter', 'Team', 'active'), (blogger, 'Pub Blogger', 'Team', 'active'), (mem, 'Pub Member', 'Team', 'active'),
    (evm, 'Pub Events', 'Team', 'active'), (vp, 'Pub VP', 'Team', 'active');
  insert into member_roles (member_id, role) values (rec, 'recruitment'), (blogger, 'blog'), (evm, 'events'), (vp, 'vicepresident');
  insert into membership_applications (full_name, email, consent) values ('Seed', 'seed@example.com', true) returning id into app;
  insert into blog_posts (slug, title, content, status) values ('pub-hello', 'Hello', 'First post', 'published') returning id into post;
  insert into blog_posts (slug, title, content) values ('pub-secret', 'Secret', 'Not yet');
  insert into events (title, starts_at) values ('Pub meetup', now() + interval '1 day') returning id into ev;
  insert into events (title, starts_at, is_published) values ('Pub hidden', now() + interval '2 days', false);

  ok_apply := 'select count(*) from (select submit_application(''Ann'', ''ann@example.com'', null, true, ''{}''::jsonb)) s';

  create temp table checks (n serial, label text, who uuid, stmt text, kind text, expected text);
  insert into checks (label, who, stmt, kind, expected) values
    ('anon          reads published posts',    null,    'select count(*) from blog_posts where slug = ''pub-hello''', 'read', 'ALLOWED'),
    ('anon          reads drafts',             null,    'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'DENIED'),
    ('member        reads drafts',             mem,     'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'DENIED'),
    ('blogger       reads drafts',             blogger, 'select count(*) from blog_posts where slug = ''pub-secret''', 'read', 'ALLOWED'),
    ('member        reads applications',       mem,     'select count(*) from membership_applications', 'read', 'DENIED'),
    ('blogger       reads applications',       blogger, 'select count(*) from membership_applications', 'read', 'DENIED'),
    ('recruiter     reads applications',       rec,     'select count(*) from membership_applications', 'read', 'ALLOWED'),
    ('anon          applies without consent',  null,    replace(ok_apply, 'null, true', 'null, false'), 'read', 'ERROR 23514'),
    ('anon          applies, bad email',       null,    replace(ok_apply, 'ann@example.com', 'nope'), 'read', 'ERROR 23514'),
    ('anon          applies',                  null,    ok_apply, 'read', 'ALLOWED'),
    ('member        sets a status',            mem,     format('update membership_applications set status = ''accepted'' where id = %L', app), 'write', 'DENIED'),
    ('recruiter     sets a status',            rec,     format('update membership_applications set status = ''contacted'' where id = %L', app), 'write', 'ALLOWED'),
    ('recruiter     adds a post',              rec,     'insert into blog_posts (slug, title, content) values (''pub-t'', ''T'', ''B'')', 'write', 'DENIED'),
    ('blogger       adds a post',              blogger, 'insert into blog_posts (slug, title, content, author_name, published_at, status) values (''pub-news'', ''News'', ''Body'', ''Forged'', ''2000-01-01'', ''published'')', 'write', 'ALLOWED'),
    ('blogger       reuses an address',        blogger, 'insert into blog_posts (slug, title, content) values (''pub-news'', ''Again'', ''B'')', 'write', 'ERROR 23505'),
    ('member        edits a post',             mem,     format('update blog_posts set title = ''x'' where id = %L', post), 'write', 'DENIED'),
    ('blogger       edits a post',             blogger, format('update blog_posts set title = ''Hello again'' where id = %L', post), 'write', 'ALLOWED'),
    ('blogger       deletes an application',   blogger, format('delete from membership_applications where id = %L', app), 'write', 'DENIED'),
    ('recruiter     deletes an application',   rec,     format('delete from membership_applications where id = %L', app), 'write', 'ALLOWED'),
    ('anon          reads published events',   null,    'select count(*) from events where title = ''Pub meetup''', 'read', 'ALLOWED'),
    ('anon          reads hidden events',      null,    'select count(*) from events where title = ''Pub hidden''', 'read', 'DENIED'),
    ('blogger       reads hidden events',      blogger, 'select count(*) from events where title = ''Pub hidden''', 'read', 'DENIED'),
    ('events        reads hidden events',      evm,     'select count(*) from events where title = ''Pub hidden''', 'read', 'ALLOWED'),
    ('member        adds an event',            mem,     'insert into events (title, starts_at) values (''X'', now())', 'write', 'DENIED'),
    ('blogger       adds an event',            blogger, 'insert into events (title, starts_at) values (''X'', now())', 'write', 'DENIED'),
    ('events        adds a post',              evm,     'insert into blog_posts (slug, title, content) values (''pub-e'', ''E'', ''B'')', 'write', 'DENIED'),
    ('events        adds an event',            evm,     'insert into events (title, type, starts_at, signup_url) values (''Ride'', ''ride'', now(), ''https://example.com/a'')', 'write', 'ALLOWED'),
    ('events        adds a script link',       evm,     'insert into events (title, starts_at, signup_url) values (''Bad'', now(), ''javascript:alert(1)'')', 'write', 'ERROR 23514'),
    ('member        edits an event',           mem,     format('update events set title = ''x'' where id = %L', ev), 'write', 'DENIED'),
    ('vice-pres.    reads applications',       vp,      'select count(*) from membership_applications', 'read', 'ALLOWED'),
    ('vice-pres.    adds a post',              vp,      'insert into blog_posts (slug, title, content) values (''pub-vp'', ''VP'', ''B'')', 'write', 'ALLOWED'),
    ('vice-pres.    adds an event',            vp,      'insert into events (title, starts_at) values (''VP ride'', now())', 'write', 'ALLOWED'),
    ('events        deletes an event',         evm,     format('delete from events where id = %L', ev), 'write', 'ALLOWED');

  for c in select * from checks order by n loop
    got := pg_temp.attempt(c.who, c.stmt, c.kind);
    if c.expected like 'ERROR %' and got like c.expected || '%' then got := c.expected; end if;
    lines := lines || format('%s  %-40s expected %-11s got %s',
      case when got = c.expected then 'ok  ' else 'FAIL' end, c.label, c.expected, got);
    if got <> c.expected then
      failures := failures || format('%s: expected %s, got %s', c.label, c.expected, got);
    end if;
  end loop;

  -- The database, not the browser, names the writer and dates the post.
  select author_name into author from blog_posts where slug = 'pub-news' and published_at > now() - interval '1 minute';
  if author is distinct from 'Pub Blogger' then failures := failures || format('author not stamped: %s', author); end if;
  lines := lines || '  -> a forged author and date are replaced'::text;

  -- Back to a draft clears the date; publishing again dates it now (as the Blog member, so the stamp applies).
  perform pg_temp.attempt(blogger, format('update blog_posts set status = ''draft'' where id = %L', post), 'write');
  if (select published_at from blog_posts where id = post) is not null then failures := failures || 'unpublishing kept published_at'::text; end if;
  perform pg_temp.attempt(blogger, format('update blog_posts set status = ''published'' where id = %L', post), 'write');
  if (select published_at from blog_posts where id = post) is null then failures := failures || 'publishing did not set published_at'::text; end if;
  lines := lines || '  -> draft clears the date, publishing sets it'::text;

  if array_length(failures, 1) > 0 then
    raise exception E'PUBLIC SITE CHECKS FAILED — % problem(s).\n%\n\nFull run:\n%',
      array_length(failures, 1), array_to_string(failures, E'\n'), array_to_string(lines, E'\n');
  end if;
  raise exception E'PUBLIC SITE CHECKS PASSED — all % checks behaved as expected. Every test row has been rolled back.\n%',
    array_length(lines, 1), array_to_string(lines, E'\n');
end
$test$;
