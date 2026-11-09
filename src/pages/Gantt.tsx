import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAuth } from '../auth/context.ts'
import { usePermissions } from '../auth/usePermissions.ts'
import { canEditTask, canReassignTaskOwner } from '../auth/permissions.ts'
import { DepartmentNav } from '../departments/DepartmentNav.tsx'
import { ScopeDepartmentFilter } from '../departments/ScopeDepartmentFilter.tsx'
import { departmentChoices } from '../departments/filter.ts'
import { formatDay, todayIso } from '../lib/dates.ts'
import { milestoneLabel } from '../milestones/label.ts'
import { useSeasonId } from '../season/context.ts'
import { mergeSearchParams, readSetParam, writeSetParam } from '../lib/searchParams.ts'
import { applyTaskFilter, filterTasks, isDefaultTaskFilter, taskFilterFromParams, taskScopeCounts, type TaskFilter } from '../tasks/filters.ts'
import { prerequisitesOf, taskRefLookup } from '../tasks/dependencies.ts'
import { isOverdue } from '../tasks/overdue.ts'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError, EmptyState, ErrorState } from '../ui/states.tsx'
import { useMembers } from '../data/useMembers.ts'
import { useMilestones, useMilestoneSections } from '../data/useMilestones.ts'
import { useRealtimeTaskDependencies } from '../data/useRealtimeTaskDependencies.ts'
import { useRealtimeTasks } from '../data/useRealtimeTasks.ts'
import { useRealtimeMilestones } from '../data/useRealtimeMilestones.ts'
import { useRealtimeMilestoneSections } from '../data/useRealtimeMilestoneSections.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { useTaskActor } from '../data/useTaskActor.ts'
import { useTaskDependencies } from '../data/useTaskDependencies.ts'
import { useTasksForProgress } from '../data/useTaskHistory.ts'
import { useTasks, useUpdateTask, type Task, type TaskEdit } from '../data/useTasks.ts'
import { gridStyle } from './gantt/ganttGrid.ts'
import { GanttLegend } from './gantt/GanttLegend.tsx'
import { GanttToolbar } from './gantt/GanttToolbar.tsx'
import { MilestoneRow } from './gantt/MilestoneRow.tsx'
import type { GanttEnv } from './gantt/ganttEnv.ts'
import { currentTargetKey, linkEdit, targetKey, unlinkMilestoneEdit, unlinkSectionEdit, type LinkTarget } from './gantt/ganttLinking.ts'
import { planScheduleEdit } from './board/taskEditPlan.ts'
import { subsectionsOf, topLevelSections } from './milestones/milestoneModel.ts'
import { planningDates, taskMark } from './gantt/ganttMarks.ts'
import { monthTicks, placeDay, timelineRange, weekTicks } from './gantt/ganttModel.ts'
import type { ProgressRow } from './gantt/ganttProgress.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'

const SCOPES = [
  { value: 'all' as const, label: 'All tasks' },
  { value: 'mine' as const, label: 'My tasks' },
]

