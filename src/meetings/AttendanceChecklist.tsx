import { useId } from 'react'

export type Person = { id: string; name: string }

// Who came, as a tick list of the members instead of a line of names to type. The ids are what is stored
// (set_meeting_attendees), so a renamed member is still the same person on an old meeting.
export function AttendanceChecklist({
  people,
  present,
  onChange,
  disabled = false,
}: {
  people: readonly Person[]
  present: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const id = useId()
  const toggle = (personId: string) => {
    const next = new Set(present)
    if (next.has(personId)) next.delete(personId)
    else next.add(personId)
    onChange(next)
  }
  const small =
    'min-h-11 rounded px-2 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50 sm:min-h-0 sm:py-0.5'

  return (
    <fieldset disabled={disabled} className="min-w-0" data-testid="attendance-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-xs font-medium text-slate-600">Who came (optional)</legend>
        <span className="flex items-center gap-1 text-xs text-slate-600">
          <span aria-live="polite" data-testid="attendance-count">
            {present.size} of {people.length} came
          </span>
          <button type="button" className={small} onClick={() => onChange(new Set(people.map((p) => p.id)))}>
            All
          </button>
          <button type="button" className={small} onClick={() => onChange(new Set())}>
            None
          </button>
        </span>
      </div>
      {people.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">There is nobody on the roster to tick.</p>
      ) : (
        <ul className="mt-1 grid gap-x-3 gap-y-0.5 rounded border border-slate-300 p-2 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <li key={person.id}>
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-900 sm:min-h-0 sm:py-0.5" htmlFor={`${id}-${person.id}`}>
                <input
                  id={`${id}-${person.id}`}
                  type="checkbox"
                  checked={present.has(person.id)}
                  onChange={() => toggle(person.id)}
                  className="size-4 shrink-0 rounded border-slate-400"
                />
                <span className="min-w-0 break-words">{person.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
