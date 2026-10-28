-- =============================================================================
--  A profile photo for each member, and a memory of which Settings sections each person uses.
--
--  WHAT WAS MISSING. A member was a name and a job title; Settings listed every section in one fixed
--  order whoever you were, so the one or two you use every week sat below a dozen you never open.
--
--  AFTER.
--   * member_avatars: one small picture per member (at most ~90 KB of text). It lives in its own table,
--     not on `members`, so the roster query that loads on every screen never carries image data. The
--     browser resizes the photo to 256 px and sends a data URL; the check below accepts only
--     data:image/jpeg or data:image/webp in base64 (no SVG, which can carry script) and caps the length.
--     A member sets or removes their own photo (active or trial); an admin may remove anyone's.
--     Everyone on the roster reads them.
--   * settings_usage: per member and Settings section, a score that grows by 1 each time they use the
--     section and halves for every 30 days they do not, so last season's habit fades. Written only by
--     record_settings_open(); a member reads only their own rows. The page sorts its sections by it.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        A profile photo and a per-person ordering of Settings sections.
--    Existing data  Untouched. Two new tables, one new function.
--    Locking        CREATE TABLE only.
--    Authorization  RLS on both tables. member_avatars: read is_member(); write own row when
--                   is_participating_member(); delete own row or is_admin(). settings_usage: read own
--                   rows; no direct write at all (record_settings_open is the only way).
--    Rollback       DROP FUNCTION record_settings_open; DROP TABLE settings_usage, member_avatars.
--    Deploy order   After 20260144000000. The client reads both tables; deploy it after this migration.
-- =============================================================================

-- ------------------------------------------------------------------ photos
create table if not exists member_avatars (
  member_id  uuid primary key references members(id) on delete cascade,
  image      text not null,
  updated_at timestamptz not null default now(),
  constraint member_avatars_image_shape check (
    length(image) <= 120000
    and image ~ '^data:image/(jpeg|webp);base64,[A-Za-z0-9+/]+=*$'
  )
);

comment on table member_avatars is
  'One small profile picture per member, as a data:image/jpeg|webp;base64 URL (<= 120000 characters). Kept apart from members so the roster query stays light.';

drop trigger if exists trg_touch on member_avatars;
create trigger trg_touch before update on member_avatars
  for each row execute function touch_updated_at();

alter table member_avatars enable row level security;
revoke all on member_avatars from anon, authenticated;
grant select, delete on member_avatars to authenticated;
grant insert (member_id, image) on member_avatars to authenticated;
-- The app saves with an upsert (INSERT ... ON CONFLICT (member_id) DO UPDATE SET member_id = excluded.member_id, image
-- = ...), and Postgres wants UPDATE privilege on every column in that SET, member_id included. Granting it is safe: the
-- update policy's WITH CHECK still pins member_id to the person signed in, so a row cannot be pointed at someone else.
grant update (member_id, image) on member_avatars to authenticated;

drop policy if exists member_avatars_read on member_avatars;
drop policy if exists member_avatars_insert on member_avatars;
drop policy if exists member_avatars_update on member_avatars;
drop policy if exists member_avatars_delete on member_avatars;
create policy member_avatars_read on member_avatars for select to authenticated using (is_member());
create policy member_avatars_insert on member_avatars for insert to authenticated
  with check (member_id = auth.uid() and is_participating_member());
create policy member_avatars_update on member_avatars for update to authenticated
  using (member_id = auth.uid() and is_participating_member())
  with check (member_id = auth.uid() and is_participating_member());
create policy member_avatars_delete on member_avatars for delete to authenticated
  using (member_id = auth.uid() or is_admin());

-- ------------------------------------------------------------ settings usage
create table if not exists settings_usage (
  member_id uuid not null references members(id) on delete cascade,
  section   text not null check (section ~ '^[a-z][a-z0-9-]{0,39}$'),
  score     real not null default 0,
  scored_at timestamptz not null default now(),
  primary key (member_id, section)
);

comment on table settings_usage is
  'How much each member uses each Settings section: +1 per use, halved for every 30 days of not using it. Written only by record_settings_open().';

alter table settings_usage enable row level security;
revoke all on settings_usage from anon, authenticated;
grant select on settings_usage to authenticated;

drop policy if exists settings_usage_own_read on settings_usage;
create policy settings_usage_own_read on settings_usage for select to authenticated using (member_id = auth.uid());

-- One use of a section. Silent past 40 sections per member (a client bug must not grow the table), and it
-- never raises for a stray id: this is a convenience, not a record anyone depends on.
create or replace function record_settings_open(p_section text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not is_member() then
    raise exception 'Only members can have Settings preferences.' using errcode = '42501';
  end if;
  if p_section is null or p_section !~ '^[a-z][a-z0-9-]{0,39}$' then
    return;
  end if;
  if not exists (select 1 from settings_usage where member_id = auth.uid() and section = p_section)
     and (select count(*) from settings_usage where member_id = auth.uid()) >= 40 then
    return;
  end if;
  insert into settings_usage (member_id, section, score, scored_at)
  values (auth.uid(), p_section, 1, now())
  on conflict (member_id, section) do update
    set score = settings_usage.score * power(0.5, extract(epoch from (now() - settings_usage.scored_at)) / (30 * 86400.0)) + 1,
        scored_at = now();
end $fn$;

revoke all on function record_settings_open(text) from public, anon;
grant execute on function record_settings_open(text) to authenticated;

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
