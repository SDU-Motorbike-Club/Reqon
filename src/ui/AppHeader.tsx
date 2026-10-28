import { attachmentsEnabled } from '../attachments/flag.ts'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context.ts'
import { ROLE_LABELS, sortRoles } from '../auth/permissions.ts'
import { usePermissions } from '../auth/usePermissions.ts'
import { useMyAvatar } from '../data/useAvatars.ts'
import { useBugReport } from '../bugs/bugReportContext.ts'
import { useCurrentSeason } from '../data/useCurrentSeason.ts'
import { useUnreadCount } from '../data/useNotifications.ts'
import { useTutorial } from '../tutorial/context.ts'
import { Avatar } from './Avatar.tsx'
import { buttonSecondary } from './buttons.ts'
import { SHELL } from './layout.ts'
import { NAV_ITEMS } from './navItems.ts'

// Active screen: a bright label with an accent rule under it, AND aria-current="page" — never colour alone. The
// red fill is kept for the one thing you came to do on a screen (its primary button), so the menu does not
// compete with it. The rule sits on the header's own bottom border, which is why the link is pulled down 1px.
const desktopLink = ({ isActive }: { isActive: boolean }) =>
  `relative -mb-px inline-flex items-center border-b-2 px-2 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring ${
    isActive ? 'border-accent text-slate-950' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
  }`

const phoneLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center border-l-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring ${
    isActive ? 'border-accent bg-slate-100 text-slate-950' : 'border-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900'
  }`

// The one navigation for the whole app. Before this, each screen hand-rolled
// its own subset of links: Settings had no way in at all, the Register had no
// way out, and signing out was only possible from a leftover test page.
export function AppHeader() {
  const auth = useAuth()
  const can = usePermissions()
  const tutorial = useTutorial()
  const season = useCurrentSeason()
  const unread = useUnreadCount().data ?? 0
  const reportBug = useBugReport()
  const location = useLocation()
  // Remember which page the phone menu was opened on. Any navigation changes
  // the path, which closes it — no effect needed to keep the two in sync.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null)
  const menuOpen = menuOpenOn === location.pathname
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node
      if (panelRef.current?.contains(node) || menuButtonRef.current?.contains(node)) return
      setMenuOpenOn(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpenOn(null)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const name = auth.status === 'member' ? auth.member.full_name : ''
  // Only your own picture, one row: the header is on every screen, so it must never load everyone's.
  const myPicture = useMyAvatar().data ?? null
  // Your roles beside your name, in words, so it is always clear what the
  // screens will let you do.
  const roleText = sortRoles(can.roles).map((role) => ROLE_LABELS[role]).join(', ')
  // Screens that would show this person nothing are left out of the menu.
  const items = NAV_ITEMS.filter((item) => !item.requires || (item.requires === 'attachmentsEnabled' ? attachmentsEnabled() : can[item.requires]))
  const signOut = () => void auth.signOut()
  const openTour = () => {
    // From the phone menu: close it and park focus on the Menu button, which
    // stays on screen — the Tutorial button inside the menu is about to go, and
    // the tour hands focus back to wherever it was opened from.
    if (menuOpen) {
      setMenuOpenOn(null)
      menuButtonRef.current?.focus()
    }
    tutorial.openChooser()
  }

  return (
    <header className="border-b border-slate-200 bg-surface">
      <div className={`${SHELL} flex items-center gap-2 py-2`}>
        <Link
          to="/"
          className="rounded text-base font-semibold tracking-tight text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          Reqon
        </Link>
        {season.data?.label && (
          <span
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700"
            title="Everything on screen belongs to this season"
            data-tutorial="season-badge"
          >
            <span className="sr-only">Current season: </span>
            {season.data.label}
          </span>
        )}

        {/* Visible on every width, outside the phone menu: the count is the
            point, so it must not hide behind a button. */}
        {reportBug && (
          <button
            type="button"
            onClick={() => reportBug()}
            className="ml-auto inline-flex min-h-11 items-center rounded px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:py-1.5"
            data-testid="report-bug"
            data-tutorial="report-bug"
          >
            Report a bug
          </button>
        )}
        <NavLink
          to="/inbox"
          aria-label={unread > 0 ? `Inbox, ${unread} new` : 'Inbox'}
          className={({ isActive }) =>
            `${reportBug ? '' : 'ml-auto '}inline-flex min-h-11 items-center gap-1.5 rounded px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:py-1.5 ${
              isActive ? 'bg-slate-100 text-slate-950' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`
          }
          data-testid="inbox-link"
        >
          Inbox
          {unread > 0 && (
            <span aria-hidden="true" className="rounded-full bg-info px-1.5 text-xs font-semibold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </NavLink>

        <div className="hidden items-center gap-2 sm:flex">
          {name && (
            <span className="inline-flex items-center gap-2 text-xs text-slate-600" data-tutorial="account-roles">
              <Avatar name={name} image={myPicture} size="sm" />
              {name}
              {roleText && <span className="text-slate-500"> · {roleText}</span>}
            </span>
          )}
          <button type="button" onClick={openTour} className={buttonSecondary} data-tutorial="help-button">
            Tutorial
          </button>
          <button type="button" onClick={signOut} className={buttonSecondary}>
            Sign out
          </button>
        </div>

        {/* On a phone everything collapses behind this one button, so it is
            also what the tutorial points at for "navigation" and "restart". */}
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? 'phone-menu' : undefined}
          onClick={() => setMenuOpenOn(menuOpen ? null : location.pathname)}
          className={`sm:hidden ${buttonSecondary}`}
          data-tutorial="main-nav help-button account-roles"
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      <nav aria-label="Main" className={`${SHELL} hidden sm:block`} data-tutorial="main-nav">
        <ul className="flex flex-wrap gap-1">
          {items.map((item, i) => (
            <li key={item.to} className={i > 0 && items[i - 1].group !== item.group ? 'ml-1.5 border-l border-slate-200 pl-1.5' : undefined}>
              <NavLink to={item.to} end={item.end} className={desktopLink}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {menuOpen && (
        <div id="phone-menu" ref={panelRef} className="pc-fade-in border-t border-slate-200 px-3 pb-3 sm:hidden">
          <nav aria-label="Main">
            <ul className="grid grid-cols-2 gap-1 pt-2">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={phoneLink}
                    // Choosing the page you are already on changes nothing, so
                    // close explicitly rather than rely on the path changing.
                    onClick={() => setMenuOpenOn(null)}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
            {name && (
              <span className="inline-flex items-center gap-2 text-xs text-slate-600">
                <Avatar name={name} image={myPicture} size="sm" />
                Signed in as {name}
                {roleText && ` · ${roleText}`}
              </span>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={openTour} className={buttonSecondary}>
                Tutorial
              </button>
              <button type="button" onClick={signOut} className={buttonSecondary}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
