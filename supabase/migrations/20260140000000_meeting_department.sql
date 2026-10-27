-- =============================================================================
--  Meetings can be called for a department, and that department hears of it.
--
--  WHAT WAS MISSING. A meeting had a date, a place and an agenda but no
--  audience: the only way to tell the Electronics team was to type it into a
--  chat by hand.
--
--  AFTER.
--   * meetings.subteam_key (optional): the department the meeting is for.
--     Null = the whole club, as before. Existing meetings stay null.
--   * Choosing a department writes ONE activity row (entity 'meeting', action
--     'called'); notify_from_activity() (20260139000000) turns it into an
--     inbox item for the department's members this season and its Head (and
--     the parent Head), never the person who called it. A meeting whose date
--     has already passed is a record being written up: it is logged but
--     tells nobody. Changing the department later notifies the new one.
--   * notifications_kind_known gains 'meeting_called'.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        An audience for a meeting, through the existing inbox.
--    Existing data  Unchanged: the new column is null for every meeting.
--    New objects    Column meetings.subteam_key (+ index); function
--                   log_meeting_department and its two triggers on meetings;
--                   a replaced notify_from_activity (one new branch).
--    Locking        ALTER TABLE ADD COLUMN (nullable, no default) is
--                   metadata-only; the constraint swap on notifications scans
--                   a small table.
--    Authorization  Unchanged: meeting_insert / meeting_update still decide
--                   who may call or edit a meeting. The functions are not
--                   callable through the API.
--    Rollback       DROP TRIGGERs trg_log_meeting_department_ins/_upd and the
--                   function; restore notify_from_activity from 20260139000000;
--                   ALTER TABLE meetings DROP COLUMN subteam_key.
--    Deploy order   After 20260139000000. The client's department field needs
--                   the column; deploy it after this migration.
-- =============================================================================

alter table meetings add column if not exists subteam_key text references subteams(key) on delete restrict;
create index if not exists meetings_subteam on meetings (subteam_key) where subteam_key is not null;

comment on column meetings.subteam_key is
  'The department this meeting is for. Null = the whole club. Choosing one notifies that department (notify_from_activity).';

alter table notifications drop constraint if exists notifications_kind_known;
alter table notifications add constraint notifications_kind_known check (kind in (
  'task_assigned', 'task_blocked', 'review_requested', 'proposal_approved', 'changes_requested',
  'proposal_rejected', 'proposal_promoted', 'proposal_comment', 'role_granted', 'meeting_called'));

-- One audit row when a meeting is called for a department (new, or the
-- department changed). No department, no row: a club-wide meeting is not news
-- to a single team.
create or replace function log_meeting_department() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.subteam_key is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.subteam_key is not distinct from new.subteam_key then
    return null;
  end if;
  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (coalesce(auth.uid(), new.created_by), new.season_id, 'meeting', new.id::text, 'called',
    jsonb_build_object('title', new.title, 'held_on', new.held_on, 'subteam_key', new.subteam_key));
  return null;
end $fn$;

comment on function log_meeting_department() is
  'AFTER INSERT / UPDATE OF subteam_key on meetings: records that a meeting was called for a department (20260140000000).';

drop trigger if exists trg_log_meeting_department_ins on meetings;
create trigger trg_log_meeting_department_ins after insert on meetings
  for each row execute function log_meeting_department();
drop trigger if exists trg_log_meeting_department_upd on meetings;
create trigger trg_log_meeting_department_upd after update of subteam_key on meetings
  for each row execute function log_meeting_department();

revoke all on function log_meeting_department() from public, anon, authenticated;

-- The one new branch is the 'meeting' / 'called' case; everything else is
-- 20260139000000 unchanged.
create or replace function notify_from_activity() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_kind text;
  v_to text[] := '{}';
  v_title text := nullif(btrim(coalesce(new.detail->>'title', '')), '');
  v_task tasks%rowtype;
  v_prop task_proposals%rowtype;
  v_meet meetings%rowtype;
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

  elsif new.entity = 'meeting' and new.action = 'called' then
    -- A meeting called for a department tells that department: its members
    -- this season and its Head (and the parent's). A meeting dated in the past
    -- is a record being written up, not a call, so it tells nobody.
    select * into v_meet from meetings where id::text = new.entity_id;
    if not found or v_meet.subteam_key is null or v_meet.held_on < current_date then return null; end if;
    v_title := coalesce(v_title, v_meet.title);
    v_kind := 'meeting_called';
    v_to := coalesce((select array_agg(d.member_id::text) from department_members d
                       where d.season_id = v_meet.season_id and d.subteam_key = v_meet.subteam_key), '{}')
      || coalesce((select array_agg(s.lead_id::text) from subteams s
                    where s.key = v_meet.subteam_key and s.lead_id is not null), '{}')
      || coalesce((select array_agg(p.lead_id::text) from subteams s join subteams p on p.key = s.parent_key
                    where s.key = v_meet.subteam_key and p.lead_id is not null), '{}');

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

revoke all on function notify_from_activity() from public, anon, authenticated;