// The composition shell: fetches data, holds the open/closed sets, the scale and
// the department lens, computes the shared timeline range and today-line
// position, and renders one MilestoneRow per milestone. How a row draws itself
// lives in gantt/MilestoneRow.tsx, SectionRow.tsx, UnsectionedRow.tsx and
// GanttTaskRow.tsx; this file is interaction orchestration, not rendering.
//
// The Gantt cannot create tasks (source §30): the only work-association commands
// are link, unlink-section and unlink-milestone on EXISTING Board tasks, and the
// database re-checks who may do each (can_edit_task) and that the milestone,
// section and season agree.
export default function Gantt() {
  const auth = useAuth()
  const seasonId = useSeasonId()
  const milestones = useMilestones()
  const sections = useMilestoneSections(milestones.data?.map((m) => m.key))
  const tasks = useTasks()
  const progress = useTasksForProgress()
  const members = useMembers()
  const departments = useSubteams()
  const actor = useTaskActor()
  const permissions = usePermissions()
  const updateTask = useUpdateTask()
  // Date saves report their own error in the row, so they use a mutation of their own: sharing one would show the same error twice.
  const scheduleTask = useUpdateTask()
  useRealtimeTasks()
  useRealtimeTaskDependencies()
  const dependencies = useTaskDependencies()
  useRealtimeMilestones()
  useRealtimeMilestoneSections()
  const [params, setParams] = useUrlParams()

  // Collapsed to start with: the screen's first job is the submissions, and you
  // open the level you care about. What is open lives in the address (?open=,
  // ?sections=, ?task=), so it survives a refresh and a link from Milestones or
  // a Board card lands on the right group already expanded.
  const rawOpen = params.get('open')
  const openSections = useMemo(() => readSetParam(params, 'sections'), [params])
  const expandedTask = params.get('task')
  const scale: 'month' | 'week' = params.get('scale') === 'week' ? 'week' : 'month'
  const [legendOpen, setLegendOpen] = useState(false)
  const legendId = useId()
  const chartRegion = useRef<HTMLDivElement>(null)
  const writeParams = (patch: Record<string, string | null>) =>
    setParams((current) => mergeSearchParams(current, patch), { replace: true })
  // An empty set is written as '-', not left out: no ?open= means "nobody chose yet", and then the next due submission is open.
  const setOpenMilestones = (next: ReadonlySet<string>) => writeParams({ open: next.size > 0 ? writeSetParam(next) : '-' })
  const setOpenSections = (next: ReadonlySet<string>) => writeParams({ sections: writeSetParam(next) })
  const setScale = (next: 'month' | 'week') => writeParams({ scale: next === 'week' ? 'week' : null })

  // A move to ANOTHER submission changes the task's milestone and section
  // together, so it is confirmed first (the same rule LinkTaskTool follows).
  const [pendingMove, setPendingMove] = useState<{ task: Task; target: LinkTarget; label: string } | null>(null)
  const [moveNotice, setMoveNotice] = useState<string | null>(null)
  // The last unlink, kept so it can be undone: the task as it was, and where it was linked.
  const [unlinked, setUnlinked] = useState<{ task: Task; from: string } | null>(null)
  const moveTitleId = useId()

  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  // One calendar day for the whole screen, in the reader's own zone.
  const today = todayIso()
  const myId = auth.status === 'member' ? auth.member.id : null
  const milestoneRows = useMemo(() => milestones.data ?? [], [milestones.data])
  // Until somebody opens or closes something, the submission due next is open: it is what most visits are for.
  const openMilestones = useMemo<ReadonlySet<string>>(() => {
    if (rawOpen === '-') return new Set()
    if (rawOpen !== null) return readSetParam(params, 'open')
    const next = milestoneRows
      .filter((m): m is typeof m & { due_on: string } => m.due_on !== null && m.due_on >= today)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))[0]
    return new Set(next ? [next.key] : [])
  }, [rawOpen, params, milestoneRows, today])
  const sectionRows = useMemo(() => sections.data ?? [], [sections.data])
  const taskRows = useMemo(() => tasks.data ?? [], [tasks.data])
  // Falls back to the active list until the archived part has loaded.
  const progressRows = useMemo(() => (progress.data ?? taskRows) as ProgressRow[], [progress.data, taskRows])

  // The lens lives in the address, like the Board's filter, and uses the same
  // shared control, parsing and "My tasks" meaning (owner = the viewer).
  const departmentList = departments.data
  const { filter: parsedFilter, notice: parsedNotice } = useMemo(() => {
    if (!departmentList) {
      const raw = params.get('dept')
      return {
        filter: { scope: params.get('scope') === 'mine' ? ('mine' as const) : ('all' as const), department: raw ?? 'all' } satisfies TaskFilter,
        notice: null,
      }
    }
    return taskFilterFromParams(params, departmentList)
  }, [params, departmentList])
  // "My tasks" means owner = the viewer. Without a roster row it would quietly show everything under that name, so say so and show all.
  const noMember = parsedFilter.scope === 'mine' && myId === null
  const filter: TaskFilter = noMember ? { ...parsedFilter, scope: 'all' } : parsedFilter
  const notice = noMember ? 'My tasks needs a place on the roster, so all tasks are shown.' : parsedNotice
  // Merged into the address: a filter change keeps what is open and ?task=.
  const setFilter = (next: TaskFilter) => setParams((current) => applyTaskFilter(current, next), { replace: true })
  const choices = useMemo(
    () => departmentChoices(departmentList ?? [], new Set([filter.department])),
    [departmentList, filter.department],
  )
  const lensActive = !isDefaultTaskFilter(filter)
  const departmentLabel = filter.department === 'all' ? null : (choices.find((c) => c.key === filter.department)?.label ?? filter.department)
  const lensName =
    departmentLabel && filter.scope === 'mine' ? `My ${departmentLabel} tasks` : departmentLabel ? departmentLabel : filter.scope === 'mine' ? 'My tasks' : 'All tasks'
  // The Gantt shows linked tasks only, so both sets of counts are taken from them and agree with each other.
  const linked = useMemo(() => taskRows.filter((t) => t.milestone_key !== null || t.section_id !== null), [taskRows])
  const counts = useMemo(() => taskScopeCounts(linked, filter.department, myId), [linked, filter.department, myId])
  // Linked tasks each department entry would show under the current scope.
  const departmentCounts = useMemo(() => {
    const inScope = filterTasks(linked, { scope: filter.scope, department: 'all' }, myId)
    const out: Record<string, number> = { all: inScope.length }
    for (const task of inScope) if (task.subteam_key) out[task.subteam_key] = (out[task.subteam_key] ?? 0) + 1
    return out
  }, [linked, filter.scope, myId])

  const departmentNames = useMemo(() => new Map((departmentList ?? []).map((d) => [d.key, d.name])), [departmentList])
  const memberNames = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  const sectionNames = useMemo(() => new Map(sectionRows.map((s) => [s.id, s.name])), [sectionRows])

  // Everything the chart must fit: milestone windows and deadlines AND task
  // starts and ends. Only tasks that are actually linked to a submission count,
  // so a loose Board task's date does not stretch the timeline.
  const range = timelineRange(planningDates(milestoneRows, linked), today)
  const ticks = scale === 'week' ? weekTicks(range) : monthTicks(range)
  // Weeks need room to be legible; the chart already scrolls sideways.
  const chartWidth = scale === 'week' ? `${Math.max(52, ticks.length * 4.5)}rem` : '52rem'
  const todayLeft = placeDay(today, range)
  // Brings today into view: the weekly chart is wider than the screen and starts months before it.
  const jumpToToday = () =>
    chartRegion.current?.querySelector('[data-testid="gantt-today-label"] span')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  // On the weekly scale the chart opens already at today, so nobody has to hunt for it.
  useEffect(() => {
    if (scale === 'week') jumpToToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, milestoneRows.length])

  // Every place a task can be moved to, in timeline order: each section, then
  // the submission's unsectioned group.
  const moveTargets = useMemo(() => {
    const out: { key: string; label: string; target: LinkTarget }[] = []
    for (const m of milestoneRows) {
      for (const section of topLevelSections(sectionRows, m.key)) {
        const target = { seasonId: seasonId ?? '', milestoneKey: m.key, sectionId: section.id }
        out.push({ key: targetKey(target), label: `${milestoneLabel(m)} · ${section.name}`, target })
        for (const sub of subsectionsOf(sectionRows, section.id)) {
          const subTarget = { seasonId: seasonId ?? '', milestoneKey: m.key, sectionId: sub.id }
          out.push({ key: targetKey(subTarget), label: `${milestoneLabel(m)} · ${section.name} › ${sub.name}`, target: subTarget })
        }
      }
      const loose = { seasonId: seasonId ?? '', milestoneKey: m.key, sectionId: null }
      out.push({ key: targetKey(loose), label: `${milestoneLabel(m)} · no section`, target: loose })
    }
    return out
  }, [milestoneRows, sectionRows, seasonId])

  const dependencyLinks = useMemo(() => dependencies.data ?? [], [dependencies.data])
  const milestoneLabelFor = (key: string | null) => {
    const m = (milestones.data ?? []).find((candidate) => candidate.key === key)
    return m ? milestoneLabel(m) : (key ?? 'no submission')
  }
  // Prerequisites are read by name even once archived (the progress list carries the archived tasks).
  const prerequisiteLookup = useMemo(
    () => taskRefLookup(taskRows, (progress.data ?? []).filter((t) => t.archived_at !== null)),
    [taskRows, progress.data],
  )
  // A plain member — no privileged role, Head of no department — only views the
  // Gantt, even for tasks they own (they still change those on the Board).
  // Presentation only: the database keeps its own per-task rule.
  const canManage = actor !== null && (permissions.roles.length > 0 || actor.headOf.length > 0)
  const permsFor = (task: Task) => {
    if (!actor || !canManage) return { canEdit: false, canReassign: false }
    const canEdit = canEditTask(actor, task)
    return { canEdit, canReassign: canEdit && canReassignTaskOwner(actor, task) }
  }

  // A failed row action names the task it was for: the mutation keeps the edit it was given.
  const failedId = updateTask.isError ? updateTask.variables?.id : undefined
  const failedTitle = failedId ? (taskRows.find((t) => t.id === failedId)?.title ?? null) : null
  // Any action other than the unlink itself retires the Undo: re-linking after, say, a move would silently undo the move.
  const run = (edit: TaskEdit, keepUndo = false) => {
    if (!keepUndo) setUnlinked(null)
    updateTask.mutate(edit)
  }
  // Puts the task back exactly where it was (milestone and section together, like any link).
  const undoUnlink = () => {
    if (!unlinked || unlinked.task.milestone_key === null) return
    run(linkEdit(unlinked.task, { seasonId: seasonId ?? '', milestoneKey: unlinked.task.milestone_key, sectionId: unlinked.task.section_id }))
    setUnlinked(null)
  }

  const env: GanttEnv = {
    today,
    range,
    todayLeft,
    seasonId: seasonId ?? '',
    members: members.data ?? [],
    memberNames,
    departmentNames,
    sectionNames,
    canManage,
    permsFor,
    lens: {
      active: lensActive,
      name: lensName,
      matches: (t) => filterTasks([t], filter, myId).length > 0,
    },
    moveTargets,
    onMoveTo: (task, target) => {
      setMoveNotice(null)
      if (!permsFor(task).canEdit) {
        setMoveNotice(`You cannot move “${task.title}”: only its owner, its department's Head, the President or the Vice President can.`)
        return
      }
      if (targetKey(target) === currentTargetKey(task)) return
      const label = moveTargets.find((t) => t.key === targetKey(target))?.label ?? target.milestoneKey
      if (task.milestone_key !== null && task.milestone_key !== target.milestoneKey) {
        setPendingMove({ task, target, label })
        return
      }
      run(linkEdit(task, target))
    },
    onSchedule: async (task, start, due) => {
      const plan = planScheduleEdit(task, start, due)
      if (plan.kind === 'invalid') throw new Error(plan.reason)
      if (plan.kind === 'unchanged') return 'Nothing to save — the dates are the same.'
      await scheduleTask.mutateAsync(plan.edit)
      return `Saved: ${plan.changed.join(', ')}.`
    },
    expandedTask,
    onToggleTask: (taskId) => writeParams({ task: expandedTask === taskId ? null : taskId }),
    prerequisitesFor: (task) => prerequisitesOf(dependencyLinks, task.id, prerequisiteLookup),
    onMove: (taskId, state, blockedReason) => run({ id: taskId, state, ...(blockedReason ? { blockedReason } : {}) }),
    onOwner: (taskId, ownerId) => run({ id: taskId, ownerId }),
    onLink: (task, target) => run(linkEdit(task, target)),
    onUnlinkSection: (task) => {
      setUnlinked({ task, from: sectionNames.get(task.section_id ?? '') ?? 'its section' })
      run(unlinkSectionEdit(task), true)
    },
    onUnlinkMilestone: (task) => {
      setUnlinked({ task, from: milestoneLabelFor(task.milestone_key) })
      run(unlinkMilestoneEdit(task), true)
    },
  }

  const error = milestones.error ?? sections.error ?? tasks.error
  if (error) {
    return (
      <main id="main-content" tabIndex={-1} className={pageMain()}>
        <h1 className="text-xl font-semibold text-slate-900">Gantt</h1>
        <div className="mt-4">
          <ErrorState
            title="Could not load the Gantt"
            error={error}
            onRetry={() => {
              void milestones.refetch()
              void sections.refetch()
              void tasks.refetch()
            }}
          />
        </div>
      </main>
    )
  }

  // "Expand all" opens every level, sections too: a closed section is an empty-looking chart. A section row's key is its id,
  // and a submission's unsectioned group is `unsectioned:<key>` (MilestoneRow).
  // Only the groups that HAVE tasks: an empty section shows nothing but a link box, and opening all of them makes a very long page.
  // A subsection's task also opens its parent, which is where the subsection is drawn.
  const parentOf = new Map(sectionRows.map((s) => [s.id, s.parent_section_id]))
  const withTasks = new Set<string>()
  for (const t of taskRows) {
    if (t.milestone_key === null) continue
    if (t.section_id === null) withTasks.add(`unsectioned:${t.milestone_key}`)
    else {
      withTasks.add(t.section_id)
      const parent = parentOf.get(t.section_id)
      if (parent) withTasks.add(parent)
    }
  }
  const everySectionKey = [...withTasks]
  const allOpen =
    openMilestones.size === milestoneRows.length && milestoneRows.length > 0 && everySectionKey.every((key) => openSections.has(key))
  const undated = linked.filter((t) => taskMark(t, today).kind === 'undated').length
  const late = linked.filter((t) => isOverdue(t, today)).length
  const upcoming = milestoneRows
    .filter((m): m is typeof m & { due_on: string } => m.due_on !== null && m.due_on >= today)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))[0]

  return (
    <main id="main-content" tabIndex={-1} className={pageMain()}>
      <PageHeader
        title="Gantt"
        description="Every submission on one timeline. Open one to see its sections and tasks; they are the Board’s tasks, not copies."
        tutorialId="gantt-header"
      />

      <DepartmentNav choices={choices} value={filter.department} counts={departmentCounts} testId="gantt-departments" />

      {(milestones.isLoading || tasks.isLoading) && (
        <p role="status" className="mb-2 text-xs text-slate-500">Loading…</p>
      )}
      {failedTitle && (
        <p className="mb-1 text-sm font-medium text-slate-900" data-testid="gantt-failed-task">
          “{failedTitle}” was not changed.
        </p>
      )}
      <ActionError error={updateTask.error} className="mb-3" />
      {unlinked && !updateTask.isError && (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-x-2 text-sm text-slate-800" data-testid="gantt-unlinked">
          Unlinked “{unlinked.task.title}” from {unlinked.from}.
          <button
            type="button"
            onClick={undoUnlink}
            className="inline-flex min-h-11 items-center rounded px-1 font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none sm:min-h-0"
            data-testid="gantt-undo-unlink"
          >
            Undo
          </button>
        </p>
      )}
      {moveNotice && (
        <p role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="gantt-move-notice">
          {moveNotice}
        </p>
      )}

      {!milestones.isLoading && milestoneRows.length === 0 ? (
        <EmptyState title="No submissions for this season yet">
          The President or Vice President adds the submission windows in Settings →
          Milestone dates and points. They appear here as soon as they exist.
        </EmptyState>
      ) : (
        <>
          {/* The same sentences as ever, set as three short facts and one quiet note so the numbers can be found at a glance. */}
          <p className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate-600" data-testid="gantt-summary">
            <span>
              <strong className="font-semibold text-slate-900">{milestoneRows.length}</strong> submission{milestoneRows.length === 1 ? '' : 's'}.
            </span>{' '}
            <span>
              {upcoming ? (
                <>
                  Next deadline: <strong className="font-semibold text-slate-900">{milestoneLabel(upcoming)}</strong> on {formatDay(upcoming.due_on)}.
                </>
              ) : (
                'No upcoming deadline is published.'
              )}
            </span>{' '}
            <span>
              <strong className="font-semibold text-slate-900">{linked.length}</strong> linked task{linked.length === 1 ? '' : 's'}
              {linked.length > 0 && (
                <>
                  {' '}
                  ({undated} undated, <span className={late > 0 ? 'font-medium text-accent-ring' : undefined}>{late} overdue</span>)
                </>
              )}
              .
            </span>{' '}
            <span className="basis-full text-xs text-slate-500">
              Progress counts archived done work, so archiving a finished task does not lower it.
            </span>
          </p>
          {!canManage && (
            <p role="status" className="mb-2 text-xs text-slate-600" data-testid="gantt-view-only">
              View only: department Heads and role holders link, assign and reschedule tasks here.
            </p>
          )}

          {/* The department lens: the same control, scope and department as the
              Board. It filters the tasks shown while the milestone → section
              structure stays; each submission's OVERALL progress does not move. */}
          <div className="mb-4 rounded-xl border border-slate-200 bg-surface p-3" data-testid="gantt-filters">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <ScopeDepartmentFilter
                scopes={myId ? SCOPES : [SCOPES[0]]}
                scope={myId ? filter.scope : 'all'}
                onScope={(scope) => setFilter({ ...filter, scope })}
                counts={counts}
                scopeGroupLabel="Which tasks to show"
                scopeTestId="gantt-scope"
              />
              <GanttToolbar
                allOpen={allOpen}
                onToggleAll={() => {
                  setOpenMilestones(allOpen ? new Set() : new Set(milestoneRows.map((m) => m.key)))
                  setOpenSections(allOpen ? new Set() : new Set(everySectionKey))
                }}
                scale={scale}
                onScale={setScale}
                legendOpen={legendOpen}
                legendId={legendId}
                onLegend={() => setLegendOpen((open) => !open)}
                onToday={todayLeft !== null ? jumpToToday : undefined}
              />
            </div>
            {notice && (
              <p role="status" className="mt-2 text-xs text-amber-900" data-testid="gantt-filter-notice">
                {notice}
              </p>
            )}
            <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600" data-testid="gantt-lens-note">
              {lensActive
                ? `Showing ${lensName}. Each submission keeps its overall progress; the department figure beside it counts only these tasks.`
                : 'Showing every linked task. Pick a department to see one department’s work in the same structure.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Dashed line: today. Flag: a submission’s deadline. Bar: a task from its start to its deadline; dot: a task with one
              date. To reschedule, drag a bar (or either end of it) or a dot, or open the task to use the keyboard.
            </p>
          </div>
          {legendOpen && <GanttLegend id={legendId} />}

          {/* The chart keeps its proportions rather than squeezing; on a phone
              it scrolls sideways, which beats months three pixels wide. It is a
              focusable region so a keyboard user can scroll it. */}
          {/* Progress waits for the archived part of the list; drawing it from the active list alone made the percentages drop and then rise. */}
          {progress.isLoading ? (
            <p role="status" className="text-sm text-slate-600" data-testid="gantt-progress-loading">
              Loading progress…
            </p>
          ) : (
          <div
            ref={chartRegion}
            role="region"
            aria-label="Timeline, scrolls sideways"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-slate-200 bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            {/* The padding lives inside the scrolled content, so the sticky
                label column has no gap for the ruler to show through. The month
                lines behind every row come from the ruler's own ticks. */}
            <div className="min-w-[var(--gantt-min)] p-4" style={{ '--gantt-min': chartWidth, ...gridStyle(ticks) } as CSSProperties} data-tutorial="gantt-chart">
              <div className="grid grid-cols-1 items-start gap-3 border-b border-slate-200 pb-1 sm:grid-cols-[minmax(17rem,24rem)_1fr]">
                <span className="sticky left-0 z-10 flex items-end self-stretch bg-surface pr-2 text-xs font-medium text-slate-500 max-sm:hidden">
                  Submission · section · task
                </span>
                <div>
                  {/* Today gets a word as well as a line: nothing is colour-only. */}
                  <div className="relative h-6" data-testid="gantt-today-label">
                    {todayLeft !== null && (
                      <span
                        className="absolute top-0 -translate-x-1/2 rounded-full bg-accent px-2 text-xs font-semibold leading-5 text-white"
                        style={{ left: `${todayLeft}%` }}
                      >
                        Today
                      </span>
                    )}
                  </div>
                  <div className="relative h-6" data-testid="gantt-months">
                    {ticks.map((tick) => (
                      <span
                        key={tick.key}
                        className="absolute top-0 h-full truncate border-l border-slate-200 px-1.5 pt-1 text-left text-xs text-slate-500"
                        style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
                      >
                        {tick.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <ul>
                {milestoneRows.map((milestone) => (
                  <MilestoneRow
                    key={milestone.key}
                    milestone={milestone}
                    sections={sectionRows}
                    tasks={taskRows}
                    progressTasks={progressRows}
                    open={openMilestones.has(milestone.key)}
                    onToggle={() => setOpenMilestones(toggle(openMilestones, milestone.key))}
                    openSections={openSections}
                    onToggleSection={(key) => setOpenSections(toggle(openSections, key))}
                    env={env}
                  />
                ))}
              </ul>
            </div>
          </div>
          )}
        </>
      )}
      <Dialog open={pendingMove !== null} onClose={() => setPendingMove(null)} labelledBy={moveTitleId}>
        {pendingMove && (
          <div data-testid="gantt-move-confirm">
            <h2 id={moveTitleId} className="text-base font-semibold text-slate-900">
              Move to another submission?
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              “{pendingMove.task.title}” is on {milestoneLabelFor(pendingMove.task.milestone_key)}. Moving it to {pendingMove.label} changes its
              milestone and section together, in one change. It stays the same Board task, with the same owner and
              department.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonSecondary} onClick={() => setPendingMove(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonPrimary}
                onClick={() => {
                  run(linkEdit(pendingMove.task, pendingMove.target))
                  setPendingMove(null)
                }}
              >
                Move it
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  )
}
