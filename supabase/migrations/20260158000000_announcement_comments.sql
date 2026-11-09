-- =============================================================================
--  Announcement comments: a group-chat style thread under each announcement.
--
--  WHAT WAS MISSING. An announcement (20260155000000) was one-way: members could read it
--  but not answer, so every reply went to private messages or a chat outside Reqon.
--
--  AFTER.
--   * announcement_comments: who said what under which announcement, when.
--     Every active or trial member (the people an announcement is sent to) reads the thread
--     and writes a comment as THEMSELVES. A comment is not editable; its author can delete it,
--     and the President, Vice President or a Developer (is_admin()) can delete any.
--   * Deleting an announcement removes its comments (ON DELETE CASCADE). author_id is
--     ON DELETE SET NULL, like announcements: a purged account must not be blocked by,
--     or erase, what it wrote.
--   * No notification is sent per comment: a thread of 40 members would flood every inbox.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Comment threads under announcements.
--    Existing data  Unchanged.
--    New objects    Table announcement_comments (+ index, RLS, restore tombstone trigger).
--    Locking        CREATE TABLE only.
--    Authorization  RLS: read for active/trial members; insert only as yourself;
--                   delete own, or any as is_admin(). No update. anon has nothing.
--    Rollback       DROP TABLE announcement_comments.
--    Deploy order   After 20260156000000, before the client that shows the thread.
-- =============================================================================

create table if not exists announcement_comments (
  id              bigserial primary key,
  announcement_id bigint not null references announcements(id) on delete cascade,
  author_id       uuid references members(id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now(),
  constraint announcement_comments_body_length check (char_length(btrim(body)) between 1 and 500)
);

comment on table announcement_comments is
  'Comments under an announcement, oldest first. Written by active and trial members as themselves; no edits.';

create index if not exists announcement_comments_thread on announcement_comments (announcement_id, created_at, id);

alter table announcement_comments enable row level security;

drop policy if exists announcement_comments_read on announcement_comments;
create policy announcement_comments_read on announcement_comments for select to authenticated
  using (exists (select 1 from members m where m.id = auth.uid() and m.status in ('active', 'trial')));

drop policy if exists announcement_comments_insert on announcement_comments;
create policy announcement_comments_insert on announcement_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from members m where m.id = auth.uid() and m.status in ('active', 'trial'))
  );

drop policy if exists announcement_comments_delete on announcement_comments;
create policy announcement_comments_delete on announcement_comments for delete to authenticated
  using (
    exists (select 1 from members m where m.id = auth.uid() and m.status in ('active', 'trial'))
    and (author_id = auth.uid() or is_admin())
  );

revoke all on announcement_comments from anon, authenticated;
grant select, insert, delete on announcement_comments to authenticated;
grant all on announcement_comments to service_role;
revoke all on sequence announcement_comments_id_seq from anon;
grant usage, select on sequence announcement_comments_id_seq to authenticated;

select restore.install_tombstone_triggers();
