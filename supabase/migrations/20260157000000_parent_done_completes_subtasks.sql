-- =============================================================================
--  A parent task that becomes Done completes its open subtasks too (the other
--  direction of sync_parent_task_state in 20260151000000).
--
--  * Open = todo / wip / blocked and not archived. Cancelled subtasks stay cancelled
--    (nothing was achieved) and archived ones are history, so both are left alone.
--  * ONE statement, so sync_parent_task_state (an AFTER ROW trigger) runs only after
--    every subtask is Done; it then sees no open subtask and leaves the parent Done
--    instead of bouncing it back to In progress.
--  * SECURITY DEFINER like the sync trigger: whoever may edit the parent finishes its
--    subtasks, even ones they could not edit one by one. Trigger only, not an RPC.
-- =============================================================================

create or replace function complete_subtasks_with_parent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tasks set state = 'done'
   where parent_id = new.id and archived_at is null and state in ('todo', 'wip', 'blocked');
  return null;
end $$;

revoke execute on function complete_subtasks_with_parent() from public, anon, authenticated;

drop trigger if exists trg_parent_done_completes_subtasks on tasks;
create trigger trg_parent_done_completes_subtasks after update of state on tasks
  for each row when (new.state = 'done' and old.state is distinct from 'done' and new.parent_id is null)
  execute function complete_subtasks_with_parent();
