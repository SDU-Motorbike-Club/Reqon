-- =============================================================================
--  Public site, step 1 of 2: the Recruitment and Blog role values.
--
--  AFTER. privileged_role gains 'recruitment' (edits the application form of the
--  public website and reads the applications) and 'blog' (writes the posts the
--  public website shows). Nothing uses them in this file: a new enum value cannot
--  be used inside the transaction that adds it, so the helpers that read them
--  (can_manage_applicants, can_post_blog) are created by 20260162000100.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Add two enum labels.
--    Existing data  None touched. Nobody is given either role.
--    Authorization  None by itself. can_grant_role() already lets the President,
--                   Vice President or a Developer give and take away any role that
--                   is not developer/president/vicepresident.
--    Rollback       Postgres cannot drop an enum label: leave it unused.
--    Deploy order   Before 20260162000100.
-- =============================================================================

alter type privileged_role add value if not exists 'recruitment';
alter type privileged_role add value if not exists 'blog';
