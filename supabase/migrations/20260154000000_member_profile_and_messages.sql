-- =============================================================================
--  Profiles and direct messages.
--
--  WHAT WAS MISSING. A member's email lives only in auth.users (the roster has a
--  phone but no email), so nobody could see how to reach a colleague, and the
--  inbox only ever held system notices ("a task was handed to you").
--
--  AFTER.
--   * member_email(p_member_id): the email of a roster member, for an active or
--     trial member. Phone, name and job title are already readable on `members`.
--   * send_message(p_to, p_body): a person-to-person message, delivered as a
--     `notifications` row of kind 'message' with the text in the new `body`
--     column. It deliberately does NOT go through `activity`: that table is the
--     club-wide audit trail, and a row there would show the whole club who wrote
--     to whom. Hence notifications.activity_id becomes nullable.
--       - Sender: active or trial. Recipient: active or trial, and not the sender.
--       - 1 to 1000 characters after trimming; at most 30 an hour per sender.
--       - actor_id is set from the session, never from the caller.
--     The recipient reads it (and marks it read) through the existing own-rows
--     policies; nobody can read, rewrite or delete someone else's.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Show how to reach a member; let a member message another one.
--    Existing data  Unchanged: body is null and activity_id stays set on every
--                   existing row.
--    New objects    notifications.body; constraints notifications_body_matches_kind
--                   and notifications_body_length; kind 'message' in
--                   notifications_kind_known; functions member_email, send_message.
--    Locking        ALTER TABLE ... DROP NOT NULL / ADD COLUMN (no default) are
--                   catalogue-only; the two ADD CONSTRAINTs scan the table once
--                   under a brief lock (it is small: read rows are purged at 90 days).
--    Authorization  Both functions are SECURITY DEFINER with a pinned search_path,
--                   revoked from public and anon, granted to authenticated.
--    Rollback       DROP FUNCTION send_message(uuid, text), member_email(uuid);
--                   delete from notifications where kind = 'message'; drop the two
--                   new constraints and the body column; restore the kind check
--                   from 20260146000000; SET NOT NULL on activity_id.
--    Deploy order   Before the client that calls them.
-- =============================================================================

alter table notifications alter column activity_id drop not null;
alter table notifications add column if not exists body text;

alter table notifications drop constraint if exists notifications_kind_known;
alter table notifications add constraint notifications_kind_known check (kind in (
  'task_assigned', 'task_blocked', 'review_requested', 'proposal_approved', 'changes_requested',
  'proposal_rejected', 'proposal_promoted', 'proposal_comment', 'role_granted', 'meeting_called',
  'tasks_unassigned', 'message'));

-- A message has text and nothing else has: the system notices keep using `title`.
alter table notifications drop constraint if exists notifications_body_matches_kind;
alter table notifications add constraint notifications_body_matches_kind
  check ((kind = 'message') = (body is not null and btrim(body) <> ''));
alter table notifications drop constraint if exists notifications_body_length;
alter table notifications add constraint notifications_body_length
  check (body is null or char_length(body) <= 1000);

comment on column notifications.body is
  'The text of a person-to-person message (kind = ''message''); null for every system notice.';

-- ----------------------------------------------------------------- email
create or replace function member_email(p_member_id uuid) returns text
language sql stable security definer set search_path = public as $fn$
  select u.email::text
    from auth.users u
   where u.id = p_member_id
     and exists (select 1 from members t where t.id = u.id)
     and exists (select 1 from members me where me.id = auth.uid() and me.status in ('active', 'trial'));
$fn$;

comment on function member_email(uuid) is
  'The email of a roster member, for an active or trial member. Null for anyone else, and for a non-member.';

revoke all on function member_email(uuid) from public, anon;
grant execute on function member_email(uuid) to authenticated, service_role;

-- --------------------------------------------------------------- messages
create or replace function send_message(p_to uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not exists (select 1 from members where id = v_me and status in ('active', 'trial')) then
    raise exception 'Only an active or trial member can send messages.' using errcode = '42501';
  end if;
  if p_to is null or p_to = v_me then
    raise exception 'Choose someone else to message.' using errcode = '22023';
  end if;
  if not exists (select 1 from members where id = p_to and status in ('active', 'trial')) then
    raise exception 'That person is not an active member, so they cannot receive messages.' using errcode = '22023';
  end if;
  if v_body = '' or char_length(v_body) > 1000 then
    raise exception 'A message is between 1 and 1000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from notifications where actor_id = v_me and kind = 'message' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many messages in the last hour. Please wait a little.' using errcode = '54000';
  end if;

  insert into notifications (member_id, season_id, kind, entity, entity_id, actor_id, body)
  values (p_to, null, 'message', 'member', v_me::text, v_me, v_body);
end $fn$;

comment on function send_message(uuid, text) is
  'Delivers a message to another active or trial member''s inbox. Not written to activity, so it stays between the two people.';

revoke all on function send_message(uuid, text) from public, anon;
grant execute on function send_message(uuid, text) to authenticated, service_role;
