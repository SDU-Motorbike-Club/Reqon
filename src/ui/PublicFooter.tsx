import { NavLink } from 'react-router-dom'
import { SHELL } from './layout.ts'

// Footer for the screens a signed-out visitor can see: the sign-in form and the
// privacy policy. Kept to what someone needs before they have an account.
export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-surface">
      <div className={`${SHELL} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-xs text-slate-600`}>
        <p>Reqon · SDU Motorbike Club</p>
        <nav aria-label="Legal">
          <NavLink
            to="/privacy"
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-h-0"
          >
            Privacy policy
          </NavLink>
        </nav>
      </div>
    </footer>
  )
}
