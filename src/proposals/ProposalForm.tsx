import { useId, useRef, useState, type FormEvent } from 'react'
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from '../tasks/priority.ts'
import type { TaskPriority } from '../tasks/types.ts'
import { RequirementPicker } from './RequirementPicker.tsx'
import type { RequirementOption } from './requirementOptions.ts'
import {
  MAX_TITLE_LENGTH,
  PROBLEM_MESSAGE,
  submissionProblems,
  type NewProposal,
  type SubmissionProblem,
} from './submission.ts'

export type Option = { value: string; label: string }

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-[invalid=true]:border-red-600 sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-700'

// The proposal form (ADR-0005): Title*, Description, Department*, Proposed owner,
// Deadline*, Priority, Related requirements, Related milestone. Only what is
// marked * is mandatory and the database refuses an incomplete proposal on every
// path; this form only says WHAT is missing, next to the field and in a summary,
// before a round trip. It never picks a deadline for anyone, keeps what was
// typed when a submit fails, and cannot be submitted twice while one is pending.
// Department and milestone start from a suggestion (the department in view or the
// viewer's own, the next milestone due) that the person can change.
export function ProposalForm({
  departments,
  milestones,
  owners,
  requirements,
  onRaise,
  pending,
  loading = false,
  loadError = null,
  defaultDepartment = '',
  defaultMilestone = '',
}: {
  departments: Option[]
  milestones: Option[]
  owners: Option[]
  requirements: RequirementOption[]
  onRaise: (proposal: NewProposal) => Promise<void>
  pending: boolean
  // Suggested starting values; only used while the person has not chosen one.
  // Ignored when not among the options offered.
  defaultDepartment?: string
  defaultMilestone?: string
  // Whether the viewer may open Settings to set up what is missing (President,
  // Vice President or Developer). Never a reason to show the form to anyone.
  canConfigure: boolean
  // While the departments, milestones and requirements are still loading, or
  // failed to load, say so: an empty list that is merely not here YET must not be
  // reported as "there is nothing to choose from".
  loading?: boolean
  loadError?: string | null
}) {
  const uid = useId()
  const fid = (name: string) => `${uid}-${name}`
  const summaryRef = useRef<HTMLDivElement>(null)
  // A ref, not state: two clicks in the same tick both see the state as "idle".
  const inFlight = useRef(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // null = not chosen yet, so the suggestion shows (and follows it while it changes).
  const [pickedDepartment, setDepartmentKey] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [pickedMilestone, setMilestoneKey] = useState<string | null>(null)
  const departmentKey = pickedDepartment ?? (departments.some((d) => d.value === defaultDepartment) ? defaultDepartment : '')
  const milestoneKey = pickedMilestone ?? (milestones.some((m) => m.value === defaultMilestone) ? defaultMilestone : '')
  const [requirementKeys, setRequirementKeys] = useState<string[]>([])
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [justRaised, setJustRaised] = useState(false)

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert" data-testid="proposal-load-error">
        <h3 className="text-sm font-semibold text-red-900">Raise a proposal</h3>
        <p className="mt-1 text-sm text-red-900">The choices for a proposal could not be loaded: {loadError}. Reload the page to try again.</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-surface p-3" role="status" data-testid="proposal-loading">
        <h3 className="text-sm font-semibold text-slate-900">Raise a proposal</h3>
        <p className="mt-1 text-sm text-slate-600">Loading departments, milestones and requirements…</p>
      </div>
    )
  }
  const draft: Partial<NewProposal> = { title, departmentKey, dueDate, milestoneKey, requirementKeys }
  const problems = submissionProblems(draft)
  const fieldId: Record<SubmissionProblem, string> = {
    title: fid('title'),
    dueDate: fid('due'),
  }
  const shown = (p: SubmissionProblem) => attempted && problems.includes(p)
  const errorId = (p: SubmissionProblem) => `${fid(p)}-error`
  const describe = (p: SubmissionProblem, hint?: string) =>
    [shown(p) ? errorId(p) : null, hint ?? null].filter(Boolean).join(' ') || undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // A repeat submit while one is in flight, or before the last answer came
    // back, must not raise a second proposal.
    if (pending || inFlight.current) return
    setAttempted(true)
    setServerError(null)
    if (problems.length > 0) {
      // Move focus to the summary so a keyboard or screen-reader user hears it.
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }
    inFlight.current = true
    try {
      await onRaise({
        title: title.trim(),
        description: description.trim() || null,
        departmentKey,
        dueDate,
        milestoneKey,
        requirementKeys,
        priority,
        ownerId: ownerId || null,
      })
    } catch (error) {
      // Keep everything that was typed; say what went wrong.
      setServerError(error instanceof Error ? error.message : 'The proposal could not be raised.')
      return
    } finally {
      inFlight.current = false
    }
    setTitle('')
    setDescription('')
    setDepartmentKey(null)
    setOwnerId('')
    setDueDate('')
    setPriority('normal')
    setMilestoneKey(null)
    setRequirementKeys([])
    setAttempted(false)
    setJustRaised(true)
  }

  const fieldError = (p: SubmissionProblem) =>
    shown(p) ? (
      <p id={errorId(p)} className="mt-1 text-xs font-medium text-red-700" data-testid={`error-${p}`}>
        {PROBLEM_MESSAGE[p]}
      </p>
    ) : null

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={fid('heading')}
      className="rounded-lg border border-slate-200 bg-surface p-3"
     
    >
      <h3 id={fid('heading')} className="text-sm font-semibold text-slate-900">
        Raise a proposal
      </h3>
      <p className="mt-0.5 text-xs text-slate-600">Fields marked * are required.</p>

      {attempted && problems.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          data-testid="proposal-summary"
          className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
        >
          <p className="font-medium">
            {problems.length === 1 ? 'One thing needs fixing' : `${problems.length} things need fixing`} before this can be raised:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>
                <a
                  href={`#${fieldId[p]}`}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(fieldId[p])?.focus()
                  }}
                  className="underline underline-offset-2"
                >
                  {PROBLEM_MESSAGE[p]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={pending} className="mt-2 grid gap-3">
        <legend className="sr-only">Proposal details</legend>

        <div>
          <label htmlFor={fid('title')} className={LABEL}>
            Title <span aria-hidden="true">*</span>
          </label>
          <input
            id={fid('title')}
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            aria-required="true"
            aria-invalid={shown('title') || undefined}
            aria-describedby={describe('title')}
            onChange={(e) => {
              setTitle(e.target.value)
              setJustRaised(false)
            }}
            placeholder="What needs deciding?"
            className={FIELD}
          />
          {fieldError('title')}
        </div>

        <div>
          <label htmlFor={fid('description')} className={LABEL}>
            Description (optional)
          </label>
          <textarea
            id={fid('description')}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why it matters, or the rule it relates to"
            className={FIELD}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('department')} className={LABEL}>
              Department
            </label>
            <select
              id={fid('department')}
              value={departmentKey}
              onChange={(e) => setDepartmentKey(e.target.value)}
              className={FIELD}
            >
              <option value="">No department yet</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fid('owner')} className={LABEL}>
              Proposed owner (optional)
            </label>
            <select id={fid('owner')} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={FIELD}>
              <option value="">Nobody yet</option>
              {owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fid('due')} className={LABEL}>
              Deadline <span aria-hidden="true">*</span>
            </label>
            <input
              id={fid('due')}
              type="date"
              value={dueDate}
              aria-required="true"
              aria-invalid={shown('dueDate') || undefined}
              aria-describedby={describe('dueDate')}
              onChange={(e) => setDueDate(e.target.value)}
              className={FIELD}
            />
            {fieldError('dueDate')}
          </div>

          <div>
            <label htmlFor={fid('priority')} className={LABEL}>
              Priority
            </label>
            <select
              id={fid('priority')}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={FIELD}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={fid('milestone')} className={LABEL}>
              Related milestone
            </label>
            <select
              id={fid('milestone')}
              value={milestoneKey}
              onChange={(e) => setMilestoneKey(e.target.value)}
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
        </div>

        <div role="group" aria-labelledby={fid('requirements-label')}>
          <p id={fid('requirements-label')} className={LABEL}>
            Related requirements
          </p>
          <RequirementPicker
            id={fid('requirement')}
            options={requirements}
            selected={requirementKeys}
            onChange={setRequirementKeys}
            disabled={pending}
          />
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          aria-disabled={pending}
          className="min-h-11 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-disabled:opacity-60 sm:min-h-0"
        >
          {pending ? 'Raising…' : 'Raise proposal'}
        </button>
        {justRaised && !pending && !serverError && (
          <span role="status" className="pc-fade-in text-sm text-green-700">
            Proposal raised.
          </span>
        )}
      </div>
      {serverError && (
        <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" data-testid="proposal-server-error">
          {serverError} Everything you entered is still here — fix it or try again.
        </p>
      )}
    </form>
  )
}
