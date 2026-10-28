import { useState } from 'react'
import { TASK_STATES } from '../../tasks/taskState.ts'
import type { Task, TaskState } from '../../tasks/types.ts'
import { BlockReasonForm } from './BlockReasonForm.tsx'

// Moving a task to another lane: a <select> (no drag and drop: unusable by
// keyboard, awkward on a phone). Blocking needs an explanation — a written
// reason, or a prerequisite task — so with neither it asks for the reason
// first instead of sending a move the database would refuse. Used on the card
// and again in the task's details dialog, so a task opened from a link can be
// moved without closing the dialog. `idPrefix` keeps the two instances' ids apart.
export function MoveControl({
  task,
  openPrerequisites,
  moving,
  onMove,
  idPrefix = 'task-state',
  testIdPrefix = 'task-block-form',
  visibleLabel,
}: {
  task: Pick<Task, 'id' | 'title' | 'state'>
  // Unfinished prerequisite tasks: one already explains a block.
  openPrerequisites: number
  moving: boolean
  onMove: (id: string, state: TaskState, blockedReason?: string) => void
  idPrefix?: string
  testIdPrefix?: string
  // Shown above the select; without it the label is for screen readers only.
  visibleLabel?: string
}) {
  const [asking, setAsking] = useState(false)
  const selectId = `${idPrefix}-${task.id}`
  return (
    <>
      <label className={visibleLabel ? 'block text-xs font-medium text-slate-700' : 'sr-only'} htmlFor={selectId}>
        {visibleLabel ?? `Move ${task.title} to another lane`}
      </label>
      <select
        id={selectId}
        value={task.state}
        disabled={moving}
        onChange={(e) => {
          const next = e.target.value as TaskState
          if (next === 'blocked' && task.state !== 'blocked' && openPrerequisites === 0) {
            setAsking(true)
            return
          }
          setAsking(false)
          onMove(task.id, next)
        }}
        className={`${visibleLabel ? 'mt-1 ' : ''}min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-60 sm:min-h-0`}
      >
        {TASK_STATES.map((l) => (
          <option key={l.state} value={l.state}>
            {l.label}
          </option>
        ))}
      </select>
      {asking && (
        <BlockReasonForm
          taskTitle={task.title}
          fieldId={`${idPrefix === 'task-state' ? 'task' : idPrefix}-block-reason-${task.id}`}
          testId={`${testIdPrefix}-${task.id}`}
          returnFocusId={selectId}
          busy={moving}
          onBlock={(reason) => {
            onMove(task.id, 'blocked', reason)
            setAsking(false)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
