-- =============================================================================
--  Meetings: a weekly meeting that creates itself, a checklist of who came, and a notice to
--  everyone when a club-wide meeting is called.
--
--  WHAT WAS MISSING.
--   * Every meeting was typed in by hand, and a club-wide one told nobody (only a meeting for a
--     department reached an inbox).
--   * "Who came" was one line of free text.
--
--  AFTER.
--   * meeting_schedule: ONE row (like meeting_template) that says when the weekly meeting is:
--     weekday (ISO, 1 = Monday), start and end time, title, place, how many days ahead it is
--     created, and whether it is on. Seeded: Tuesday 16:30, 7 days ahead. The President, Vice
--     President and Developer (is_admin()) edit it; everyone reads it. The time zone is fixed to
--     the club's own, Europe/Copenhagen (the "club's day" 20260128000200 already uses): starts_at is
--     a wall-clock time, so the zone only decides which calendar day counts as today.
--   * create_scheduled_meetings(): makes the meeting for each coming occurrence inside the lead
--     time, in the current season, from the default agenda template. Safe to run any number of
--     times (the daily pg_cron job in supabase/scheduler/install_meeting_schedule_job.sql). NOT
--     callable through the API.
--   * Each automatic meeting carries an immutable occurrence_date (unique). That, not held_on, is
--     what says "this week's meeting exists": an admin can move the meeting to another day, and
--     the next run still finds it. meeting_skips holds occurrence dates that must not be created
--     (a holiday week). Deleting an automatic meeting records its occurrence as skipped, so it is
--     not made again; removing the skip makes it again on the next run.
--   * Changing the schedule only affects occurrences that do not exist yet. A meeting already
--     created keeps the day, time and place it has; edit that meeting if it must change.
--   * upcoming_meeting_occurrences(): the next occurrences and what happened to each (created,
--     skipped, or still to come), computed by the same function that creates them, so Settings
--     never disagrees with the job.
--   * meeting_attendees: who came, one row per member per meeting. Written only by
--     set_meeting_attendees() (replaces the list atomically; can_edit_meetings()). The old free
--     text meetings.attendees stays and is shown when there is no checklist.
--   * notify_club_meeting(): when a meeting for the whole club is created and its date has not
--     passed, every active or trial member except the person who called it gets an inbox item
--     (kind meeting_called, the kind a department meeting already uses). A meeting for one
--     department keeps notifying only that department (20260140000000), so nobody hears twice.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Weekly meeting automation, attendance and a club-wide notice.
--    Existing data  Untouched. meetings gains a nullable column; one schedule row is seeded.
--    New objects    Tables meeting_schedule, meeting_skips, meeting_attendees; column
--                   meetings.occurrence_date (+ unique index); functions create_scheduled_meetings,
--                   meeting_schedule_dates, upcoming_meeting_occurrences, set_meeting_attendees,
--                   skip_on_scheduled_delete, notify_club_meeting, guard_meeting_occurrence; triggers on meetings.
--    Locking        CREATE TABLE and ALTER TABLE ADD COLUMN (nullable): metadata only.
--    Authorization  RLS on all three tables; reads for members; writes as above. The job
--                   function and the helpers are not executable by API roles.
--    Rollback       DROP the triggers and functions above, DROP TABLE meeting_attendees,
--                   meeting_skips, meeting_schedule, DROP COLUMN meetings.occurrence_date. Run
--                   supabase/scheduler/uninstall_meeting_schedule_job.sql first.
--    Deploy order   After 20260143000100. Then run install_meeting_schedule_job.sql ONCE: without it
--                   nothing creates the meetings (db push alone schedules nothing).
-- =============================================================================

-- ------------------------------------------------------------- occurrence key
alter table meetings add column if not exists occurrence_date date;
comment on column meetings.occurrence_date is
  'Set only on a meeting made by create_scheduled_meetings(): the date of the schedule occurrence it stands for. Never changed through the API (guard_meeting_occurrence); held_on may move, this does not.';
create unique index if not exists meetings_occurrence_once on meetings (occurrence_date) where occurrence_date is not null;

-- meetings has a table-wide UPDATE/INSERT grant, so a column grant cannot protect the key. Clearing or
-- changing it would make the job think the occurrence has no meeting and create a second one; a
-- hand-made meeting must not claim an occurrence either. Only the job (and migrations: no JWT) sets it.
create or replace function guard_meeting_occurrence() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.occurrence_date is not null then
      raise exception 'A meeting cannot claim a scheduled occurrence.' using errcode = '42501';
    end if;
  elsif new.occurrence_date is distinct from old.occurrence_date then
    raise exception 'The scheduled occurrence of a meeting cannot be changed. Move the meeting with its date instead.' using errcode = '42501';
  end if;
  return new;
end $fn$;

revoke all on function guard_meeting_occurrence() from public, anon, authenticated;

drop trigger if exists trg_guard_meeting_occurrence on meetings;
create trigger trg_guard_meeting_occurrence before insert or update of occurrence_date on meetings
  for each row execute function guard_meeting_occurrence();

