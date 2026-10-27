-- =============================================================================
--  WIPE ALL TASKS AND PROPOSALS (a deliberate, one-off clean-out).
--
--  What it removes: every task (with its requirement links, prerequisite links and
--  attachment rows), every proposal (with its requirement links and its discussion)
--  and the history rows (activity) and inbox notifications about them.
--  What it keeps: members, roles, departments, seasons, milestones and sections,
--  requirements, meetings, contacts, tools, finances, the Book. Nothing else is touched.
--
--  HOW TO RUN (Supabase -> SQL Editor, on the project the app uses):
--    1. Run it as it is. It ends with ROLLBACK, so NOTHING is deleted: read the two result
--       tables ("before" and "after"). "after" must be 0 for tasks and proposals.
--    2. If the numbers are right, change the last line from `rollback;` to `commit;` and run again.
--
--  RECOVERY: before deleting, it copies everything it will remove into the private schema
--  maintenance_backup (tables w20261027_*). Owner-only; no API role can read it. It refuses to run
--  twice (the backup tables would already exist): drop them first if you really mean to run it again.
--  Attached files in storage are queued for removal by the attachment cleanup (they are NOT restorable
--  from this backup; the rows are).
--
--  WHY THE TRIGGER LINE: a proposal's discussion is append-only by design (a trigger refuses any
--  delete). Removing a proposal means removing its discussion, so the guard is switched off for that
--  one statement and switched on again in the same transaction. Nothing outside this script can do it.
--
--  Kept in step with its test: supabase/tests/maintenance_scripts_test.sql runs these statements.
-- =============================================================================
begin;

-- ------------------------------------------------------------------ 1. backup
create schema if not exists maintenance_backup;
revoke all on schema maintenance_backup from public;

create table maintenance_backup.w20261027_tasks             as select * from tasks;
create table maintenance_backup.w20261027_task_requirements as select * from task_requirements;
create table maintenance_backup.w20261027_task_dependencies as select * from task_dependencies;
create table maintenance_backup.w20261027_task_attachments  as select * from task_attachments;
create table maintenance_backup.w20261027_proposals         as select * from task_proposals;
create table maintenance_backup.w20261027_proposal_reqs     as select * from proposal_requirements;
create table maintenance_backup.w20261027_proposal_comments as select * from proposal_comments;
create table maintenance_backup.w20261027_activity          as select * from activity where entity in ('task', 'proposal');
create table maintenance_backup.w20261027_notifications     as
  select * from notifications where activity_id in (select id from activity where entity in ('task', 'proposal'));

-- ------------------------------------------------------------------- 2. before
select 'before' as stage,
       (select count(*) from tasks)                as tasks,
       (select count(*) from task_proposals)       as proposals,
       (select count(*) from proposal_comments)    as proposal_comments,
       (select count(*) from activity where entity in ('task', 'proposal')) as history_rows,
       (select count(*) from notifications)        as notifications;

-- ------------------------------------------------------------------- 3. delete
alter table proposal_comments disable trigger trg_guard_proposal_comment_rows;
delete from proposal_comments;
alter table proposal_comments enable trigger trg_guard_proposal_comment_rows;

delete from tasks;               -- also removes task_requirements, task_dependencies, task_attachments (cascade)
delete from task_proposals;      -- also removes proposal_requirements (cascade)
delete from activity where entity in ('task', 'proposal');   -- their inbox notifications go with them (cascade)

-- -------------------------------------------------------------------- 4. after
select 'after' as stage,
       (select count(*) from tasks)                as tasks,
       (select count(*) from task_proposals)       as proposals,
       (select count(*) from proposal_comments)    as proposal_comments,
       (select count(*) from activity where entity in ('task', 'proposal')) as history_rows,
       (select count(*) from notifications)        as notifications;

-- Change to `commit;` ONLY when "after" shows 0 tasks and 0 proposals and you have read "before".
rollback;
