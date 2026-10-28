import { useId } from 'react'

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-700'
export const MAX_DEPARTMENT_REASON = 500
// A task's FIRST department needs no reason from the person: the command still
// records one, so the history says what happened.
export const FIRST_ASSIGNMENT_REASON = 'Department assigned'

// Which department a task belongs to is not part of the ordinary field edit: it is
// its own command (set_task_department), with a reason the audit trail keeps. It is
// chosen here and SAVED with "Save details" (TaskDetails runs the command), so there
// is one Save for everything on the panel. Shown only to someone the database would
// let move THIS task (taskDepartmentTargets): the President, Vice President or a
// Developer, or a Head between departments they head.
export function DepartmentMove(props: {
  taskId: string
  currentName: string | null
  targets: { key: string; name: string }[]
  // The department picked (a key, or '' for none) and the reason typed; both are held by
  // TaskDetails, so Save details can send them.
  value: string
  reason: string
  onValue: (key: string) => void
  onReason: (reason: string) => void
  disabled?: boolean
}) {
  const uid = useId()
  const firstTime = props.currentName === null
  const chosen = props.targets.some((d) => d.key === props.value) ? props.value : ''

  return (
    <section className="border-t border-slate-100 pt-2" aria-labelledby={`${uid}-h`} data-testid={`task-department-${props.taskId}`}>
      <h4 id={`${uid}-h`} className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        Department
      </h4>
      <p className="mt-0.5 text-sm text-slate-700">{props.currentName ?? 'No department yet.'}</p>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-to`} className={LABEL}>
            {firstTime ? 'Give it a department' : 'Move to'}
          </label>
          <select id={`${uid}-to`} value={chosen} onChange={(e) => props.onValue(e.target.value)} className={FIELD} disabled={props.disabled}>
            <option value="">{firstTime ? 'Choose a department…' : 'Keep the current department'}</option>
            {props.targets.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-why`} className={LABEL}>
            {firstTime ? 'Why? (optional, kept in the history)' : 'Why? (required to move, kept in the history)'}
          </label>
          <input
            id={`${uid}-why`}
            value={props.reason}
            maxLength={MAX_DEPARTMENT_REASON}
            onChange={(e) => props.onReason(e.target.value)}
            className={FIELD}
            disabled={props.disabled}
          />
        </div>
      </div>
      {chosen !== '' && (
        <p className="mt-1 text-xs text-slate-600" data-testid={`task-department-pending-${props.taskId}`}>
          {firstTime ? 'It gets this department when you press Save details.' : 'It moves when you press Save details.'}
        </p>
      )}
    </section>
  )
}