-- --------------------------------------------------------------- the schedule
create table if not exists meeting_schedule (
  id         boolean primary key default true check (id),
  enabled    boolean not null default true,
  weekday    smallint not null default 2 check (weekday between 1 and 7),
  starts_at  time not null default '16:30',
  ends_at    time,
  title      text not null default 'Club meeting' check (length(btrim(title)) between 1 and 120),
  location   text check (location is null or length(location) <= 200),
  lead_days  smallint not null default 7 check (lead_days between 1 and 21),
  timezone   text not null default 'Europe/Copenhagen',
  updated_at timestamptz not null default now(),
  updated_by uuid references members(id) on delete set null,
  constraint meeting_schedule_ends_after_starts check (ends_at is null or ends_at > starts_at)
);

insert into meeting_schedule (id) values (true) on conflict (id) do nothing;

comment on table meeting_schedule is
  'One row: when the weekly club meeting is and how far ahead it is created. Edited by is_admin(); applied by create_scheduled_meetings(). A change only affects occurrences not created yet.';
comment on column meeting_schedule.weekday is 'ISO weekday: 1 = Monday ... 7 = Sunday. The default, 2, is Tuesday.';
comment on column meeting_schedule.timezone is 'The club''s own time zone. Not editable through the API: starts_at is a wall-clock time and this only decides which day is today.';

drop trigger if exists trg_touch on meeting_schedule;
create trigger trg_touch before update on meeting_schedule
  for each row execute function touch_updated_at();

alter table meeting_schedule enable row level security;
revoke all on meeting_schedule from anon, authenticated;
grant select on meeting_schedule to authenticated;
grant update (enabled, weekday, starts_at, ends_at, title, location, lead_days, updated_by) on meeting_schedule to authenticated;

drop policy if exists meeting_schedule_read on meeting_schedule;
drop policy if exists meeting_schedule_update on meeting_schedule;
create policy meeting_schedule_read on meeting_schedule for select to authenticated using (is_member());
create policy meeting_schedule_update on meeting_schedule for update to authenticated
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------- skips
create table if not exists meeting_skips (
  occurrence_date date primary key,
  reason          text check (reason is null or length(reason) <= 200),
  skipped_by      uuid references members(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);

comment on table meeting_skips is
  'Occurrence dates create_scheduled_meetings() must not make: a week off, or an automatic meeting that was deleted. Delete the row to have it made again.';

alter table meeting_skips enable row level security;
revoke all on meeting_skips from anon, authenticated;
grant select, delete on meeting_skips to authenticated;
grant insert (occurrence_date, reason) on meeting_skips to authenticated;

drop policy if exists meeting_skips_read on meeting_skips;
drop policy if exists meeting_skips_insert on meeting_skips;
drop policy if exists meeting_skips_delete on meeting_skips;
create policy meeting_skips_read on meeting_skips for select to authenticated using (is_member());
create policy meeting_skips_insert on meeting_skips for insert to authenticated with check (is_admin());
create policy meeting_skips_delete on meeting_skips for delete to authenticated using (is_admin());

-- Deleting an automatic meeting must not bring it back on the next run.
create or replace function skip_on_scheduled_delete() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if old.occurrence_date is not null then
    insert into meeting_skips (occurrence_date, reason, skipped_by)
    values (old.occurrence_date, 'The meeting was deleted', auth.uid())
    on conflict (occurrence_date) do nothing;
  end if;
  return null;
end $fn$;

revoke all on function skip_on_scheduled_delete() from public, anon, authenticated;

drop trigger if exists trg_skip_on_scheduled_delete on meetings;
create trigger trg_skip_on_scheduled_delete after delete on meetings
  for each row execute function skip_on_scheduled_delete();

-- ------------------------------------------------------------- the occurrences
-- The next p_count occurrence dates, starting with the first one that has not started yet in
-- the club's time zone. Internal: create_scheduled_meetings() and upcoming_meeting_occurrences().
create or replace function meeting_schedule_dates(p_count integer) returns setof date
language plpgsql stable security definer set search_path = public as $fn$
declare
  s meeting_schedule%rowtype;
  v_local timestamp;
  v_first date;
begin
  select * into s from meeting_schedule where id;
  if not found then return; end if;
  v_local := now() at time zone s.timezone;
  v_first := v_local::date + ((s.weekday - extract(isodow from v_local)::int + 7) % 7);
  if v_first = v_local::date and v_local::time >= s.starts_at then
    v_first := v_first + 7; -- today's meeting has started: the next one is a week on
  end if;
  return query select v_first + 7 * g from generate_series(0, greatest(p_count, 0) - 1) g;
end $fn$;

revoke all on function meeting_schedule_dates(integer) from public, anon, authenticated;

-- Makes the meeting for every occurrence inside the lead time that has none and is not skipped.
-- Returns how many it made. Idempotent: the unique occurrence_date is the guard.
create or replace function create_scheduled_meetings() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  s meeting_schedule%rowtype;
  v_season uuid;
  v_today date;
  v_body text;
  d date;
  v_made integer := 0;
  v_rows integer;
begin
  select * into s from meeting_schedule where id;
  if not found or not s.enabled then return 0; end if;
  select id into v_season from seasons where is_current;
  if v_season is null then return 0; end if;
  v_today := (now() at time zone s.timezone)::date;
  select body into v_body from meeting_template where id;

  for d in select meeting_schedule_dates(4) loop
    exit when d - v_today > s.lead_days;
    continue when exists (select 1 from meeting_skips k where k.occurrence_date = d);
    insert into meetings (season_id, title, held_on, starts_at, ends_at, location, agenda, created_by, occurrence_date)
    values (v_season, s.title, d, s.starts_at, s.ends_at, s.location, nullif(v_body, ''), null, d)
    on conflict (occurrence_date) where occurrence_date is not null do nothing;
    get diagnostics v_rows = row_count;
    v_made := v_made + v_rows;
  end loop;
  return v_made;
end $fn$;

comment on function create_scheduled_meetings() is
  'Makes the weekly meetings inside the lead time. Idempotent (unique occurrence_date). Run daily by supabase/scheduler/install_meeting_schedule_job.sql; not callable through the API.';

revoke all on function create_scheduled_meetings() from public, anon, authenticated;

-- What Settings shows: each coming occurrence and what became of it.
create or replace function upcoming_meeting_occurrences(p_count integer default 6)
returns table (occurrence_date date, status text, meeting_id uuid, held_on date)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not is_member() then
    raise exception 'Only members can see the meeting schedule.' using errcode = '42501';
  end if;
  return query
    select d.d,
           case when k.occurrence_date is not null then 'skipped'
                when m.id is not null then 'created'
                else 'pending' end,
           m.id, m.held_on
      from (select x as d from meeting_schedule_dates(least(greatest(p_count, 1), 12)) x) d
      left join meeting_skips k on k.occurrence_date = d.d
      left join meetings m on m.occurrence_date = d.d
     order by d.d;
end $fn$;

revoke all on function upcoming_meeting_occurrences(integer) from public, anon;
grant execute on function upcoming_meeting_occurrences(integer) to authenticated;

-- ------------------------------------------------------------------ attendance
create table if not exists meeting_attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  marked_by  uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (meeting_id, member_id)
);

