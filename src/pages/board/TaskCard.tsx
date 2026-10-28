import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { formatDay } from '../../lib/dates.ts'
import { isUrgent, TASK_PRIORITY_BADGE_TONE, TASK_PRIORITY_LABEL } from '../../tasks/priority.ts'
import type { Task, TaskState } from '../../tasks/types.ts'
import { openPrerequisites } from '../../tasks/dependencies.ts'
import { isOverdue } from './boardModel.ts'
import type { TaskLinksView, TaskPermissions } from './TaskDetails.tsx'
import { MoveControl } from './MoveControl.tsx'

type Props = {
  task: Task
  departmentName: string | null
  ownerName: string | null
  milestoneLabel: string | null
  requirementKeys: string[]
  source: { id: string; title: string } | null
  perms: TaskPermissions
  moving: boolean
  today: string
  onMove: (id: string, state: TaskState, blockedReason?: string) => void
  // Prerequisite links, for the blocker line.
  links?: TaskLinksView
  tutorial: boolean
  // Arrived by a link naming this task: bring it into view (the Board opens its details).
  focused?: boolean
  // The details and editor open in a dialog the Board owns, so they stay open
  // while the card changes lane.
  detailsOpen: boolean
  onOpenDetails: () => void
}

// A missing (legacy) value is shown as missing, in muted italics, never filled
// in with something plausible.
function Missing({ children }: { children: string }) {
  return <span className="text-slate-500 italic">{children}</span>
}

// One compact card: title, priority badge, department, owner, deadline,
// milestone and requirement count (the lane already says its state); longer text
// and the editor open from Details. Movement is a <select> (no drag and drop:
// unusable by keyboard, awkward on a phone), offered only to someone who may move the task.
export function TaskCard(props: Props) {
  const { task, perms } = props
  const cardRef = useRef<HTMLLIElement>(null)
  const focused = Boolean(props.focused)
  useEffect(() => {
    if (!focused) return
    cardRef.current?.scrollIntoView?.({ block: 'center' })
    cardRef.current?.focus({ preventScroll: true })
  }, [focused])
  const overdue = isOverdue(task, props.today)
  const prerequisites = props.links?.prerequisites ?? []
  const openCount = openPrerequisites(prerequisites).length
  const reqCount = props.requirementKeys.length

  return (
    <li
      ref={cardRef}
      tabIndex={focused ? -1 : undefined}
      className={`pc-lift rounded border bg-surface p-2 ${focused ? 'border-slate-900 ring-2 ring-slate-400' : 'border-slate-200'}`}
      data-testid={`task-${task.id}`}
      data-task-state={task.state}
      data-source-proposal={task.source_proposal ?? ''}
      data-tutorial={props.tutorial ? 'board-card' : undefined}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
        {task.title}
        {isUrgent(task.priority) && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${TASK_PRIORITY_BADGE_TONE.urgent}`}>
            {TASK_PRIORITY_LABEL.urgent}
          </span>
        )}
      </p>

      <dl className="mt-1 space-y-0.5 text-xs text-slate-700" data-testid={`task-facts-${task.id}`}>
        <div className="flex flex-wrap gap-x-2">
          <dt className="sr-only">Owner</dt>
          <dd className="font-medium">{props.ownerName ?? <Missing>Unassigned</Missing>}</dd>
          <dt className="sr-only">Department</dt>
          <dd className="min-w-0 truncate">{props.departmentName ?? <Missing>No department</Missing>}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="sr-only">Deadline</dt>
          <dd className={overdue ? 'font-semibold text-red-700' : undefined}>
            {task.due_date ? `${overdue ? '! ' : ''}Due ${formatDay(task.due_date)}${overdue ? ' · overdue' : ''}` : <Missing>No deadline</Missing>}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-slate-600">
          <dt className="sr-only">Milestone</dt>
          <dd>{props.milestoneLabel ?? <Missing>No milestone</Missing>}</dd>
          <dt className="sr-only">Requirements</dt>
          <dd data-testid={`task-reqs-${task.id}`}>
            {reqCount > 0 ? `${reqCount} ${reqCount === 1 ? 'requirement' : 'requirements'}` : <Missing>No requirements linked</Missing>}
          </dd>
        </div>
      </dl>

      {/* The blocker is its own line, apart from the description: the written
          reason, or the task(s) it waits for. A task blocked before reasons were
          kept says so instead of inventing one. */}
      {task.state === 'blocked' && (
        <p className="mt-1 rounded border-l-4 border-amber-500 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-950" data-testid={`task-blocked-${task.id}`}>
          <span className="font-semibold">Blocked</span> ·{' '}
          {task.blocked_reason
            ? task.blocked_reason
            : openCount > 0
              ? `waiting for ${openCount} ${openCount === 1 ? 'task' : 'tasks'}`
              : 'no reason recorded'}
        </p>
      )}
      {task.state !== 'blocked' && prerequisites.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-600" data-testid={`task-waits-${task.id}`}>
          Waits for {prerequisites.length} {prerequisites.length === 1 ? 'task' : 'tasks'}
          {openCount > 0 ? ` (${openCount} not finished)` : ' (all finished)'}
        </p>
      )}

      {props.source && (
        <p className="mt-1 text-[11px] text-slate-500" data-testid={`task-origin-${task.id}`}>
          From proposal:{' '}
          <Link to={`/archive?tab=proposals&id=${props.source.id}`} className="underline underline-offset-2">
            “{props.source.title}”
          </Link>
        </p>
      )}

      {perms.canEdit && (
        <div className="mt-2">
          <MoveControl task={task} openPrerequisites={openCount} moving={props.moving} onMove={props.onMove} />
        </div>
      )}

      <button
        type="button"
        id={`task-open-${task.id}`}
        aria-haspopup="dialog"
        aria-expanded={props.detailsOpen}
        onClick={props.onOpenDetails}
        className="mt-2 inline-flex min-h-11 items-center rounded text-xs font-medium text-slate-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none sm:min-h-0"
        data-testid={`task-more-${task.id}`}
      >
        {perms.canEdit ? 'Details and edit' : 'Details'}
      </button>
    </li>
  )
}
