-- =============================================================================
--  Bug reports: any member reports, only Developers read.
--
--  WHAT WAS MISSING. When something broke, a member's only option was to tell someone in the chat, and by
--  then the page, the error text and the time were forgotten.
--
--  AFTER. `bug_reports` holds one row per report, written from two places in the app: the "Report a bug"
--  button next to Inbox (source 'manual': the person says what went wrong) and the "Report this problem"
--  button on an error message or on the crash screen (source 'error': the error text is attached, and the
--  person may add a sentence). The page path and the browser's name are kept so the problem can be found.
--   * Any signed-in member may ADD a report in their own name. Nobody but a Developer can READ any report,
--     not even their own, so the list never leaks what other people hit.
--   * A Developer marks a report done (or reopens it) and may delete it; marking done stamps who and when.
--   * One member may send at most 20 reports an hour, so a loop in the browser cannot fill the table.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Store bug reports and let Developers triage them.
--    Existing data  Untouched. One new table and two small trigger functions.
--    Locking        CREATE TABLE only.
--    Authorization  RLS: insert is_member() and reported_by = auth.uid(); select, update and delete
--                   is_developer(). INSERT is granted on the report columns only; UPDATE on status only.
--    Rollback       DROP TABLE bug_reports; DROP FUNCTION limit_bug_reports(), stamp_bug_resolution().
--    Deploy order   Any time after 20260149000000. The client writes and reads the table; deploy it after.
-- =============================================================================

create table if not exists bug_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  reported_by uuid not null default auth.uid() references members(id) on delete cascade,
  source      text not null check (source in ('manual', 'error')),
  message     text not null default '' check (length(message) <= 2000),
  details     text check (details is null or length(details) <= 4000),
  page        text check (page is null or length(page) <= 300),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  status      text not null default 'open' check (status in ('open', 'done')),
  resolved_at timestamptz,
  resolved_by uuid references members(id) on delete set null,
  constraint bug_reports_has_content check (length(btrim(message)) > 0 or details is not null)
);

comment on table bug_reports is
  'Bug reports from members. Any member adds one; only a Developer reads, resolves or deletes. See limit_bug_reports() and stamp_bug_resolution().';

create index if not exists bug_reports_recent on bug_reports (status, created_at desc);

alter table bug_reports enable row level security;
revoke all on bug_reports from anon, authenticated;
grant select, delete on bug_reports to authenticated;
grant insert (source, message, details, page, user_agent) on bug_reports to authenticated;
grant update (status) on bug_reports to authenticated;

drop policy if exists bug_reports_insert on bug_reports;
drop policy if exists bug_reports_read on bug_reports;
drop policy if exists bug_reports_update on bug_reports;
drop policy if exists bug_reports_delete on bug_reports;
create policy bug_reports_insert on bug_reports for insert to authenticated
  with check (is_member() and reported_by = auth.uid());
create policy bug_reports_read on bug_reports for select to authenticated using (is_developer());
create policy bug_reports_update on bug_reports for update to authenticated
  using (is_developer()) with check (is_developer());
create policy bug_reports_delete on bug_reports for delete to authenticated using (is_developer());

-- At most 20 reports per member per hour. SECURITY DEFINER so it can count the member's own rows even though
-- they cannot read them.
create or replace function limit_bug_reports() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null
     and (select count(*) from bug_reports where reported_by = new.reported_by and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many bug reports in the last hour. Please wait a little.' using errcode = '54000';
  end if;
  return new;
end $fn$;

revoke all on function limit_bug_reports() from public, anon, authenticated;

drop trigger if exists trg_limit_bug_reports on bug_reports;
create trigger trg_limit_bug_reports before insert on bug_reports
  for each row execute function limit_bug_reports();

-- Marking a report done records who and when; reopening clears both.
create or replace function stamp_bug_resolution() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  elsif new.status = 'open' and old.status <> 'open' then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;
  return new;
end $fn$;

revoke all on function stamp_bug_resolution() from public, anon, authenticated;

drop trigger if exists trg_stamp_bug_resolution on bug_reports;
create trigger trg_stamp_bug_resolution before update on bug_reports
  for each row execute function stamp_bug_resolution();

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
