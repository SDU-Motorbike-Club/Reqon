-- =============================================================================
--  Deleting an archived PARENT task (follow-up to 20260151000000_task_parent.sql).
--
--  parent_id is ON DELETE SET NULL, and that cascade is an ordinary UPDATE of the
--  subtasks. A subtask that is itself archived (a done subtask is archived after
--  24 hours) is refused by guard_task_edit ("This task is archived"), which aborted
--  the whole delete. delete_archived_task now releases the subtasks first, inside
--  the same internal lifecycle write the archive functions use.
--
--  Same signature, so the grants and the comment from 20260146000000 are kept.
-- =============================================================================

create or replace function delete_archived_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_task tasks%rowtype;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'Only the President, Vice President or a Developer can delete a task.' using errcode = '42501';
  end if;
  select * into v_task from tasks where id = p_task_id;
  if not found then
    raise exception 'That task does not exist (it may already be deleted).' using errcode = 'P0002';
  end if;
  if v_task.archived_at is null then
    raise exception 'Archive the task first. Only an archived task can be deleted.' using errcode = '22023';
  end if;
  perform set_config('reqon.task_lifecycle_write', 'on', true);
  update tasks set parent_id = null where parent_id = p_task_id;
  perform set_config('reqon.task_lifecycle_write', 'off', true);
  delete from tasks where id = p_task_id;
  insert into activity (actor_id, season_id, entity, entity_id, action, detail)
  values (auth.uid(), v_task.season_id, 'task', p_task_id::text, 'deleted',
    jsonb_build_object('title', v_task.title, 'state', v_task.state, 'archive_reason', v_task.archive_reason));
end $fn$;
