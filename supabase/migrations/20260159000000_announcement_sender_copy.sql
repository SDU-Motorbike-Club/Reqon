-- =============================================================================
--  The sender sees their own announcement in the inbox, tagged and already read.
--
--  BEFORE. send_announcement() wrote an inbox row for everyone except the author, so
--  the person who sent it found nothing in their own inbox.
--  AFTER.  The author also gets one row, with read_at set: it is listed under "Earlier",
--  never counted as new. The returned number still counts only the people reached.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Show an announcement to its sender in the inbox.
--    Existing data  Unchanged. Earlier announcements get no sender row.
--    New objects    None; send_announcement(text, text) is replaced (same signature).
--    Locking        None beyond CREATE OR REPLACE FUNCTION.
--    Authorization  Unchanged: is_admin() only, SECURITY DEFINER, pinned search_path.
--    Rollback       Recreate the function from 20260156000000.
--    Deploy order   Any time after 20260158000000; the client needs no change.
-- =============================================================================

create or replace function send_announcement(p_title text, p_body text) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_me    uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_id    bigint;
  v_n     integer;
begin
  if v_me is null or not is_admin() then
    raise exception 'Only the President, the Vice President or a Developer can send announcements.' using errcode = '42501';
  end if;
  if v_title = '' or char_length(v_title) > 100 then
    raise exception 'An announcement needs a title of 1 to 100 characters.' using errcode = '22023';
  end if;
  if v_body = '' or char_length(v_body) > 1000 then
    raise exception 'The description is between 1 and 1000 characters.' using errcode = '22023';
  end if;
  -- Counted on announcements, not on the inbox rows: one announcement writes one row per member.
  if (select count(*) from announcements where author_id = v_me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many announcements in the last hour. Please wait a little.' using errcode = '54000';
  end if;

  insert into announcements (author_id, title, body) values (v_me, v_title, v_body) returning id into v_id;

  insert into notifications (member_id, season_id, kind, entity, entity_id, actor_id, title, body)
  select m.id, null, 'announcement', 'announcement', v_id::text, v_me, v_title, v_body
    from members m
   where m.status in ('active', 'trial') and m.id <> v_me;
  get diagnostics v_n = row_count;

  -- The sender's own copy, already read; not part of the count above.
  insert into notifications (member_id, season_id, kind, entity, entity_id, actor_id, title, body, read_at)
  values (v_me, null, 'announcement', 'announcement', v_id::text, v_me, v_title, v_body, now());
  return v_n;
end $fn$;

revoke all on function send_announcement(text, text) from public, anon;
grant execute on function send_announcement(text, text) to authenticated, service_role;
