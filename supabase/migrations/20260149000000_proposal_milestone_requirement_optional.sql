-- =============================================================================
--  A task or proposal needs only a title and a deadline.
--
--  WHAT WAS WRONG. create_task(), submit_proposal(), approve_proposal() and promote_proposal() each refused
--  work without a department, and the proposal ones also without a milestone and at least one requirement
--  (ADR-0005), so a plain "we should do X" could not be raised until someone had looked up where it
--  belonged. The club wants only a title and a deadline; the department, the milestone, the requirements
--  and a start date can come later, on the task.
--
--  AFTER.
--   * create_task(): the department is optional (the start date already was: none means today). A department
--     that is given must still be an active one. A task with no department is reviewed and archived by the
--     President, Vice President or a Developer, as department_authority(null) already provides.
--   * submit_proposal(): department, milestone and requirements are optional. What is given must still be
--     real: an active department, a milestone of the same season, requirements that exist.
--   * approve_proposal(): needs a deadline, not a department, a milestone or requirements.
--   * promote_proposal(): needs a deadline. The task it makes keeps `links_required` (a task made from a
--     proposal cannot lose its milestone and requirement) ONLY when the proposal HAD both; a proposal
--     without them makes an ordinary task they can be added to, or not, later.
--   * revise_proposal() and guard_proposal_edit() are not changed: a proposal that has a milestone or
--     requirements still cannot have them cleared by an edit, so an edit never leaves it half-formed.
--
--  Patched in place, by replacing exact fragments of the live definitions: the migration aborts if a
--  definition has drifted from what is expected, instead of silently skipping it.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Make everything but the title and the deadline optional.
--    Existing data  Untouched. Proposals already carry their milestone and requirements.
--    Locking        CREATE OR REPLACE FUNCTION: metadata only.
--    Authorization  Unchanged: who may raise, approve or promote is exactly as before.
--    Rollback       Re-apply the earlier definitions (20260130000000 / 20260128000500 lineage).
--    Deploy order   Any time after 20260148000000. Deploy the client after: it stops asking for them.
-- =============================================================================

create or replace function pg_temp.patch_function(
  p_name text, p_from text, p_to text, p_functions int, p_hits int
) returns void language plpgsql as $fn$
declare
  r record;
  v_def text;
  v_hits int;
  v_done int := 0;
begin
  for r in select p.oid from pg_proc p where p.proname = p_name and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(r.oid);
    v_hits := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
    if v_hits = 0 then
      continue;
    end if;
    if v_hits <> p_hits then
      raise exception 'patch_function(%): % contains % occurrences of %, expected %',
        p_name, r.oid::regprocedure, v_hits, p_from, p_hits;
    end if;
    execute replace(v_def, p_from, p_to);
    v_done := v_done + 1;
  end loop;
  if v_done <> p_functions then
    raise exception 'patch_function(%): patched % functions, expected %', p_name, v_done, p_functions;
  end if;
end $fn$;

-- ----------------------------------------------------------------- create_task
select pg_temp.patch_function('create_task',
  E'if p_subteam_key is null\n     or not exists (select 1 from subteams s where s.key = p_subteam_key and s.archived_at is null) then',
  E'if p_subteam_key is not null\n     and not exists (select 1 from subteams s where s.key = p_subteam_key and s.archived_at is null) then', 1, 1);

-- ------------------------------------------------------------- submit_proposal
select pg_temp.patch_function('submit_proposal',
  E'if p_subteam_key is null then\n    raise exception ''A proposal needs a department.'' using errcode = ''23502'';\n  end if;\n  perform 1 from subteams where key = p_subteam_key for share;\n  if not exists (select 1 from subteams where key = p_subteam_key and archived_at is null) then',
  E'perform 1 from subteams where key = p_subteam_key for share;\n  if p_subteam_key is not null and not exists (select 1 from subteams where key = p_subteam_key and archived_at is null) then', 1, 1);
select pg_temp.patch_function('submit_proposal',
  'if p_milestone_key is null or not exists (',
  'if p_milestone_key is not null and not exists (', 1, 1);
select pg_temp.patch_function('submit_proposal',
  'if v_keys is null or cardinality(v_keys) < 1 then',
  E'v_keys := coalesce(v_keys, ''{}''::text[]);\n  if false then', 1, 1);

-- ------------------------------------------------------------ approve_proposal
select pg_temp.patch_function('approve_proposal',
  E'if v.subteam_key is null or v.due_date is null or v.milestone_key is null\n     or not exists (select 1 from proposal_requirements r where r.proposal_id = p_proposal_id) then\n    raise exception ''The proposal is missing its department, deadline, milestone or requirements.''',
  E'if v.due_date is null then\n    raise exception ''The proposal is missing its deadline.''', 1, 1);
select pg_temp.patch_function('approve_proposal',
  'if not exists (select 1 from subteams s where s.key = v.subteam_key and s.archived_at is null) then',
  'if v.subteam_key is not null and not exists (select 1 from subteams s where s.key = v.subteam_key and s.archived_at is null) then', 1, 1);

-- ------------------------------------------------------------ promote_proposal
select pg_temp.patch_function('promote_proposal',
  'if not exists (select 1 from subteams s where s.key = v_prop.subteam_key and s.archived_at is null) then',
  'if v_prop.subteam_key is not null and not exists (select 1 from subteams s where s.key = v_prop.subteam_key and s.archived_at is null) then', 1, 1);
select pg_temp.patch_function('promote_proposal',
  E'if v_prop.due_date is null or v_prop.milestone_key is null\n     or not exists (select 1 from proposal_requirements r where r.proposal_id = p_proposal_id) then\n    raise exception ''The proposal is missing its deadline, milestone or requirements.''',
  E'if v_prop.due_date is null then\n    raise exception ''The proposal is missing its deadline.''', 1, 1);
select pg_temp.patch_function('promote_proposal',
  E'''todo'', p_proposal_id, auth.uid(), true)',
  E'''todo'', p_proposal_id, auth.uid(),\n          (v_prop.milestone_key is not null and exists (select 1 from proposal_requirements r where r.proposal_id = p_proposal_id)))', 1, 1);

-- ---------------------------------------------------------- restore support
select restore.install_tombstone_triggers();
