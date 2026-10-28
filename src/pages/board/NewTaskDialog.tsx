import { useId, useMemo, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useClauses } from '../../data/useClauses.ts'
import { useCreateTask } from '../../data/useTasks.ts'
import { buildRequirementOptions } from '../../proposals/requirementOptions.ts'
import { RequirementPicker } from '../../proposals/RequirementPicker.tsx'
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from '../../tasks/priority.ts'
import type { Task, TaskPriority } from '../../tasks/types.ts'
import { Dialog } from '../../ui/Dialog.tsx'
import { buttonPrimary, buttonSecondary } from '../../ui/buttons.ts'
import { ActionError } from '../../ui/states.tsx'

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
const REQUIRED = "after:ml-0.5 after:text-accent-ring after:content-['*']"
const LABEL = 'block text-xs font-medium text-slate-700'
const SECTION_HEADING = 'text-[11px] font-semibold tracking-wide text-slate-500 uppercase'

type Errors = { title?: string; start?: string; due?: string }

// A new task, made straight on the Board by a task leader (create_task). It is laid out
// like the task overlay, in the same order: what it is, who and when, linked work,
// department. A title and a deadline are needed. The milestone and the
// requirements are optional: they can be added later on the task (when both are given
// the task keeps them, like a promoted one).
export function NewTaskDialog({
  open,
  onClose,
  onCreated,
  departments,
  owners,
  milestones,
  viewerId,
  defaultDepartment,
}: {
  open: boolean
  onClose: () => void
  onCreated: (task: Task) => void
  departments: { key: string; name: string }[]
  owners: { id: string; name: string }[]
  milestones: { value: string; label: string }[]
  viewerId: string | null
  // The department the Board is filtered to, when it is one.
  defaultDepartment: string
}) {
  const titleId = useId()
  const create = useCreateTask()
  const clauses = useClauses()
  const options = useMemo(() => buildRequirementOptions(clauses.data ?? []), [clauses.data])
  const close = () => {
    create.reset()
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} labelledBy={titleId} dismissible={!create.isPending}>
      <Form
        // Remounted each time it opens, so a reopened dialog never shows the last half-typed task.
        key={String(open)}
        titleId={titleId}
        departments={departments}
        owners={owners}
        milestones={milestones}
        options={options}
        viewerId={viewerId}
        defaultDepartment={defaultDepartment}
        pending={create.isPending}
        error={create.error}
        onCancel={close}
        onSubmit={async (task) => {
          try {
            const made = await create.mutateAsync(task)
            create.reset()
            onCreated(made)
          } catch {
            // Shown by ActionError; the dialog stays open with what was typed.
          }
        }}
      />
    </Dialog>
  )
}

function Form({
  titleId,
  departments,
  owners,
  milestones,
  options,
  viewerId,
  defaultDepartment,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  titleId: string
  departments: { key: string; name: string }[]
  owners: { id: string; name: string }[]
  milestones: { value: string; label: string }[]
  options: ReturnType<typeof buildRequirementOptions>
  viewerId: string | null
  defaultDepartment: string
  pending: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (task: Parameters<ReturnType<typeof useCreateTask>['mutateAsync']>[0]) => void
}) {
  const fid = (n: string) => `${titleId}-${n}`
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [owner, setOwner] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [milestone, setMilestone] = useState('')
  const [keys, setKeys] = useState<string[]>([])
  const [department, setDepartment] = useState(departments.some((d) => d.key === defaultDepartment) ? defaultDepartment : '')
  const [errors, setErrors] = useState<Errors>({})

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const found: Errors = {}
    if (title.trim() === '') found.title = 'Give the task a name.'
    if (due === '') found.due = 'Give the task a deadline.'
    else if (start !== '' && start > due) found.due = 'The deadline cannot be before the start date.'
    const first = found.title ? 'title' : found.due ? 'due' : null
    if (first) {
      // Render the messages before moving focus, or focus lands on a field whose error is not painted yet.
      flushSync(() => setErrors(found))
      document.getElementById(fid(first))?.focus()
      return
    }
    setErrors({})
    onSubmit({
      title: title.trim(),
      detail: detail.trim() || null,
      departmentKey: department || null,
      ownerId: owner || null,
      startsOn: start || null,
      dueDate: due,
      milestoneKey: milestone || null,
      clauseKeys: keys,
      priority,
    })
  }

  const mine = viewerId ? owners.find((o) => o.id === viewerId) : undefined
  const ordered = [...(mine ? [mine] : []), ...owners.filter((o) => o.id !== viewerId)]
  const err = (id: string, message?: string) =>
    message ? (
      <p id={fid(`${id}-error`)} className="mt-1 text-xs text-red-700">
        {message}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-testid="new-task-form">
      <h2 id={titleId} className="text-base font-semibold text-balance text-slate-900">
        New task
      </h2>
      <p className="text-xs text-slate-600">Made directly, without a proposal. It starts in To do.</p>

      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">New task</legend>
        <div className="sm:col-span-2">
          <label htmlFor={fid('title')} className={`${LABEL} ${REQUIRED}`}>
            Title
          </label>
          <input
            id={fid('title')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? fid('title-error') : undefined}
            className={FIELD}
          />
          {err('title', errors.title)}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('detail')} className={LABEL}>
            Description (optional)
          </label>
          <textarea id={fid('detail')} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor={fid('owner')} className={LABEL}>
            Owner
          </label>
          <select id={fid('owner')} value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD}>
            <option value="">Unassigned</option>
            {ordered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id === viewerId ? `Me (${o.name})` : o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('priority')} className={LABEL}>
            Priority
          </label>
          <select id={fid('priority')} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={FIELD}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('start')} className={LABEL}>
            Start date
          </label>
          <input
            id={fid('start')}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-invalid={errors.start ? true : undefined}
            aria-describedby={errors.start ? fid('start-error') : undefined}
            className={FIELD}
          />
          {err('start', errors.start)}
        </div>
        <div>
          <label htmlFor={fid('due')} className={`${LABEL} ${REQUIRED}`}>
            Deadline
          </label>
          <input
            id={fid('due')}
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-invalid={errors.due ? true : undefined}
            aria-describedby={errors.due ? fid('due-error') : undefined}
            className={FIELD}
          />
          {err('due', errors.due)}
        </div>

        <div className="sm:col-span-2 border-t border-slate-100 pt-2">
          <h3 className={SECTION_HEADING}>Linked work (optional)</h3>
          <p className="mt-0.5 text-xs text-slate-600">You can add these later, on the task.</p>
          <div className="mt-1 space-y-3">
            <div>
              <label htmlFor={fid('milestone')} className={LABEL}>
                Milestone
              </label>
              <select
                id={fid('milestone')}
                value={milestone}
                onChange={(e) => setMilestone(e.target.value)}
                className={FIELD}
              >
                <option value="">No milestone yet</option>
                {milestones.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div role="group" aria-labelledby={fid('req')}>
              <p id={fid('req')} className={LABEL}>
                Requirements
              </p>
              <RequirementPicker
                id={fid('reqpick')}
                options={options}
                selected={keys}
                onChange={setKeys}
                disabled={pending}
              />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2 border-t border-slate-100 pt-2">
          <label htmlFor={fid('department')} className={LABEL}>
            Department
          </label>
          <select
            id={fid('department')}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={FIELD}
          >
            <option value="">No department yet</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <ActionError error={error} />

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 border-t border-slate-100 bg-surface px-1 py-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonSecondary} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={pending} data-testid="new-task-submit">
          {pending ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </form>
  )
}
