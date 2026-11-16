-- =============================================================================
--  Public site, step 2 of 2: the application form, applications and the blog.
--
--  The club's public website reads straight from this database with the anon key. It already has its own
--  tables, created by the website project outside this repository:
--    * blog_posts               status 'draft' | 'published'; the website shows the published ones.
--    * membership_applications  what people send from the website's "Join" form.
--  This file mirrors them (create ... if not exists — a no-op on the hosted project, where they exist) so a
--  fresh database matches production, and lets Reqon run them:
--    * application_questions  NEW. The questions the form asks. Anyone reads them.
--    * submit_application()   NEW. Sends an application, checks required answers, and copies each question's
--                             wording next to its answer, so editing the form later never changes an old one.
--
--    questions                read anyone (anon included); write can_manage_applicants()  Recruitment or Developer
--    membership_applications  read, change status, delete: can_manage_applicants()
--    blog_posts               read the published ones: anyone; read drafts and write: can_post_blog()  Blog or Developer
--
--  Reqon's policies are named reqon_* and only ADD access; the website's own policies are left as they are.
--  Not season-scoped: the website outlives a season.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let the club run its public website's application form and blog from Reqon.
--    Existing data  Untouched. On the hosted project: one new table, four functions, one trigger function,
--                   two triggers and the reqon_* policies. No column of an existing table changes.
--    Locking        CREATE TABLE / CREATE POLICY / CREATE TRIGGER: brief locks on two empty tables.
--    Rollback       DROP TABLE application_questions; DROP the reqon_* policies and the trg_reqon_* triggers;
--                   DROP FUNCTION submit_application, stamp_blog_post, can_manage_applicants, can_post_blog.
--    Deploy order   After 20260162000000 (the enum values must be committed).
-- =============================================================================

create or replace function can_manage_applicants() returns boolean
language sql stable security definer set search_path = public as $fn$
  select has_role('recruitment') or has_role('developer');
$fn$;

create or replace function can_post_blog() returns boolean
language sql stable security definer set search_path = public as $fn$
  select has_role('blog') or has_role('developer');
$fn$;

revoke all on function can_manage_applicants(), can_post_blog() from public, anon;
grant execute on function can_manage_applicants(), can_post_blog() to authenticated, service_role;

comment on function can_manage_applicants() is
  'Edit the public application form, read applications and set their status: Recruitment or Developer.';
comment on function can_post_blog() is
  'Write, edit, publish and delete public blog posts: Blog or Developer.';

-- --------------------------------------------- the website's tables (mirrored)
do $$ begin create type blog_category as enum ('ride', 'track', 'news', 'tech');
exception when duplicate_object then null; end $$;
do $$ begin create type blog_post_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;
do $$ begin create type membership_application_status as enum ('new', 'contacted', 'accepted', 'rejected');
exception when duplicate_object then null; end $$;

-- Matches the hosted table: reading_minutes is GENERATED there, so nothing may write it.
create table if not exists blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (btrim(title) <> ''),
  excerpt          text,
  content          text not null default '',
  category         blog_category not null default 'news',
  cover_image_url  text,
  cover_image_alt  text,
  author_name      text not null default '',
  is_featured      boolean not null default false,
  reading_minutes  integer generated always as (greatest(1::numeric, ceil(coalesce(array_length(
                     regexp_split_to_array(btrim(content), '\s+'), 1), 0)::numeric / 200.0))::integer) stored,
  status           blog_post_status not null default 'draft',
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists membership_applications (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,
  phone       text,
  consent     boolean not null,
  answers     jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 20000),
  status      membership_application_status not null default 'new',
  notes       text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- questions
