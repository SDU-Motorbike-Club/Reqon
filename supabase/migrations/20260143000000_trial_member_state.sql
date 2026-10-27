-- =============================================================================
--  Trial members, step 1 of 2: the new roster status.
--
--  A new person can be put on the roster as 'trial'. What a trial member may do is
--  in 20260143000100_trial_member_access.sql; see docs/trial-members.md.
--
--  Why a separate migration: PostgreSQL cannot use a new enum value in the
--  transaction that adds it, and step 2 uses 'trial' in function bodies.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Add 'trial' to member_state.
--    Existing data  Untouched: every current member keeps their status.
--    New objects    One enum value.
--    Locking        ALTER TYPE ... ADD VALUE: brief, no table rewrite.
--    Authorization  None changes here: nothing uses the value yet.
--    Rollback       A value cannot be dropped from an enum. Unused, it does nothing.
--    Deploy order   Before 20260143000100.
-- =============================================================================

alter type member_state add value if not exists 'trial';
