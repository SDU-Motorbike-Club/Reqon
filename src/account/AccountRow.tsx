import { useId, type ReactNode } from 'react'
import { buttonSecondary } from '../ui/buttons.ts'

// One line of the account list: what it is, what it is now, and one button that opens its form right under it. This
// is the pattern account pages use because it keeps three small changes (username, e-mail, password) from being three
// stacked forms: you see the facts first, and open only the one you came for. The parent owns `open`, so that
// opening one row folds the others.
export function AccountRow({
  label,
  value,
  action = 'Change',
  open,
  onToggle,
  note,
  children,
}: {
  label: string
  value: ReactNode
  // The button's visible word; its accessible name is “<action> <label>” (say “Change username”).
  action?: string
  open: boolean
  onToggle: () => void
  // A short confirmation that outlives the form (“Password changed.”), announced politely.
  note?: string
  children: ReactNode
}) {
  const panelId = useId()
  return (
    <li className="px-4 py-3" data-testid={`account-row-${label.toLowerCase()}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-24 shrink-0 text-sm text-slate-600">{label}</span>
        <div className="min-w-0 flex-1 text-sm break-words text-slate-900">
          {value}
          {note && (
            <p role="status" className="mt-0.5 text-xs text-emerald-800">
              {note}
            </p>
          )}
        </div>
        <button
          type="button"
          className={buttonSecondary}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${open ? 'Cancel' : action} ${label.toLowerCase()}`}
          onClick={onToggle}
        >
          {open ? 'Cancel' : action}
        </button>
      </div>
      {open && (
        <div id={panelId} className="pc-fade-in mt-3 sm:pl-28">
          {children}
        </div>
      )}
    </li>
  )
}
