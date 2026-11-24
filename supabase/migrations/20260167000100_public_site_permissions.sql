-- =============================================================================
--  Public site permissions, step 2 of 2: three separate permissions, always held by the President and VP.
--
--    applicants  can_manage_applicants()  Recruitment, President, Vice President, Developer
--    blog        can_post_blog()          Blog,        President, Vice President, Developer
--    events      can_manage_events()      Events,      President, Vice President, Developer   NEW
--
--  BEFORE. Only Recruitment / Blog (and a Developer) passed; the President and Vice President could not open the
--  Public page at all, and the Blog role covered events as well as posts.
--  AFTER. The President and Vice President pass all three through their own role, not a member_roles row, so no
--  role edit can take it away from them. Events are their own role, granted in Settings → Roster like the others.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Separate the events permission from the blog one; give the President and VP every public one.
--    Existing data  Everyone who holds Blog today is also given Events, so nobody loses access they had.
--    Locking        CREATE POLICY on events: brief.
--    Rollback       Restore the two functions from 20260162000100, point reqon_events_* back at can_post_blog(),
--                   DROP FUNCTION can_manage_events(); DELETE FROM member_roles WHERE role = 'events'.
--    Deploy order   After 20260167000000 (the enum value must be committed).
-- =============================================================================

create or replace function can_manage_applicants() returns boolean
language sql stable security definer set search_path = public as $fn$
  select has_role('recruitment') or has_role('president') or has_role('vicepresident') or has_role('developer');
$fn$;

create or replace function can_post_blog() returns boolean
language sql stable security definer set search_path = public as $fn$
  select has_role('blog') or has_role('president') or has_role('vicepresident') or has_role('developer');
$fn$;

create or replace function can_manage_events() returns boolean
language sql stable security definer set search_path = public as $fn$
  select has_role('events') or has_role('president') or has_role('vicepresident') or has_role('developer');
$fn$;

revoke all on function can_manage_events() from public, anon;
grant execute on function can_manage_events() to authenticated, service_role;

comment on function can_manage_applicants() is
  'Read applications, set their status and delete them: Recruitment, President, Vice President or Developer.';
comment on function can_post_blog() is
  'Write, edit, publish and delete public blog posts: Blog, President, Vice President or Developer.';
comment on function can_manage_events() is
  'Add, edit, hide and delete public events: Events, President, Vice President or Developer.';

-- Hidden events are readable through reqon_events_write, which also covers SELECT.
drop policy if exists reqon_events_write on events;
create policy reqon_events_write on events for all to authenticated
  using (can_manage_events()) with check (can_manage_events());

insert into member_roles (member_id, role)
select member_id, 'events' from member_roles where role = 'blog'
on conflict do nothing;
