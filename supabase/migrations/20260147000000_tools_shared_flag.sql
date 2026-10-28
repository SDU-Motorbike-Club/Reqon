-- =============================================================================
--  A tool is either someone's own or a club tool.
--
--  WHAT WAS MISSING. A tool had an owner, a place and a holder, but nothing said whether it was the
--  owner's own (a personal drill brought along) or something the club keeps for everyone (the vise in
--  the workshop, a university instrument). The list could not tell the two apart.
--
--  AFTER. `tools.shared` is chosen when the tool is listed: false (the default) = the owner's own,
--  true = a club tool. The person who lists a club tool is still its owner, i.e. the one who keeps the
--  list entry right; `shared` only changes how it is described. It is set at creation and is not
--  editable afterwards (no UPDATE grant on the column): a tool that changes hands is removed and listed
--  again, so the list never says "club tool" about something that was once somebody's drill.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Tell a member's own tool from a club tool.
--    Existing data  Every existing tool becomes "own" (shared = false), which is what they all were.
--    Locking        ALTER TABLE ADD COLUMN with a constant default: metadata only.
--    Authorization  Unchanged. INSERT is table-wide for authenticated (so the new column can be set when a
--                   tool is listed); UPDATE stays limited to item, location, held_by.
--    Rollback       ALTER TABLE tools DROP COLUMN shared.
--    Deploy order   Any time after 20260146000000. Deploy the client after this migration: it inserts the column.
-- =============================================================================

alter table tools add column if not exists shared boolean not null default false;

comment on column tools.shared is
  'false = the owner''s own tool; true = a club tool. Chosen when the tool is listed and never changed afterwards.';

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
