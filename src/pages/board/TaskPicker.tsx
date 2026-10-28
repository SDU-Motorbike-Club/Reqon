import { useMemo, useState, type KeyboardEvent } from 'react'
import type { TaskRef } from '../../tasks/dependencies.ts'
import { searchTasks } from './taskSearch.ts'

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-700'

// Pick one task out of a long list by typing part of its title or department.
// A combobox with a short list under it (never the whole list): arrow keys move,
// Enter picks, Escape closes. Choosing shows "Title — Department" in the box;
// typing again drops the choice. The parent only ever sees the chosen id, or ''.
export function TaskPicker({
  id,
  label,
  candidates,
  departmentName,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  candidates: readonly TaskRef[]
  departmentName: (key: string | null) => string
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = candidates.find((c) => c.id === value)
  const { matches, total } = useMemo(() => searchTasks(candidates, query, departmentName), [candidates, query, departmentName])
  const listId = `${id}-list`
  const shown = selected ? `${selected.title} — ${departmentName(selected.subteam_key)}` : query
  const showList = open && !selected

  const choose = (task: TaskRef) => {
    onChange(task.id)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else if (matches.length > 0) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
    } else if (event.key === 'Enter' && showList) {
      // Pick, and never submit a form this sits in.
      event.preventDefault()
      if (matches[active]) choose(matches[active])
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        value={shown}
        disabled={disabled}
        placeholder="Type part of a title or a department"
        onChange={(e) => {
          if (selected) onChange('')
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={FIELD}
      />
      {showList && (
        <div className="absolute z-20 mt-1 w-full rounded border border-slate-300 bg-surface shadow-sm">
          {matches.length === 0 ? (
            <p className="px-2 py-2 text-sm text-slate-600">No task matches “{query.trim()}”.</p>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-auto py-1">
                {matches.map((task, i) => (
                  <li
                    key={task.id}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    // mousedown, not click: the input must not lose focus first.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(task)
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`cursor-pointer px-2 py-2 text-sm sm:py-1.5 ${i === active ? 'bg-slate-100' : ''}`}
                  >
                    <span className="text-slate-900">{task.title}</span>
                    <span className="text-slate-600"> — {departmentName(task.subteam_key)}</span>
                  </li>
                ))}
              </ul>
              {total > matches.length && (
                <p className="border-t border-slate-100 px-2 py-1 text-xs text-slate-600">
                  Showing {matches.length} of {total}. Keep typing to narrow.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
