-- =============================================================================
--  A personal inbox: "this needs you", not just "who did what".
--
--  WHAT WAS MISSING. `activity` records every meaningful change, but nothing
--  told a member that something needed THEM: a task handed to them, a
--  proposal waiting for their review, their proposal approved or sent back.
--
--  AFTER.
--   * notifications: one row per person per event. Written ONLY by the
--     trigger below; each member reads and marks read only their own
--     (RLS + a column grant on read_at), so nobody can create, forge, delete
--     or read someone else's.
--   * notify_from_activity(): an AFTER INSERT trigger on `activity`. Every
--     audited change already lands there (20260114000000 and later), so
--     notifications come from the same single record — a code path cannot
--     forget to notify, just as it cannot forget to log. Each kind has
--     exactly ONE source action, because one review step can write several
--     activity rows (approved + state_changed + commented):
--
--       kind               source activity                        who
--       task_assigned      task owner_changed (detail.to)         the new owner
--                          task created_from_proposal             the task owner
--       task_blocked       task state_changed to blocked          its owner, its department's Head
--                                                                 (and the parent department's)
--       review_requested   proposal submitted / revised by its    the Head (and parent Head) of its
--                          author
--                                                                 department; with no Head, the
--                                                                 President and Vice President
--       proposal_approved  proposal approved                      whoever raised it
--       changes_requested  proposal commented, kind changes_requested   whoever raised it
--       proposal_rejected  proposal outcome_changed to rejected   whoever raised it
--       proposal_promoted  proposal promoted                      whoever raised it
--       proposal_comment   proposal commented, kind comment       whoever raised it; if they wrote
--                                                                 it, the reviewers above
--       role_granted       member_role role_granted               that member
--
--     Nobody is notified about their own action, and only active members are.
--     A Developer passes every authority check but is not a reviewer here:
--     telling them about every proposal would bury what is actually theirs.
--   * The title is copied from the activity row when the event happens, so
--     the inbox still reads sensibly after a rename or an archive.
--   * Like every public table, it gets the restore tombstone trigger (20260134000000).
--   * purge_read_notifications(): deletes notifications read more than 90
--     days ago. Scheduled by supabase/scheduler/install_notification_purge_job.sql
--     (a deployment step, like the archive job); unread ones are never purged.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Per-person notifications derived from the audit trail.
--    Existing data  None: past activity does not produce notifications.
--    New objects    Table notifications (+ indexes, RLS, realtime); functions
--                   proposal_reviewers, notify_from_activity,
--                   stamp_notification_read, purge_read_notifications; triggers
--                   trg_notify_from_activity on activity and
--                   trg_stamp_notification_read on notifications.
--    Locking        CREATE TABLE; CREATE TRIGGER on activity takes a brief
--                   SHARE ROW EXCLUSIVE lock. At runtime each audited change
--                   adds at most a few INSERTs in its own transaction.
--    Authorization  New table: own rows only; read_at is the only writable
--                   column. The functions are not callable through the API.
--    Rollback       DROP TRIGGER trg_notify_from_activity ON activity; DROP TABLE
--                   notifications; DROP the four functions. Run
--                   supabase/scheduler/uninstall_notification_purge_job.sql
--                   first where the job is installed.
--    Deploy order   After 20260138000000. The client's bell reads the table;
--                   deploy it after this migration.
-- =============================================================================

create table if not exists notifications (
  id          bigserial primary key,
  member_id   uuid not null references members(id) on delete cascade,
  activity_id bigint not null references activity(id) on delete cascade,
  season_id   uuid references seasons(id) on delete cascade,
  kind        text not null,
  entity      text not null,
  entity_id   text not null,
  actor_id    uuid references members(id) on delete set null,
  title       text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint notifications_kind_known check (kind in (
    'task_assigned', 'task_blocked', 'review_requested', 'proposal_approved', 'changes_requested',
    'proposal_rejected', 'proposal_promoted', 'proposal_comment', 'role_granted')),
  constraint notifications_once unique (member_id, activity_id)
);

comment on table notifications is
  'Per-person "this needs you" inbox. Written only by notify_from_activity() (a trigger on activity); each member reads and marks read only their own.';

create index if not exists notifications_inbox on notifications (member_id, created_at desc);
create index if not exists notifications_unread on notifications (member_id) where read_at is null;
create index if not exists notifications_activity on notifications (activity_id);

-- ------------------------------------------------------------------ access
alter table notifications enable row level security;

drop policy if exists notifications_own_read on notifications;
create policy notifications_own_read on notifications for select to authenticated
  using (member_id = auth.uid());

drop policy if exists notifications_own_mark_read on notifications;
create policy notifications_own_mark_read on notifications for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- No INSERT or DELETE policy: only the trigger writes, only the purge deletes.
-- And of an UPDATE, only read_at: a member cannot rewrite what they were told.
revoke all on notifications from anon;
revoke all on notifications from authenticated;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
revoke all on sequence notifications_id_seq from anon, authenticated;

-- Once read, it stays read at the moment it was first read: read_at is stamped
-- by the server, never taken from the client, and cannot be moved or cleared.
create or replace function stamp_notification_read() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if old.read_at is not null then
    new.read_at := old.read_at;
  elsif new.read_at is not null then
    new.read_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_stamp_notification_read on notifications;
create trigger trg_stamp_notification_read before update of read_at on notifications
  for each row execute function stamp_notification_read();

-- -------------------------------------------------------- who reviews what
-- The people a proposal's review waits on: the Head of its department and of
-- that department's parent; where neither exists (or it has no department
-- yet), the President and the Vice President. Active members only.
create or replace function proposal_reviewers(p_key text) returns uuid[]
language sql stable security definer set search_path = public as $fn$
  with heads as (
    select s.lead_id as id from subteams s
     where s.key = p_key and s.archived_at is null and s.lead_id is not null
    union
    select p.lead_id from subteams s join subteams p on p.key = s.parent_key
     where s.key = p_key and s.archived_at is null and p.archived_at is null and p.lead_id is not null
  ), active_heads as (
    select h.id from heads h join members m on m.id = h.id and m.status = 'active'
  )
  select case
    when exists (select 1 from active_heads) then (select array_agg(id) from active_heads)
    else (select coalesce(array_agg(distinct r.member_id), '{}') from member_roles r
            join members m on m.id = r.member_id and m.status = 'active'
           where r.role in ('president', 'vicepresident'))
  end;