create table if not exists application_questions (
  id          uuid primary key default gen_random_uuid(),
  prompt      text not null check (length(btrim(prompt)) between 1 and 300),
  help        text check (help is null or length(btrim(help)) between 1 and 500),
  -- 'short' is one line, 'long' a paragraph. The website draws the field from it.
  kind        text not null default 'short' check (kind in ('short', 'long')),
  required    boolean not null default false,
  position    integer not null default 0,
  created_by  uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_stamp_actor on application_questions;
create trigger trg_stamp_actor before insert or update on application_questions
  for each row execute function stamp_actor_columns('created_by');
drop trigger if exists trg_touch on application_questions;
create trigger trg_touch before update on application_questions
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------ blog post stamps
-- A post written in Reqon is signed with the writer's roster name and dated by the database: publishing a
-- draft dates it now, editing a published post keeps its date, switching it back to a draft clears it.
-- Writes that do not come from a signed-in member (the website project, the service role) are left alone.
create or replace function stamp_blog_post() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_name := coalesce((select full_name from members where id = auth.uid()), new.author_name);
    new.published_at := case when new.status = 'published' then now() end;
  else
    new.author_name := old.author_name;
    new.published_at := case
      when new.status <> 'published' then null
      when old.status = 'published' then old.published_at
      else now()
    end;
  end if;
  return new;
end $fn$;

revoke all on function stamp_blog_post() from public, anon, authenticated;

drop trigger if exists trg_reqon_stamp on blog_posts;
create trigger trg_reqon_stamp before insert or update on blog_posts
  for each row execute function stamp_blog_post();
drop trigger if exists trg_reqon_touch on blog_posts;
create trigger trg_reqon_touch before update on blog_posts
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------------------- RLS
alter table application_questions enable row level security;
alter table membership_applications enable row level security;
alter table blog_posts enable row level security;

revoke all on application_questions from anon, authenticated;
grant select on application_questions, blog_posts to anon;
grant select, insert, update, delete on application_questions, blog_posts to authenticated;
grant select, update, delete on membership_applications to authenticated;

drop policy if exists application_questions_read  on application_questions;
drop policy if exists application_questions_write on application_questions;
create policy application_questions_read on application_questions for select to anon, authenticated
  using (true);
create policy application_questions_write on application_questions for all to authenticated
  using (can_manage_applicants()) with check (can_manage_applicants());

drop policy if exists reqon_applications_read   on membership_applications;
drop policy if exists reqon_applications_update on membership_applications;
drop policy if exists reqon_applications_delete on membership_applications;
create policy reqon_applications_read on membership_applications for select to authenticated
  using (can_manage_applicants());
create policy reqon_applications_update on membership_applications for update to authenticated
  using (can_manage_applicants()) with check (can_manage_applicants());
create policy reqon_applications_delete on membership_applications for delete to authenticated
  using (can_manage_applicants());

-- Drafts are readable through reqon_blog_posts_write (can_post_blog()), which also covers SELECT.
drop policy if exists reqon_blog_posts_read  on blog_posts;
drop policy if exists reqon_blog_posts_write on blog_posts;
create policy reqon_blog_posts_read on blog_posts for select to anon, authenticated
  using (status = 'published');
create policy reqon_blog_posts_write on blog_posts for all to authenticated
  using (can_post_blog()) with check (can_post_blog());

-- ---------------------------------------------------------- submit_application
-- The website's "Join" form. p_answers is { "<question id>": "answer", … }, and answers is stored as
-- [{ "question": "…", "answer": "…" | null }, …] in the form's order at the time.
create or replace function submit_application(
  p_full_name text, p_email text, p_phone text, p_consent boolean, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_id      uuid;
  v_answers jsonb := '[]';
  v_answer  text;
  q         record;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'p_answers must be a JSON object of {question_id: answer}' using errcode = '22023';
  end if;
  if coalesce(p_consent, false) is false then
    raise exception 'Please agree to the club keeping your application.' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 120 then
    raise exception 'Please give your name.' using errcode = '23514';
  end if;
  -- SIMILAR TO matches the whole value, so these need no anchors. (The Supabase CLI splits migration files into
  -- statements itself and mis-split this function while its regexes held dollar signs and backslashes.)
  if not coalesce(btrim(p_email) similar to '[^@[:space:]]+@[^@[:space:]]+.[^@[:space:]]+', false) or length(p_email) > 254 then
    raise exception 'Please give a valid email address.' using errcode = '23514';
  end if;
  if nullif(btrim(p_phone), '') is not null and not btrim(p_phone) similar to '[+]?[0-9 ()./-]{4,30}' then
    raise exception 'Please check the phone number.' using errcode = '23514';
  end if;
  -- ponytail: one global cap, since anon has no identity to limit per sender. Add a captcha in front if spam arrives.
  if (select count(*) from membership_applications where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many applications right now. Please try again in an hour.' using errcode = '54000';
  end if;

  for q in select * from application_questions order by position, created_at loop
    v_answer := nullif(btrim(coalesce(p_answers ->> q.id::text, '')), '');
    if v_answer is null and q.required then
      raise exception 'Please answer: %', q.prompt using errcode = '23502';
    end if;
    if length(v_answer) > 5000 or (q.kind = 'short' and length(v_answer) > 500) then
      raise exception 'The answer to “%” is too long.', q.prompt using errcode = '22001';
    end if;
    v_answers := v_answers || jsonb_build_array(jsonb_build_object('question', q.prompt, 'answer', v_answer));
  end loop;

  insert into membership_applications (full_name, email, phone, consent, answers)
  values (btrim(p_full_name), btrim(p_email), nullif(btrim(p_phone), ''), true, v_answers)
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function submit_application(text, text, text, boolean, jsonb) from public;
grant execute on function submit_application(text, text, text, boolean, jsonb) to anon, authenticated, service_role;

comment on table application_questions is
  'Questions on the public website''s application form. Read by anyone; edited by Recruitment or a Developer.';
