import { useId, useMemo, useState } from 'react'

export const MAX_ASSIGNEES = 20 // the same cap set_task_assignees enforces

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'

// Who a task is assigned to: a search box over a checklist of people. Ticking adds, unticking removes;
// the order they were ticked in is kept, because the first one is the task's lead (the database keeps the
// current lead while they stay ticked, otherwise the first listed). The search only narrows what is shown:
// a ticked person who does not match stays ticked, and the count says so.
export function AssigneePicker({
  label,
  people,
  value,
  onChange,
  viewerId,
  disabled,
}: {
  label: string
  people: readonly { id: string; name: string }[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  viewerId?: string | null
  disabled?: boolean
}) {
  const uid = useId()
  const [query, setQuery] = useState('')
  const ordered = useMemo(
    () => [...people.filter((p) => p.id === viewerId), ...people.filter((p) => p.id !== viewerId)],
    [people, viewerId],
  )
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return ordered.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
  }, [ordered, query])
  const full = value.length >= MAX_ASSIGNEES
  const hidden = value.filter((id) => !shown.some((p) => p.id === id)).length

  const toggle = (id: string, on: boolean) => onChange(on ? [...value.filter((v) => v !== id), id] : value.filter((v) => v !== id))

  return (
    <fieldset disabled={disabled} className="min-w-0" data-testid="assignee-picker">
      <legend className="text-xs font-medium text-slate-700">{label}</legend>
      <label htmlFor={`${uid}-search`} className="sr-only">
        Search people
      </label>
      <input
        id={`${uid}-search`}
        type="search"
        autoComplete="off"
        value={query}
        placeholder="Search people"
        onChange={(e) => setQuery(e.target.value)}
        // Never submit the form this sits in.
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault()
        }}
        className={FIELD}
      />
      <p className="mt-1 text-xs text-slate-600" role="status" data-testid="assignee-count">
        {value.length === 0 ? 'Nobody assigned.' : `${value.length} assigned`}
        {hidden > 0 ? ` (${hidden} not in this search)` : ''}
        {full ? ` — the most a task can have is ${MAX_ASSIGNEES}.` : ''}
      </p>
      {shown.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">No one matches “{query.trim()}”.</p>
      ) : (
        <ul className="mt-1 max-h-56 divide-y divide-slate-100 overflow-auto rounded border border-slate-200">
          {shown.map((p) => {
            const checked = value.includes(p.id)
            return (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 py-1 text-sm text-slate-900 sm:min-h-0 sm:py-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    className="size-4"
                  />
                  <span>
                    {p.id === viewerId ? `Me (${p.name})` : p.name}
                    {checked && value[0] === p.id && value.length > 1 ? <span className="text-slate-600"> — lead</span> : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}
