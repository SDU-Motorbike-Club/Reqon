import { useId } from 'react'
import { useSetTaskParent } from '../../data/useTaskParent.ts'
import { useTasks } from '../../data/useTasks.ts'
import type { Task } from '../../tasks/types.ts'
import { ActionError } from '../../ui/states.tsx'

const LABEL = 'block text-xs font-medium text-slate-700'
const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'

// "Part of": the parent task this one belongs to. Saves when changed (the select is its own small edit,
// kept out of the main form so its rules stay in the database). Tasks nest one level only, so a task with
// subtasks of its own cannot become a subtask, and only top-level tasks are offered as parents.
export function ParentSelect({ task }: { task: Pick<Task, 'id' | 'parent_id'> }) {
  const id = useId()
  const tasks = useTasks()
  const setParent = useSetTaskParent()
  const all = tasks.data ?? []
  const hasSubtasks = all.some((t) => t.parent_id === task.id)
  const candidates = all
    .filter((t) => t.parent_id === null && t.id !== task.id)
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        Part of
      </label>
      <select
        id={id}
        value={task.parent_id ?? ''}
        disabled={hasSubtasks || setParent.isPending}
        onChange={(e) => setParent.mutate({ id: task.id, parentId: e.target.value || null })}
        className={FIELD}
      >
        <option value="">Not part of another task</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      {hasSubtasks && <p className="mt-1 text-xs text-slate-600">This task has subtasks, so it cannot be part of another task.</p>}
      {setParent.error && <ActionError error={setParent.error} />}
    </div>
  )
}
