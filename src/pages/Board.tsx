import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { attachmentPermissions, canArchiveTask, canCreateTask, canEditTask, canReassignTaskOwner, canRestoreTask, canSubmitProposal, taskDepartmentTargets } from '../auth/permissions.ts'
import { useAuth } from '../auth/context.ts'
import { departmentChoices } from '../departments/filter.ts'
import { DepartmentNav } from '../departments/DepartmentNav.tsx'
import { ScopeDepartmentFilter } from '../departments/ScopeDepartmentFilter.tsx'
import { useMembers } from '../data/useMembers.ts'
import { useMilestones } from '../data/useMilestones.ts'
import { useProposals } from '../data/useProposals.ts'
import { useRealtimeProposalComments } from '../data/useRealtimeProposalComments.ts'
import { useRealtimeProposalRequirements } from '../data/useRealtimeProposalRequirements.ts'
import { useRealtimeProposals } from '../data/useRealtimeProposals.ts'
import { useRealtimeTaskDependencies } from '../data/useRealtimeTaskDependencies.ts'
import { useRealtimeTaskRequirements } from '../data/useRealtimeTaskRequirements.ts'
import { useRealtimeTasks } from '../data/useRealtimeTasks.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { useTaskActor } from '../data/useTaskActor.ts'
import { useTaskDependencies } from '../data/useTaskDependencies.ts'
import { useSourceProposals, useTaskRequirements, useTasksForProgress } from '../data/useTaskHistory.ts'
import { useRestoreTask, useTasks, useUpdateTask, type Task } from '../data/useTasks.ts'
import { todayIso } from '../lib/dates.ts'
import { milestoneLabel } from '../milestones/label.ts'
import { isHistory } from '../proposals/filters.ts'
import { ProposalsPanel } from '../proposals/ProposalsPanel.tsx'
import { dependentsOf, openPrerequisites, prerequisiteCandidates, prerequisitesOf, taskRefLookup } from '../tasks/dependencies.ts'
import { applyTaskFilter, DEFAULT_TASK_FILTER, filterTasks, isDefaultTaskFilter, taskFilterFromParams, taskScopeCounts, type TaskFilter } from '../tasks/filters.ts'
import type { TaskScope } from '../tasks/scope.ts'
import { TASK_STATES } from '../tasks/taskState.ts'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { ActionError, ErrorState } from '../ui/states.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { LANE_PAGE, laneWindow } from './board/boardView.ts'
import { MoveControl } from './board/MoveControl.tsx'
import { NewTaskDialog } from './board/NewTaskDialog.tsx'
import { TaskCard } from './board/TaskCard.tsx'
import { TaskDetails, type TaskLinksView, type TaskPermissions } from './board/TaskDetails.tsx'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'

// The five lanes, exactly the task_state values in the schema, from the one
// domain-owned definition (tasks/taskState.ts). Urgent is a priority badge on a
// card, never a lane.
const LANES = TASK_STATES

const SCOPES: { value: TaskScope; label: string }[] = [
  { value: 'all', label: 'All tasks' },
  { value: 'mine', label: 'My tasks' },
]

const NO_PERMISSIONS: TaskPermissions = { canEdit: false, canReassign: false, canArchive: false }

