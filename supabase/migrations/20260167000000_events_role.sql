-- =============================================================================
--  Public site permissions, step 1 of 2: the Events role value.
--
--  AFTER. privileged_role gains 'events' (adds, edits, hides and deletes the public website's events). Until now
--  the Blog role covered events too; 20260167000100 splits them and moves the checks over. A new enum value
--  cannot be used inside the transaction that adds it, so nothing here reads it.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Add one enum label.
--    Existing data  None touched.
--    Authorization  None by itself. can_grant_role() already lets the President, Vice President or a Developer
--                   give and take away any role that is not developer/president/vicepresident.
--    Rollback       Postgres cannot drop an enum label: leave it unused.
--    Deploy order   Before 20260167000100.
-- =============================================================================

alter type privileged_role add value if not exists 'events';