$fn$;

comment on function proposal_reviewers(text) is
  'Who a proposal''s review waits on, for notifications: its department''s Head and parent Head, else the President and Vice President.';

-- ------------------------------------------------------------- the trigger
create or replace function notify_from_activity() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_kind text;
  v_to text[] := '{}';
  v_title text := nullif(btrim(coalesce(new.detail->>'title', '')), '');
  v_task tasks%rowtype;
  v_prop task_proposals%rowtype;
begin
  if new.entity = 'task' and new.action in ('owner_changed', 'created_from_proposal', 'state_changed') then
    -- Compared as text throughout: a notification must never be the reason an
    -- audited change fails, so nothing here casts a payload value.
    select * into v_task from tasks where id::text = new.entity_id;
    if not found then return null; end if;
    v_title := coalesce(v_title, v_task.title);
    if new.action = 'owner_changed' then
      v_kind := 'task_assigned';
      v_to := array[new.detail->>'to'];
    elsif new.action = 'created_from_proposal' then
      v_kind := 'task_assigned';
      v_to := array[v_task.owner_id::text];
    elsif new.detail->>'to' = 'blocked' and new.detail->>'from' is distinct from 'blocked' then
      v_kind := 'task_blocked';
      v_to := array[v_task.owner_id::text]
        || coalesce((select array_agg(s.lead_id::text) from subteams s where s.key = v_task.subteam_key and s.lead_id is not null), '{}')
        || coalesce((select array_agg(p.lead_id::text) from subteams s join subteams p on p.key = s.parent_key
                      where s.key = v_task.subteam_key and p.lead_id is not null), '{}');
    end if;

  elsif new.entity = 'proposal'
        and new.action in ('submitted', 'revised', 'approved', 'commented', 'outcome_changed', 'promoted') then
    select * into v_prop from task_proposals where id::text = new.entity_id;
    if not found then return null; end if;
    v_title := coalesce(v_title, v_prop.title);
    -- A revision asks for review only when the author made it; a reviewer
    -- editing the wording is not a request to themselves.
    if new.action = 'submitted'
       or (new.action = 'revised' and new.actor_id is not distinct from v_prop.raised_by) then
      v_kind := 'review_requested';
      v_to := proposal_reviewers(v_prop.subteam_key)::text[];
    elsif new.action = 'approved' then
      v_kind := 'proposal_approved';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'commented' and new.detail->>'kind' = 'changes_requested' then
      v_kind := 'changes_requested';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'commented' and new.detail->>'kind' = 'comment' then
      v_kind := 'proposal_comment';
      v_to := case when new.actor_id is not distinct from v_prop.raised_by
                   then proposal_reviewers(v_prop.subteam_key)::text[]
                   else array[v_prop.raised_by::text] end;
    elsif new.action = 'outcome_changed' and new.detail->>'to' = 'rejected' then
      v_kind := 'proposal_rejected';
      v_to := array[v_prop.raised_by::text];
    elsif new.action = 'promoted' then
      v_kind := 'proposal_promoted';
      v_to := array[v_prop.raised_by::text];
    end if;

  elsif new.entity = 'member_role' and new.action = 'role_granted' then
    v_kind := 'role_granted';
    v_to := array[new.entity_id];
    v_title := new.detail->>'role';
  end if;

  if v_kind is null then
    return null;
  end if;

  insert into notifications (member_id, activity_id, season_id, kind, entity, entity_id, actor_id, title)
  select m.id, new.id, new.season_id, v_kind, new.entity, new.entity_id, new.actor_id, left(v_title, 300)
    from members m
   where m.id::text = any(v_to)
     and m.status = 'active'
     and m.id is distinct from new.actor_id
  on conflict (member_id, activity_id) do nothing;
  return null;
end $fn$;

comment on function notify_from_activity() is
  'AFTER INSERT on activity: turns the events that need someone into rows in notifications (20260139000000).';

drop trigger if exists trg_notify_from_activity on activity;
create trigger trg_notify_from_activity after insert on activity
  for each row execute function notify_from_activity();

-- ---------------------------------------------------------------- retention
create or replace function purge_read_notifications() returns integer
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  delete from notifications where read_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $fn$;

comment on function purge_read_notifications() is
  'Deletes notifications read more than 90 days ago. Run by pg_cron (supabase/scheduler/install_notification_purge_job.sql).';

-- 20260126000600's EXECUTE policy. None of these is for the API.
revoke all on function stamp_notification_read() from public, anon, authenticated;
revoke all on function notify_from_activity() from public, anon, authenticated;
revoke all on function proposal_reviewers(text) from public, anon, authenticated;
revoke all on function purge_read_notifications() from public, anon, authenticated;
grant execute on function purge_read_notifications() to service_role;

-- ---------------------------------------------------------------- realtime
-- The bell updates live. RLS applies to realtime too: a member's channel only
-- ever carries their own rows.
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table notifications;
  end if;
end
$pub$;

-- --------------------------------------------------------- restore support
-- Every public table carries the tombstone trigger (20260134000000), so a
-- restore can tell a deleted notification from one that never existed.
select restore.install_tombstone_triggers();
