-- =============================================================================
--  Progress with parent tasks (follow-up to 20260151000000_task_parent.sql).
--
--  A parent task and its subtasks are one piece of work. v_task_progress counted
--  both, so a parent plus two subtasks with one done read 1 of 3. Inside each
--  (scope, scope_key) group a parent that has a subtask IN THAT GROUP is left out
--  and its subtasks stand for it: 1 of 2. A parent whose subtasks sit in another
--  group still counts in its own, so a requirement linked only to the parent does
--  not lose its work. Mirrored by taskProgress() in src/tasks/progress.ts.
--
--  Same columns as 20260129000100, so grants and dependants are unchanged.
-- =============================================================================

create or replace view v_task_progress with (security_invoker = on) as
with member as (
  select t.season_id, 'season'::text as scope, ''::text as scope_key, t.id, t.state, t.archived_at, t.parent_id from tasks t
  union all
  select t.season_id, 'department', t.subteam_key, t.id, t.state, t.archived_at, t.parent_id
    from tasks t where t.subteam_key is not null
  union all
  select t.season_id, 'department_rollup', k, t.id, t.state, t.archived_at, t.parent_id
    from tasks t
    join subteams s on s.key = t.subteam_key
    cross join lateral unnest(array[s.key, s.parent_key]) k
   where k is not null
  union all
  select t.season_id, 'unassigned', '', t.id, t.state, t.archived_at, t.parent_id
    from tasks t where t.subteam_key is null
  union all
  select t.season_id, 'milestone', coalesce(t.milestone_key, sec.milestone_key), t.id, t.state, t.archived_at, t.parent_id
    from tasks t
    left join milestone_sections sec on sec.id = t.section_id
   where coalesce(t.milestone_key, sec.milestone_key) is not null
  union all
  select t.season_id, 'section', k::text, t.id, t.state, t.archived_at, t.parent_id
    from tasks t
    join milestone_sections sec on sec.id = t.section_id
    cross join lateral unnest(array[sec.id, sec.parent_section_id]) k
   where k is not null
  union all
  select t.season_id, 'requirement', r.clause_key, t.id, t.state, t.archived_at, t.parent_id
    from tasks t
    join task_requirements r on r.task_id = t.id
), counted as (
  select m.season_id, m.scope, m.scope_key,
         count(distinct m.id) filter (where m.state <> 'cancelled')                                  as total,
         count(distinct m.id) filter (where m.state = 'done')                                        as done,
         count(distinct m.id) filter (where m.state = 'done' and m.archived_at is not null)          as archived_done,
         count(distinct m.id) filter (where m.archived_at is not null and m.state not in ('done', 'cancelled')) as archived_unfinished,
         count(distinct m.id) filter (where m.state = 'cancelled')                                   as cancelled,
         count(distinct m.id) filter (where m.archived_at is null and m.state not in ('done', 'cancelled')) as open_active
    from member m
   where not exists (
     select 1 from member c
      where c.season_id = m.season_id and c.scope = m.scope and c.scope_key = m.scope_key and c.parent_id = m.id
   )
   group by m.season_id, m.scope, m.scope_key
)
select season_id, scope, scope_key, total, done, archived_done, archived_unfinished, cancelled, open_active,
       case when total = 0 then null else round(100.0 * done / total)::int end as percent
  from counted;

comment on view v_task_progress is
  'Task progress per season and scope (season, department, department_rollup, unassigned, milestone, section, requirement). Distinct tasks; a parent that has a subtask in the same group is left out and its subtasks stand for it; cancelled excluded from the denominator; archived done keeps its contribution; archived unfinished stays undone; percent NULL when there is no linked work. Mirrored by src/tasks/progress.ts.';
