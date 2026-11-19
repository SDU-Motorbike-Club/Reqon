-- =============================================================================
--  Public site: events, run from Reqon.
--
--  The website's "Upcoming events" list reads public.events, a table the website project created (its
--  migration 20261109143931). Until now it was edited only in the Supabase dashboard. This file mirrors the
--  table (create ... if not exists: a no-op on the hosted project) so a fresh database matches production,
--  and lets Blog or Developer (can_post_blog()) add, edit, hide and delete events from Reqon.
--
--    events   read the published ones: anyone; read hidden ones and write: can_post_blog()
--
--  signup_url must be an http(s) link: the website puts it straight into an <a href>, so a javascript: link
--  would run on the public site. The check is NOT VALID, so a row already on the hosted table is never refused;
--  only new and edited rows are checked.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let Reqon manage the public website's events.
--    Existing data  Untouched. On the hosted project: one trigger, one check (not validated), two reqon_* policies.
--    Locking        CREATE POLICY / CREATE TRIGGER / ADD CONSTRAINT NOT VALID: brief locks on a small table.
--    Rollback       DROP POLICY reqon_events_read, reqon_events_write ON events; DROP TRIGGER trg_reqon_touch ON events;
--                   ALTER TABLE events DROP CONSTRAINT reqon_events_signup_url_http.
--    Deploy order   After 20260162000100 (can_post_blog()).
-- =============================================================================

do $$ begin create type club_event_type as enum ('ride', 'track', 'meeting', 'workshop', 'social');
exception when duplicate_object then null; end $$;

create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (btrim(title) <> ''),
  type         club_event_type not null default 'meeting',
  starts_at    timestamptz not null,
  location     text,
  signup_url   text,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table events drop constraint if exists reqon_events_signup_url_http;
alter table events add constraint reqon_events_signup_url_http
  check (signup_url is null or signup_url ~* '^https?://[^[:space:]]+$') not valid;

drop trigger if exists trg_reqon_touch on events;
create trigger trg_reqon_touch before update on events
  for each row execute function touch_updated_at();

alter table events enable row level security;
grant select on events to anon;
grant select, insert, update, delete on events to authenticated;

-- Hidden events are readable through reqon_events_write (can_post_blog()), which also covers SELECT.
drop policy if exists reqon_events_read  on events;
drop policy if exists reqon_events_write on events;
create policy reqon_events_read on events for select to anon, authenticated
  using (is_published);
create policy reqon_events_write on events for all to authenticated
  using (can_post_blog()) with check (can_post_blog());
