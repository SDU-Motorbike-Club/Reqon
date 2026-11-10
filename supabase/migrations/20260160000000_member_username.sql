-- =============================================================================
--  A username, so a member can sign in with it instead of the e-mail.
--
--  BEFORE. The only thing to type at the login was the e-mail address, and many of
--  the club's logins are not addresses anyone remembers.
--  AFTER.  A member may pick a short username (Settings -> Your account). The login
--  form accepts it in place of the e-mail; the username-sign-in Edge Function looks
--  the e-mail up on the server and signs in, so no address is ever handed to a
--  signed-out browser.
--
--   * members.username: optional, lower case, 3 to 30 characters of a-z 0-9 . _ -,
--     starting with a letter or digit. Unique. Cannot contain "@", which is how the login
--     form tells a username from an e-mail.
--   * set_my_username(p_username): the member sets or clears their OWN username.
--     Retired members cannot. A taken name raises 23505 ("That username is taken.").
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let a member sign in with a username.
--    Existing data  Unchanged: every existing member has no username (null).
--    New objects    members.username (+ format check, unique partial index);
--                   function set_my_username(text).
--    Locking        ADD COLUMN without a default is catalogue-only; the unique index is built on a
--                   column that is entirely null, so it is instant.
--    Authorization  members keeps its policies. set_my_username is SECURITY DEFINER with a pinned
--                   search_path, writes only the caller's own row, revoked from public and anon.
--    Rollback       DROP FUNCTION set_my_username(text); DROP INDEX members_username_unique;
--                   ALTER TABLE members DROP COLUMN username.
--    Deploy order   Before the client that offers it; the username-sign-in function after it.
-- =============================================================================

alter table members add column if not exists username text;

alter table members drop constraint if exists members_username_format;
alter table members add constraint members_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

create unique index if not exists members_username_unique on members (username) where username is not null;

comment on column members.username is
  'Optional sign-in name (lower case, 3-30 of a-z 0-9 . _ -). The login form accepts it in place of the e-mail.';

create or replace function set_my_username(p_username text) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_me   uuid := auth.uid();
  v_name text := nullif(lower(btrim(coalesce(p_username, ''))), '');
begin
  if v_me is null or not exists (select 1 from members m where m.id = v_me and m.status <> 'alumni') then
    raise exception 'Only a member on the roster can set a username.' using errcode = '42501';
  end if;
  if v_name is not null and v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'A username is 3 to 30 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.' using errcode = '22023';
  end if;
  begin
    update members set username = v_name where id = v_me;
  exception when unique_violation then
    raise exception 'That username is taken.' using errcode = '23505';
  end;
  return v_name;
end $fn$;

comment on function set_my_username(text) is
  'Sets (or, with an empty value, clears) the caller''s own username. Returns the stored value.';

revoke all on function set_my_username(text) from public, anon;
grant execute on function set_my_username(text) to authenticated, service_role;