export default function Board() {
  const auth = useAuth()
  const tasks = useTasks()
  const members = useMembers()
  const departments = useSubteams()
  const milestones = useMilestones()
  const links = useTaskRequirements()
  const actor = useTaskActor()
  const updateTask = useUpdateTask()
  const realtime = useRealtimeTasks()
  // Someone else linking a task to a requirement must update the counts here.
  useRealtimeTaskRequirements()
  useRealtimeTaskDependencies()
  const dependencies = useTaskDependencies()
  // Proposals are not a page of their own: they are an overlay on the Board, for the department in view.
  const proposals = useProposals()
  const proposalsRealtime = useRealtimeProposals()
  useRealtimeProposalRequirements()
  useRealtimeProposalComments()
  const [params, setParams] = useUrlParams()
  const today = todayIso()

  const myId = auth.status === 'member' ? auth.member.id : null
  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data])
  const departmentList = departments.data

  // The filter lives in the address, so it survives a reload and can be shared.
  // While departments are still loading a department value is trusted as typed;
  // once they are known, an unknown one falls back to "all" and says so.
  const { filter, notice } = useMemo(() => {
    if (!departmentList) {
      const raw = params.get('dept')
      return {
        filter: { scope: params.get('scope') === 'mine' ? ('mine' as const) : ('all' as const), department: raw ?? 'all' },
        notice: null,
      }
    }
    return taskFilterFromParams(params, departmentList)
  }, [params, departmentList])
  // Merged into the address, so ?task= and anything else in it survives.
  const setFilter = (next: TaskFilter) => setParams((current) => applyTaskFilter(current, next), { replace: true })

  const memberName = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  const deptName = useMemo(() => new Map((departmentList ?? []).map((d) => [d.key, d.name])), [departmentList])
  const visible = useMemo(() => filterTasks(allTasks, filter, myId), [allTasks, filter, myId])
  // How many extra cards each lane has been asked to show beyond the first page.
  const [extra, setExtra] = useState<Record<string, number>>({})

  // A link from elsewhere (the Register's linked-task list) can name one task:
  // /board?task=ID opens that card's details. Only a plausible id is honoured,
  // and only against tasks actually on the Board — an unknown one is reported,
  // never guessed at.
  const rawFocus = params.get('task')
  const focusId = rawFocus && /^[0-9a-zA-Z-]{1,64}$/.test(rawFocus) ? rawFocus : null
  const focusTask = focusId ? allTasks.find((t) => t.id === focusId) : undefined
  const focusHidden = Boolean(focusTask) && !visible.some((t) => t.id === focusId)
  const focusMissing = Boolean(focusId) && !tasks.isLoading && !focusTask

  // The one task whose details are open, in a dialog the Board owns: it stays
  // open while its card changes lane. A link naming a task (?task=) opens it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(focusId)
  const [seenFocus, setSeenFocus] = useState(focusId)
  if (seenFocus !== focusId) {
    setSeenFocus(focusId)
    if (focusId) setOpenTaskId(focusId)
  }
  const openTask = openTaskId ? allTasks.find((t) => t.id === openTaskId) : undefined
  const dialogTitleId = useId()
  const proposalsTitleId = useId()
  // ?proposals=1 opens the overlay (a link from the inbox or Now can name it); ?propose=1 also opens its form.
  const proposalsOpen = params.get('proposals') === '1'
  const openProposals = (propose: boolean) =>
    setParams((current) => mergeSearchParams(current, { proposals: '1', propose: propose ? '1' : null }), { replace: true })
  const closeProposals = () => setParams((current) => mergeSearchParams(current, { proposals: null, propose: null, pscope: null, view: null }), { replace: true })
  // After an archive the card is gone: say so, and offer Undo to whoever may restore.
  // The New task dialog (a task leader creates a task straight on the Board), and the line that says it was made.
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [archived, setArchived] = useState<{ id: string; title: string; canRestore: boolean; restored: boolean } | null>(null)
  const restore = useRestoreTask()
  const counts = useMemo(() => taskScopeCounts(allTasks, filter.department, myId), [allTasks, filter.department, myId])
  // How many tasks each department entry would show under the current scope.
  const departmentCounts = useMemo(() => {
    const inScope = filterTasks(allTasks, { scope: filter.scope, department: 'all' }, myId)
    const out: Record<string, number> = { all: inScope.length }
    for (const task of inScope) if (task.subteam_key) out[task.subteam_key] = (out[task.subteam_key] ?? 0) + 1
    return out
  }, [allTasks, filter.scope, myId])
  // Proposals still being worked on in the department in view (all departments: all of them).
  const pendingProposals = useMemo(
    () => (proposals.data ?? []).filter((p) => !isHistory(p) && (filter.department === 'all' || p.subteam_key === filter.department)).length,
    [proposals.data, filter.department],
  )
  // Active departments, plus the selected one even if it has since been archived,
  // so a bookmarked filter still names what it is filtering by.
  const choices = useMemo(
    () => departmentChoices(departmentList ?? [], new Set([filter.department])),
    [departmentList, filter.department],
  )

  const sourceIds = useMemo(() => allTasks.map((t) => t.source_proposal).filter((id): id is string => id !== null), [allTasks])
  const sources = useSourceProposals(sourceIds)

  const activeOwners = useMemo(
    () => (members.data ?? []).filter((m) => m.status !== 'alumni').map((m) => ({ id: m.id, name: m.full_name })),
    [members.data],
  )
  const activeDepartments = useMemo(
    () => (departmentList ?? []).filter((d) => d.archived_at === null).map((d) => ({ key: d.key, name: d.name })),
    [departmentList],
  )
  const milestoneName = useMemo(() => new Map((milestones.data ?? []).map((m) => [m.key, `${milestoneLabel(m)} — ${m.name}`])), [milestones.data])
  const milestoneOptions = useMemo(() => (milestones.data ?? []).map((m) => ({ value: m.key, label: `${milestoneLabel(m)} — ${m.name}` })), [milestones.data])
  const keysByTask = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of links.data ?? []) map.set(link.task_id, [...(map.get(link.task_id) ?? []), link.clause_key])
    return map
  }, [links.data])

  // A prerequisite that finished and was archived still reads by name (the progress list carries archived tasks).
  const progressTasks = useTasksForProgress()
  const taskRefs = useMemo(
    () => taskRefLookup(allTasks, (progressTasks.data ?? []).filter((t) => t.archived_at !== null)),
    [allTasks, progressTasks.data],
  )
  const dependencyLinks = useMemo(() => dependencies.data ?? [], [dependencies.data])
  const linksFor = (task: (typeof allTasks)[number]): TaskLinksView => ({
    prerequisites: prerequisitesOf(dependencyLinks, task.id, taskRefs),
    dependents: dependentsOf(dependencyLinks, task.id, taskRefs),
    candidates: () => prerequisiteCandidates(task, allTasks, dependencyLinks),
    departmentName: (key) => (key ? (deptName.get(key) ?? key) : 'No department'),
  })

  const permsFor = (task: (typeof allTasks)[number]): TaskPermissions => {
    if (!actor) return NO_PERMISSIONS
    const edit = canEditTask(actor, task)
    return {
      canEdit: edit,
      canReassign: edit && canReassignTaskOwner(actor, task),
      canArchive: canArchiveTask(actor, task) && task.archived_at === null,
      moveTo: taskDepartmentTargets(actor, task, activeDepartments),
      attachments: attachmentPermissions(actor, task),
    }
  }
  const ownersFor = (task: (typeof allTasks)[number]) =>
    task.owner_id && !activeOwners.some((o) => o.id === task.owner_id)
      ? [...activeOwners, { id: task.owner_id, name: `${memberName.get(task.owner_id) ?? 'Someone'} (no longer active)` }]
      : activeOwners

  // The tour explains one real card: the first VISIBLE one, reading the lanes in
  // order, so the tour never points at a card the filter has hidden.
  const tutorialTaskId = LANES.map((lane) => visible.find((t) => t.state === lane.state)).find(Boolean)?.id

  const error = tasks.error ?? members.error ?? departments.error
  if (error) {
    return (
      <main id="main-content" tabIndex={-1} className={pageMain()}>
        <h1 className="text-xl font-semibold text-slate-900">Board</h1>
        <div className="mt-4">
          <ErrorState
            title="Could not load the board"
            error={error}
            onRetry={() => {
              void tasks.refetch()
              void members.refetch()
              void departments.refetch()
            }}
          />
        </div>
      </main>
    )
  }

  const filtered = !isDefaultTaskFilter(filter)
  const nothingAtAll = !tasks.isLoading && allTasks.length === 0

  return (
    <main id="main-content" tabIndex={-1} className={pageMain()}>
      <PageHeader title="Board" description="The team’s active tasks, in lanes. Filter them by department or to your own, and open a card’s details to edit it. The Tasks page searches and sorts every task. A task that stays done for 24 hours moves to the Archive on its own.">
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          <span data-testid="board-realtime-state" title="Live updates from other people editing">
            Live updates: {realtime}
          </span>
          <Link to="/archive" className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-0">
            Archive
          </Link>
        </p>
      </PageHeader>

      {/* Whoever may create a task does; everyone else on the roster can only propose one, and the department's
          Head decides. Both sit here, and the proposals already waiting are one button away. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {canCreateTask(actor) && (
          <button
            type="button"
            className={buttonPrimary}
            data-testid="board-new-task"
            data-tutorial="board-new-task"
            onClick={() => {
              setCreated(null)
              setCreating(true)
            }}
          >
            New task
          </button>
        )}
        {actor && canSubmitProposal(actor) && (
          <button
            type="button"
            className={canCreateTask(actor) ? buttonSecondary : buttonPrimary}
            data-testid="board-propose-task"
            data-tutorial="board-propose"
            onClick={() => openProposals(true)}
          >
            Propose a task
          </button>
        )}
        <button type="button" className={buttonSecondary} data-testid="board-proposals" data-tutorial="board-proposals" onClick={() => openProposals(false)}>
          Proposals <span className="tabular-nums">({pendingProposals})</span>
          <span className="sr-only"> {filter.department === 'all' ? 'in all departments' : 'in this department'} still open</span>
        </button>
        {created && (
          <p role="status" className="text-sm text-emerald-800" data-testid="board-task-created">
            Created “{created}”.
          </p>
        )}
      </div>

      <DepartmentNav choices={choices} value={filter.department} counts={departmentCounts} testId="board-departments" />

      {focusMissing && (
        <p role="status" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-testid="board-task-missing">
          That task is not on the Board. It may have been archived —{' '}
          <Link to={`/archive?tab=tasks&id=${encodeURIComponent(focusId as string)}`} className="underline underline-offset-2">
            look for it in the Archive
          </Link>
          .
        </p>
      )}
      {focusHidden && (
        <p role="status" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-testid="board-task-hidden">
          That task is hidden by the current filters.{' '}
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams({ task: focusId as string }), { replace: true })}
            className="min-h-11 rounded border border-amber-300 bg-surface px-2 py-0.5 text-xs font-medium sm:min-h-0"
          >
            Show all tasks
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-testid="board-filter-notice">
          {notice}
        </p>
      )}

      {/* "My tasks" needs a member row to mean anything, so the scope buttons
          are only offered to someone the roster knows; Department always is. */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-surface p-3" data-testid="board-filters">
        {myId ? (
          <ScopeDepartmentFilter
            scopes={SCOPES}
            scope={filter.scope}
            onScope={(scope) => setFilter({ ...filter, scope })}
            counts={counts}
            scopeGroupLabel="Which tasks to show"
            scopeTestId="board-scope"
          />
        ) : (
          <ScopeDepartmentFilter
            scopes={[SCOPES[0]]}
            scope="all"
            onScope={() => {}}
            counts={counts}
            scopeGroupLabel="Which tasks to show"
            scopeTestId="board-scope"
          />
        )}
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="board-filter-summary">
          <span>
            Showing {visible.length} of {allTasks.length} active tasks
            {filtered ? ` · ${filter.scope === 'mine' ? 'My tasks' : 'All tasks'} · ${filter.department === 'all' ? 'All departments' : (choices.find((c) => c.key === filter.department)?.label ?? filter.department)}` : ''}
          </span>
          {filtered && (
            <button type="button" onClick={() => setFilter(DEFAULT_TASK_FILTER)} className="inline-flex min-h-11 items-center rounded font-medium text-slate-900 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none sm:min-h-0">
              Clear filters
            </button>
          )}
        </p>
      </div>

      {archived && (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800" data-testid="board-archived">
          {archived.restored ? (
            <>Restored “{archived.title}”.</>
          ) : (
            <>
              Archived “{archived.title}”.
              {archived.canRestore ? (
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate({ id: archived.id }, { onSuccess: () => setArchived({ ...archived, restored: true }) })
                  }
                  className="inline-flex min-h-11 items-center rounded font-medium underline underline-offset-2 sm:min-h-0"
                  data-testid="board-archived-undo"
                >
                  {restore.isPending ? 'Restoring…' : 'Undo'}
                </button>
              ) : (
                <Link to={`/archive?tab=tasks&id=${encodeURIComponent(archived.id)}`} className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-0">
                  It is in the Archive
                </Link>
              )}
            </>
          )}
          <ActionError error={restore.error} className="basis-full" />
        </div>
      )}
      {updateTask.isError && (
        <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Could not change that task: {updateTask.error.message}
        </p>
      )}
      {updateTask.isPending && (
        <p role="status" className="mb-3 text-xs text-slate-500">
          Saving…
        </p>
      )}
      {tasks.isLoading && (
        <p role="status" className="mb-3 text-xs text-slate-500">
          Loading…
        </p>
      )}

      {nothingAtAll && (
        <p className="mb-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="board-empty">
          There are no active tasks in this season yet. A task is created when a proposal is approved, in{' '}
          <button type="button" onClick={() => openProposals(false)} className="underline underline-offset-2">
            Proposals
          </button>
          .
        </p>
      )}
      {!tasks.isLoading && !nothingAtAll && visible.length === 0 && (
        <p className="mb-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="board-no-match">
          No tasks match these filters.{' '}
          <button type="button" onClick={() => setFilter(DEFAULT_TASK_FILTER)} className="underline underline-offset-2 hover:text-slate-900">
            Clear filters
          </button>
        </p>
      )}

      {/* Lanes render immediately and fill in; they are not swapped for a
          spinner, so an open select is never yanked away mid-change. */}
      {/* On a phone the lanes sit side by side and swipe, the next one peeking
          in, so "In progress" is not buried under every To do card. */}
      <div className="relative -mx-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 min-[75rem]:grid-cols-5" data-tutorial="board-lanes">
        {LANES.map((lane) => {
          const laneTasks = visible.filter((t) => t.state === lane.state)
          const limit = LANE_PAGE + (extra[lane.state] ?? 0)
          const { shown, hidden } = laneWindow(laneTasks, limit, focusId ?? openTaskId)
          return (
            <section key={lane.state} className={`w-[85%] flex-none snap-start self-start rounded-lg border p-2 sm:w-auto sm:self-auto ${lane.boardTone}`} aria-labelledby={`lane-${lane.state}`} data-testid={`lane-${lane.state}`}>
              <h2 id={`lane-${lane.state}`} className="mb-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {lane.label} <span className="font-normal text-slate-700">({laneTasks.length})</span>
              </h2>
              {laneTasks.length === 0 ? (
                <p className="px-1 py-2 text-xs text-slate-700">Nothing here.</p>
              ) : (
                <ul className="space-y-2">
                  {shown.map((task) => {
                    const source = task.source_proposal ? sources.data?.get(task.source_proposal) : undefined
                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        today={today}
                        tutorial={task.id === tutorialTaskId}
                        focused={task.id === focusId}
                        departmentName={task.subteam_key ? (deptName.get(task.subteam_key) ?? task.subteam_key) : null}
                        ownerName={task.owner_id ? (memberName.get(task.owner_id) ?? 'Someone no longer on the roster') : null}
                        milestoneLabel={task.milestone_key ? (milestoneName.get(task.milestone_key) ?? task.milestone_key) : null}
                        requirementKeys={keysByTask.get(task.id) ?? []}
                        source={source ? { id: source.id, title: source.title } : null}
                        perms={permsFor(task)}
                        moving={updateTask.isPending}
                        links={linksFor(task)}
                        detailsOpen={task.id === openTaskId}
                        onOpenDetails={() => setOpenTaskId(task.id)}
                        onMove={(id, state, blockedReason) => updateTask.mutate({ id, state, ...(blockedReason ? { blockedReason } : {}) })}
                      />
                    )
                  })}
                </ul>
              )}
              {(hidden > 0 || (extra[lane.state] ?? 0) > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setExtra((e) => ({ ...e, [lane.state]: (e[lane.state] ?? 0) + LANE_PAGE }))}
                      className="inline-flex min-h-11 items-center rounded border border-slate-300 bg-surface px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none sm:min-h-0 sm:py-1"
                      data-testid={`board-more-${lane.state}`}
                    >
                      Show {Math.min(LANE_PAGE, hidden)} more ({hidden} left)
                    </button>
                  )}
                  {(extra[lane.state] ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setExtra((e) => ({ ...e, [lane.state]: 0 }))}
                      className="inline-flex min-h-11 items-center rounded px-2 text-xs text-slate-700 underline underline-offset-2 sm:min-h-0"
                      data-testid={`board-fewer-${lane.state}`}
                    >
                      Show fewer
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <NewTaskDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(task) => {
          setCreating(false)
          setCreated(task.title)
        }}
        departments={activeDepartments}
        owners={activeOwners}
        milestones={milestoneOptions}
        viewerId={myId}
        defaultDepartment={filter.department}
      />

      <Dialog open={proposalsOpen} onClose={closeProposals} labelledBy={proposalsTitleId}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id={proposalsTitleId} className="text-base font-semibold text-balance text-slate-900">
              Task proposals{filter.department === 'all' ? '' : ` · ${choices.find((c) => c.key === filter.department)?.label ?? filter.department}`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Work anyone can raise. The department’s Head — or the President or Vice President — approves it, and it becomes a task on this Board.
            </p>
          </div>
          <button type="button" onClick={closeProposals} className="min-h-11 shrink-0 rounded px-2 text-sm underline underline-offset-2 sm:min-h-0">
            Close
          </button>
        </div>
        <ProposalsPanel
          embedded
          heading="Proposals"
          emptyHint="Nothing raised here yet. Propose the first one — anything the club should take on."
          proposals={proposals}
          realtime={proposalsRealtime}
        />
      </Dialog>

      <Dialog open={openTask !== undefined} onClose={() => setOpenTaskId(null)} labelledBy={dialogTitleId}>
        {openTask && (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id={dialogTitleId} className="text-base font-semibold text-balance text-slate-900">
                {openTask.title}
              </h2>
              <button type="button" onClick={() => setOpenTaskId(null)} className="min-h-11 shrink-0 rounded px-2 text-sm underline underline-offset-2 sm:min-h-0">
                Close
              </button>
            </div>
            {/* The lane, here too: a task opened from a link can be moved without closing this. */}
            {permsFor(openTask).canEdit && (
              <div className="mb-3 max-w-xs">
                <MoveControl
                  task={openTask}
                  openPrerequisites={openPrerequisites(linksFor(openTask).prerequisites).length}
                  moving={updateTask.isPending}
                  onMove={(id, state, blockedReason) => updateTask.mutate({ id, state, ...(blockedReason ? { blockedReason } : {}) })}
                  idPrefix="task-dialog-state"
                  testIdPrefix="task-dialog-block-form"
                  visibleLabel="Lane"
                />
                <ActionError error={updateTask.isError ? updateTask.error : null} className="mt-1" />
              </div>
            )}
            <TaskDetails
              key={openTask.id}
              task={openTask}
              perms={permsFor(openTask)}
              owners={ownersFor(openTask)}
              milestones={milestoneOptions}
              requirementKeys={keysByTask.get(openTask.id) ?? []}
              links={linksFor(openTask)}
              viewerId={myId}
              onArchived={(task: Task) => {
                setOpenTaskId(null)
                setArchived({ id: task.id, title: task.title, canRestore: actor ? canRestoreTask(actor, task) : false, restored: false })
              }}
            />
          </>
        )}
      </Dialog>
    </main>
  )
}
