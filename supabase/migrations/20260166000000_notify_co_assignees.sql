-- =============================================================================
--  Tell people when they are added to a task as a co-assignee.
--
--  Same body as notify_from_activity() in 20260142000000, plus one branch: the 'assignees_changed' activity
--  row written by set_task_assignees() (20260165000000) notifies everyone in detail.added with the existing
--  'task_assigned' kind, so the inbox, its link to the card and its wording need no change.
--
--  The task's current owner is left out of that list: when the lead changes, the 'owner_changed' row already
--  told the new lead, and one assignment should not arrive twice. Removing someone notifies nobody.
--
--  Rollback: re-apply notify_from_activity() from 20260142000000.
-- =============================================================================

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
  if new.entity = 'task' and new.action in ('owner_changed', 'created_from_proposal', 'created', 'state_changed', 'assignees_changed') then
    -- Compared as text throughout: a notification must never be the reason an
    -- audited change fails, so nothing here casts a payload value.
    select * into v_task from tasks where id::text = new.entity_id;
    if not found then return null; end if;
    v_title := coalesce(v_title, v_task.title);
    if new.action = 'owner_changed' then
      v_kind := 'task_assigned';
      v_to := array[new.detail->>'to'];
    elsif new.action in ('created_from_proposal', 'created') then
      v_kind := 'task_assigned';
      v_to := array[v_task.owner_id::text];
    elsif new.action = 'assignees_changed' then
      v_kind := 'task_assigned';
      v_to := case when jsonb_typeof(new.detail->'added') = 'array'
                   then array(select e from jsonb_array_elements_text(new.detail->'added') e
                               where e is distinct from v_task.owner_id::text)
                   else '{}'::text[] end;
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
