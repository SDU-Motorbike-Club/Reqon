import { useEffect, useState } from 'react'
import { useAddTaskDependency } from '../../data/useTaskDependencies.ts'
import { TASK_STATES } from '../../tasks/taskState.ts'
import type { Task, TaskState } from '../../tasks/types.ts'
import { BlockReasonForm } from './BlockReasonForm.tsx'
import type { TaskLinksView } from './TaskDetails.tsx'

// Moving a task to another lane with a <select> (the keyboard, screen-reader and
// phone way; the Board also lets a card be dragged onto a lane). Blocking needs
// an explanation — a written reason, or a prerequisite task — so with neither it
// asks first instead of sending a move the database would refuse. The ask offers
// a search for the blocking task: choosing it links it as a prerequisite, then
// blocks. Used on the card and again in the task's details dialog, so a task opened
// from a link can be moved without closing the dialog. `idPrefix` keeps the two
// instances' ids apart.
export function MoveControl({
  task,
  openPrerequisites,
  moving,
  onMove,
  idPrefix = 'task-state',
  testIdPrefix = 'task-block-form',
  visibleLabel,
  links,
  askBlock,
  onAskBlockDone,
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
  // Where the blocking task is searched; without it the ask is the reason alone.
  links?: TaskLinksView
  // A drop on Blocked asks for the reason from outside the select: open the ask, then say it was opened.
  askBlock?: boolean
  onAskBlockDone?: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const addDependency = useAddTaskDependency()
  const selectId = `${idPrefix}-${task.id}`
  useEffect(() => {
    if (!askBlock) return
    setAsking(true)
    onAskBlockDone?.()
  }, [askBlock, onAskBlockDone])
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
          busy={moving || addDependency.isPending}
          blockers={links ? { candidates: links.candidates(), departmentName: links.departmentName } : undefined}
          error={saveError}
          onBlock={(reason, blockedBy) => {
            setSaveError(null)
            if (!blockedBy) {
              onMove(task.id, 'blocked', reason)
              setAsking(false)
              return
            }
            // The chosen task becomes a prerequisite first, which is what lets the database accept Blocked.
            addDependency.mutate(
              { taskId: task.id, dependsOnTaskId: blockedBy },
              {
                onSuccess: () => {
                  onMove(task.id, 'blocked', reason || undefined)
                  setAsking(false)
                },
                onError: (e) => setSaveError(e.message),
              },
            )
          }}
          onCancel={() => {
            setSaveError(null)
            setAsking(false)
          }}
        />
      )}
    </>
  )
}