create index if not exists meeting_attendees_member on meeting_attendees (member_id);

comment on table meeting_attendees is
  'Who came to a meeting: one row per member present. Written only by set_meeting_attendees(). The free text meetings.attendees is the older record.';

alter table meeting_attendees enable row level security;
revoke all on meeting_attendees from anon, authenticated;
grant select on meeting_attendees to authenticated;

drop policy if exists meeting_attendees_read on meeting_attendees;
create policy meeting_attendees_read on meeting_attendees for select to authenticated using (is_member());

-- Replaces the whole list in one transaction, so two editors never leave half of each.
create or replace function set_meeting_attendees(p_meeting uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not can_edit_meetings() then
    raise exception 'Only someone who edits meetings may record who came.' using errcode = '42501';
  end if;
  if not exists (select 1 from meetings where id = p_meeting) then
    raise exception 'That meeting no longer exists.' using errcode = 'P0002';
  end if;
  delete from meeting_attendees where meeting_id = p_meeting and not (member_id = any(coalesce(p_members, '{}')));
  insert into meeting_attendees (meeting_id, member_id, marked_by)
  select p_meeting, m.id, auth.uid() from members m where m.id = any(coalesce(p_members, '{}'))
  on conflict (meeting_id, member_id) do nothing;
end $fn$;

revoke all on function set_meeting_attendees(uuid, uuid[]) from public, anon;
grant execute on function set_meeting_attendees(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------- a club-wide meeting is news
create or replace function notify_club_meeting() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_activity bigint;
begin
  -- A department meeting tells its department (log_meeting_department); a date in the past is a
  -- record being written up, not a call.
  if new.subteam_key is not null or new.held_on < current_date then
    return null;
  end if;
  -- notify_from_activity() ignores a 'called' row with no department, so this does not tell anyone twice.
  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (v_actor, new.season_id, 'meeting', new.id::text, 'called',
    jsonb_build_object('title', new.title, 'held_on', new.held_on, 'subteam_key', null, 'audience', 'club'))
  returning id into v_activity;

  insert into notifications (member_id, activity_id, season_id, kind, entity, entity_id, actor_id, title)
  select m.id, v_activity, new.season_id, 'meeting_called', 'meeting', new.id::text, v_actor, left(new.title, 300)
    from members m
   where m.status in ('active', 'trial')
     and m.id is distinct from v_actor
  on conflict (member_id, activity_id) do nothing;
  return null;
end $fn$;

comment on function notify_club_meeting() is
  'AFTER INSERT on meetings: a meeting for the whole club (no department, date not past) lands in every active or trial member''s inbox, except the person who called it.';

revoke all on function notify_club_meeting() from public, anon, authenticated;

drop trigger if exists trg_notify_club_meeting on meetings;
create trigger trg_notify_club_meeting after insert on meetings
  for each row execute function notify_club_meeting();

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
