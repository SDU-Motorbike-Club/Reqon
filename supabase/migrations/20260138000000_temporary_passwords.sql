-- =============================================================================
--  Temporary passwords: a forced change at first sign-in, and admin resets.
--
--  WHAT WAS WRONG. create-member made the President type the new person's
--  first password, so the President knew it for as long as the member never
--  changed it — and nothing ever asked them to.
--
--  AFTER.
--   * members.must_change_password. The create-member Edge Function now
--     generates the first password itself, shows it to the admin ONCE, and
--     inserts the roster row with this flag set. While it is set, the app
--     shows nothing but "Choose your password" (src/auth/RequireAuth.tsx).
--     Everyone already on the roster gets false: their passwords are their
--     own and are left alone.
--   * guard_member_password_flag(): nobody can change the flag through the
--     API. Without it, member_self_update would let a member clear their own
--     flag and keep the password the admin saw. It changes only
--       - as the service role (auth.uid() is null): the set-own-password Edge
--         Function clears it right after it has set the member's new
--         password, or
--       - inside mark_password_reset() below (reqon.password_flag_write).
--     A new row may carry it (create-member inserts it as the caller).
--   * can_reset_password(member): may the caller issue this person a new
--     temporary password? An active President, Vice President or Developer
--     (can_add_members()), never for themselves (they use Settings -> Your
--     account), and only when the caller could grant or remove EVERY role the
--     person holds (can_grant_role()). Otherwise a reset would be a takeover:
--     a Vice President who reset the President's password could sign in as
--     the President.
--   * mark_password_reset(member): run AS THE CALLER by the
--     reset-member-password Edge Function before it sets the new password with
--     the service-role key. It re-checks can_reset_password(), sets the flag
--     and writes an activity row ('member', id, 'password_reset') attributed to
--     the caller. No password, hash or email ever goes in the row.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Forced password change after an admin-issued password.
--    Existing data  New column, false for every existing member: nobody is
--                   asked to change a password they already set.
--    New objects    Column members.must_change_password; functions
--                   guard_member_password_flag, can_reset_password,
--                   mark_password_reset; trigger trg_guard_member_password_flag.
--    Locking        ADD COLUMN with a constant default: metadata only. CREATE
--                   TRIGGER takes a brief SHARE ROW EXCLUSIVE lock on members.
--    Authorization  Narrower: members lose the ability to write the new column.
--                   can_reset_password() is narrower than can_add_members().
--    Rollback       DROP TRIGGER trg_guard_member_password_flag; DROP FUNCTION
--                   mark_password_reset, can_reset_password,
--                   guard_member_password_flag; ALTER TABLE members DROP COLUMN
--                   must_change_password. Deploy the old Edge Functions and
--                   client with it: the new ones read the column.
--    Deploy order   Migration first, then the Edge Functions (create-member,
--                   set-own-password, reset-member-password), then the client.
--                   The old client keeps working until then: it never reads
--                   the column, and the old create-member never sets it.
-- =============================================================================

alter table members add column if not exists must_change_password boolean not null default false;

comment on column members.must_change_password is
  'Set when the app issued this person''s password (create-member, a reset). Until they choose their own, the app shows only "Choose your password". Written only by the service role and mark_password_reset().';

-- ---------------------------------------------------------------- the guard
create or replace function guard_member_password_flag() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null
     or new.must_change_password is not distinct from old.must_change_password
     or coalesce(current_setting('reqon.password_flag_write', true), '') = 'on' then
    return new;
  end if;
  raise exception 'The temporary-password flag is set by the app when it issues a password, and cleared when you choose your own.'
    using errcode = '42501';
end $fn$;

drop trigger if exists trg_guard_member_password_flag on members;
create trigger trg_guard_member_password_flag before update of must_change_password on members
  for each row execute function guard_member_password_flag();

-- ------------------------------------------------------- who may reset whom
create or replace function can_reset_password(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null
     and p_member is not null
     and p_member <> auth.uid()
     and can_add_members()
     and exists (select 1 from members where id = p_member)
     and not exists (
       select 1 from member_roles r
       where r.member_id = p_member and not can_grant_role(r.role)
     );
$fn$;

comment on function can_reset_password(uuid) is
  'May the caller issue this person a new temporary password? Active President / VP / Developer, never for themselves, and only if the caller may grant or remove every role the person holds.';

-- ----------------------------------------------- the database half of a reset
create or replace function mark_password_reset(p_member uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not can_reset_password(p_member) then
    raise exception 'You may not reset this person''s password. Only the President, Vice President or a Developer may, never their own, and only for someone whose roles they could change themselves.'
      using errcode = '42501';
  end if;

  perform set_config('reqon.password_flag_write', 'on', true);
  update members set must_change_password = true where id = p_member;
  perform set_config('reqon.password_flag_write', 'off', true);

  insert into activity (actor_id, entity, entity_id, action, detail)
  values (auth.uid(), 'member', p_member::text, 'password_reset', '{}'::jsonb);
end $fn$;

comment on function mark_password_reset(uuid) is
  'Called as the caller by the reset-member-password Edge Function before it sets the new password: re-checks can_reset_password(), sets must_change_password and logs the reset.';

-- 20260126000600's EXECUTE policy: authenticated and service_role only.
revoke all on function guard_member_password_flag() from public, anon, authenticated;
revoke all on function can_reset_password(uuid) from public, anon;
revoke all on function mark_password_reset(uuid) from public, anon;
grant execute on function can_reset_password(uuid) to authenticated, service_role;
grant execute on function mark_password_reset(uuid) to authenticated, service_role;
