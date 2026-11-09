-- =============================================================================
--  Announcements get a title.
--
--  An announcement is a short headline (the title) and the details (the description,
--  stored in `body`). The title is required for every new announcement and is shown
--  above the text, in the history and in each member's inbox row (notifications.title).
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Title + description for announcements.
--    Existing data  Announcements sent before this have no title (null) and still read fine.
--    New objects    announcements.title (+ length check); send_announcement(p_title, p_body)
--                   replaces send_announcement(p_body).
--    Locking        ADD COLUMN without a default is catalogue-only; the check scans a small table once.
--    Authorization  Unchanged: is_admin() only, SECURITY DEFINER, pinned search_path, revoked
--                   from public and anon.
--    Rollback       DROP FUNCTION send_announcement(text, text); recreate send_announcement(text)
--                   from 20260155000000; drop the check and the column.
--    Deploy order   After 20260155000000, before the client that sends a title.
-- =============================================================================

alter table announcements add column if not exists title text;
alter table announcements drop constraint if exists announcements_title_length;
alter table announcements add constraint announcements_title_length
  check (title is null or char_length(btrim(title)) between 1 and 100);

comment on column announcements.title is
  'The headline of the announcement; the text is in body. Null only for announcements sent before titles existed.';

drop function if exists send_announcement(text);

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
  return v_n;
end $fn$;

comment on function send_announcement(text, text) is
  'Sends an announcement (title + description) to every active and trial member except the author, and records it. President, Vice President, Developer.';

revoke all on function send_announcement(text, text) from public, anon;
grant execute on function send_announcement(text, text) to authenticated, service_role;
