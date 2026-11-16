-- =============================================================================
--  Public site: the application form no longer has custom questions.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Drop application_questions; the form asks only name, email, phone and consent.
--    Existing data  membership_applications is untouched: applications already sent keep their answers
--                   (stored as text next to each question, so nothing points at the dropped table).
--    Locking        DROP TABLE on a small table.
--    Rollback       Re-run the application_questions part of 20260162000100.
--    Deploy order   After 20260162000100.
-- =============================================================================

-- Same signature so the website's calls keep working; p_answers is accepted and ignored.
create or replace function submit_application(
  p_full_name text, p_email text, p_phone text, p_consent boolean, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if coalesce(p_consent, false) is false then
    raise exception 'Please agree to the club keeping your application.' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 120 then
    raise exception 'Please give your name.' using errcode = '23514';
  end if;
  if not coalesce(btrim(p_email) similar to '[^@[:space:]]+@[^@[:space:]]+.[^@[:space:]]+', false) or length(p_email) > 254 then
    raise exception 'Please give a valid email address.' using errcode = '23514';
  end if;
  if nullif(btrim(p_phone), '') is not null and not btrim(p_phone) similar to '[+]?[0-9 ()./-]{4,30}' then
    raise exception 'Please check the phone number.' using errcode = '23514';
  end if;
  -- ponytail: one global cap, since anon has no identity to limit per sender. Add a captcha in front if spam arrives.
  if (select count(*) from membership_applications where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many applications right now. Please try again in an hour.' using errcode = '54000';
  end if;

  insert into membership_applications (full_name, email, phone, consent)
  values (btrim(p_full_name), btrim(p_email), nullif(btrim(p_phone), ''), true)
  returning id into v_id;
  return v_id;
end $fn$;

drop table if exists application_questions;
