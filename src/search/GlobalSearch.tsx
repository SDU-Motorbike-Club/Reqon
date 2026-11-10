import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { MIN_TERM, useGlobalSearch } from '../data/useGlobalSearch.ts'
import { snippet } from './snippet.ts'

// One search box for the whole app, in the header. Each result says what it is, shows the words around the
// match (cut with … when the text goes on) and names the page it is found on. The header keys it on the address,
// so going anywhere (a result, a link, Back) starts it empty and closed.
export function GlobalSearch() {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const { term, result } = useGlobalSearch(text)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const links = () => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>('a[data-hit]') ?? [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      input.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const all = links()
    const at = all.indexOf(document.activeElement as HTMLAnchorElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    if (next < 0) input.current?.focus()
    else all[Math.min(next, all.length - 1)]?.focus()
    e.preventDefault()
  }

  const ready = text.trim().length >= MIN_TERM
  const hits = result.data ?? []
  // Typing, or the answer is still on its way: say so rather than show the last answer as if it were this one.
  const waiting = ready && (term !== text.trim().replace(/\s+/g, ' ') || result.isFetching)

  return (
    <div ref={root} className="relative min-w-0 flex-1 sm:max-w-sm" onKeyDown={onKeyDown} role="search">
      <label htmlFor={id} className="sr-only">
        Search the whole site
      </label>
      <input
        ref={input}
        id={id}
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search everything…"
        autoComplete="off"
        aria-controls={open && ready ? `${id}-results` : undefined}
        aria-expanded={open && ready}
        data-testid="global-search"
        className="block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:py-1.5 sm:text-sm"
      />
      {open && ready && (
        <div
          id={`${id}-results`}
          className="absolute left-0 z-40 mt-1 max-h-[70vh] w-[min(34rem,calc(100vw-1.5rem))] overflow-auto rounded-lg border border-slate-200 bg-surface shadow-lg"
          data-testid="global-search-results"
        >
          {result.error ? (
            <p role="alert" className="p-3 text-sm text-red-700">
              Could not search: {result.error.message}
            </p>
          ) : waiting && hits.length === 0 ? (
            <p role="status" className="p-3 text-sm text-slate-600">
              Searching…
            </p>
          ) : hits.length === 0 ? (
            <p role="status" className="p-3 text-sm text-slate-600">
              Nothing found for “{term}”.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Search results">
              {hits.map((hit) => {
                const s = snippet(hit.text, term)
                return (
                  <li key={hit.key}>
                    <Link to={hit.to} data-hit className="block px-3 py-2 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{hit.title}</span>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{hit.page}</span>
                      </span>
                      {hit.text && (
                        <span className="mt-0.5 block text-xs break-words text-slate-600">
                          {s.before}
                          {s.match && <mark className="rounded bg-amber-100 px-0.5 text-slate-900">{s.match}</mark>}
                          {s.after}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
