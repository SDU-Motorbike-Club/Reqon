import { useId, useMemo, useState, type KeyboardEvent } from 'react'

export type Person = { id: string; name: string }

const SHOWN = 8

// Who didn't come: search the roster, add the people who were away to a list, and everyone else counts as having
// come. Far fewer taps than ticking a whole roster when most people were there. What is stored is still who WAS
// present (set_meeting_attendees, by id, so a renamed member is still the same person on an old meeting).
//
// `recorded` is false for a meeting nobody has said anything about yet (a new or planned one): then nothing is
// claimed, the count says so, and adding the first absentee, or "Everyone came", is what records it.
export function AttendanceChecklist({
  people,
  present,
  recorded,
  onChange,
  disabled = false,
}: {
  people: readonly Person[]
  // Ids present at the meeting; only meaningful when `recorded`.
  present: ReadonlySet<string>
  recorded: boolean
  onChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const absent = useMemo(() => (recorded ? people.filter((p) => !present.has(p.id)) : []), [people, present, recorded])
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return people.filter((p) => (!recorded || present.has(p.id)) && p.name.toLocaleLowerCase().includes(q))
  }, [people, present, recorded, query])
  const shown = matches.slice(0, SHOWN)

  const markAbsent = (personId: string) => {
    // The first absentee records the meeting: everyone else is taken as having come.
    const next = new Set(recorded ? present : people.map((p) => p.id))
    next.delete(personId)
    onChange(next)
    setQuery('')
    setActive(0)
  }
  const markPresent = (personId: string) => onChange(new Set(present).add(personId))

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else if (shown.length > 0) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length)
    } else if (event.key === 'Enter') {
      // Pick, and never submit the meeting form this sits in.
      event.preventDefault()
      if (open && shown[active]) markAbsent(shown[active].id)
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  const small =
    'min-h-11 rounded px-2 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50 sm:min-h-0 sm:py-0.5'

  return (
    <fieldset disabled={disabled} className="min-w-0" data-testid="attendance-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-xs font-medium text-slate-600">Who didn’t come (optional)</legend>
        <span className="flex items-center gap-1 text-xs text-slate-600">
          <span aria-live="polite" data-testid="attendance-count">
            {recorded ? `${present.size} of ${people.length} came` : 'Not recorded yet'}
          </span>
          <button type="button" className={small} onClick={() => onChange(new Set(people.map((p) => p.id)))}>
            Everyone came
          </button>
        </span>
      </div>

      {people.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">There is nobody on the roster.</p>
      ) : (
        <>
          <div className="relative mt-1">
            <label htmlFor={`${id}-search`} className="sr-only">
              Search someone who didn’t come
            </label>
            <input
              id={`${id}-search`}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && shown[active] ? `${id}-opt-${shown[active].id}` : undefined}
              autoComplete="off"
              placeholder="Search a name to add to the list…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
              className="min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0"
            />
            {open && (
              <ul
                id={listId}
                role="listbox"
                aria-label="People who came"
                className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-slate-300 bg-surface py-1 shadow-sm"
              >
                {shown.length === 0 ? (
                  <li role="presentation" className="px-3 py-2 text-sm text-slate-600">
                    {query.trim() === '' ? 'Everyone is already on the list.' : 'Nobody on the roster matches.'}
                  </li>
                ) : (
                  shown.map((person, i) => (
                    <li
                      key={person.id}
                      id={`${id}-opt-${person.id}`}
                      role="option"
                      aria-selected={i === active}
                      // mouseDown, not click: the input's blur would close the list before a click lands.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        markAbsent(person.id)
                      }}
                      className={`min-h-11 cursor-pointer px-3 py-2 text-sm sm:min-h-0 sm:py-1.5 ${i === active ? 'bg-slate-100 text-slate-950' : 'text-slate-900'}`}
                    >
                      {person.name}
                    </li>
                  ))
                )}
                {matches.length > SHOWN && (
                  <li role="presentation" className="px-3 py-1 text-xs text-slate-600">
                    {matches.length - SHOWN} more — keep typing to narrow them down.
                  </li>
                )}
              </ul>
            )}
          </div>

          {absent.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Did not come" data-testid="absent-list">
              {absent.map((person) => (
                <li key={person.id} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-3 text-sm text-slate-900">
                  <span className="min-w-0 break-words">{person.name}</span>
                  <button
                    type="button"
                    onClick={() => markPresent(person.id)}
                    aria-label={`Remove ${person.name} from the list: they came`}
                    className="inline-flex min-h-11 min-w-8 items-center justify-center rounded-full px-2 text-slate-600 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none sm:min-h-0"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  )
}
