import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../ui/PageHeader.tsx'
import { usePermissions } from '../auth/usePermissions.ts'
import { pageMain } from '../ui/layout.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import { isOffered, MORE_PAGES } from '../ui/navItems.ts'
import { ProfileSection } from './settings/ProfileSection.tsx'
import { RosterSettings } from './settings/RosterSettings.tsx'
import { AccessGuide } from './settings/AccessGuide.tsx'
import { DepartmentSettings } from './settings/DepartmentSettings.tsx'
import { MeetingScheduleSettings } from './settings/MeetingScheduleSettings.tsx'
import { MilestoneSettings } from './settings/MilestoneSettings.tsx'
import { HandoverSettings } from './settings/HandoverSettings.tsx'
import { BookSettings } from './settings/BookSettings.tsx'
import { SeasonSettings } from './settings/SeasonSettings.tsx'
import { SeasonExport } from './settings/SeasonExport.tsx'
import { attachmentsEnabled } from '../attachments/flag.ts'
import { StorageUsage } from '../attachments/StorageUsage.tsx'
import { backupsEnabled } from '../backups/flag.ts'
import { BackupsGuide } from '../backups/BackupsGuide.tsx'
import { BackupsPanel } from '../backups/BackupsPanel.tsx'
import { BugReportsPanel } from '../bugs/BugReportsPanel.tsx'
import { ClubAccountsPanel } from '../credentials/ClubAccounts.tsx'
import { useRecordSettingsOpen, useSettingsUsage } from '../data/useSettingsUsage.ts'
import { orderSections, type SectionGroup, type SectionMeta } from './settings/sectionOrder.ts'
import { useSettingsAttention } from './settings/useSettingsAttention.ts'

// The route shell (Phase 6 §6.1): coordinates only what genuinely is shared
// between sections — the page chrome, and the one capability summary that
// describes the WHOLE page at a glance. Every section below owns its own
// data queries, mutations, pending state, action errors and form state; the
// shell does not read a single row of data itself.
//
// Admin-only actions are hidden from everyone else here AS A COURTESY — the
// actual authorization is in the database
// (supabase/migrations/20260105000000_privileged_roles.sql, with the developer
// given full access by 20260107000000_developer_full_access.sql):
//
//   members      INSERT  -> admin_roster_insert (is_admin(): president, vice-president, developer)
//   members      UPDATE  -> member_self_update  (own row, or is_admin())
//   members      DELETE  -> no policy at all: people cannot be deleted, ever
//   subteams     INSERT  -> department_insert   (can_manage_departments(): president, vice-president, developer)
//   subteams     UPDATE  -> department_update   (can_manage_departments()) — no DELETE policy: archive, never delete
//   milestones   ALL     -> admin_write         (is_admin())
//   seasons      INSERT/UPDATE/DELETE -> season_* (can_manage_seasons(): president or developer)
//   season switch        -> set_current_season() raises unless can_manage_seasons()
//   member_roles INSERT  -> role_assign         (can_grant_role(role): see PERMISSIONS.md §4)
//   member_roles DELETE  -> role_remove         (same, and never the last president)
//
// What to show comes from usePermissions() — this file never inspects roles to
// decide access. Editing it to un-hide a button gets you a rejected request,
// not access.

// One section. Using it (the first click or keypress inside it on this visit) is remembered, and that is what
// puts the sections you use at the top of the page next time.
function Section({
  id,
  title,
  tutorialId,
  attention = false,
  onUse,
  children,
}: {
  id: string
  title: string
  // What the guided tour calls this section, if it points at it.
  tutorialId?: string
  attention?: boolean
  onUse: (id: string) => void
  children: ReactNode
}) {
  const headingId = `s-${title.replace(/\s+/g, '-')}`
  return (
    <section
      className="mt-4"
      aria-labelledby={headingId}
      data-tutorial={tutorialId}
      data-section={id}
      onFocusCapture={() => onUse(id)}
      onClickCapture={() => onUse(id)}
    >
      <h2 id={headingId} className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
        {title}
        {attention && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900" data-testid={`attention-${id}`}>
            Needs attention
          </span>
        )}
      </h2>
      {children}
    </section>
  )
}

// Used once, for what the signed-in person cannot do on this page (shown only when there is something).
function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      {children}
    </p>
  )
}

const GROUP_LABEL: Record<SectionGroup, string> = { personal: 'Personal', admin: 'Club admin' }

const menuItem = (active: boolean) =>
  `flex min-h-11 w-full items-center rounded px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:py-1.5 ${
    active ? 'bg-slate-100 font-semibold text-slate-950' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
  }`

type Entry = SectionMeta & { title: string; tutorialId?: string; node: ReactNode }

export default function Settings() {
  const permissions = usePermissions()
  const { canAdminister, canManageRoles, canManageDepartments, canManageSeasons, canViewClubCredentials, canReadBugReports, roles: myRoles } = permissions
  const restriction = canManageRoles && canManageSeasons
    ? null
    : canManageRoles
      ? 'You cannot change seasons or the President and Vice President roles; those belong to the President.'
      : canAdminister
        ? 'You cannot change roles; only the President can give or take them away.'
        : 'You cannot change the roster, departments, milestones or seasons; those are reserved for the President and Vice President. The database enforces this, so those forms are hidden rather than shown and refused.'

  // Every section the person may see, once, with where it sits by default (rank) and in which group.
  // `rank` is the fixed order people knew before sections were sorted by use; it breaks ties and is what a
  // person with no habits yet sees.
  const entries: Entry[] = [
    { id: 'account', group: 'personal', rank: 0, title: 'Your account', tutorialId: 'settings-account', node: <ProfileSection /> },
    { id: 'roster', group: 'personal', rank: 1, title: 'Roster', tutorialId: 'settings-roster', node: <RosterSettings /> },
    { id: 'access', group: 'personal', rank: 2, title: 'Who can do what', node: <AccessGuide /> },
    ...(canManageDepartments
      ? [{ id: 'departments', group: 'admin' as const, rank: 3, title: 'Departments', tutorialId: 'settings-departments', node: <DepartmentSettings /> }]
      : []),
    ...(canAdminister
      ? [
          { id: 'milestones', group: 'admin' as const, rank: 4, title: 'Milestone dates and points', tutorialId: 'settings-milestones', node: <MilestoneSettings /> },
          { id: 'meeting', group: 'admin' as const, rank: 5, title: 'Weekly meeting', node: <MeetingScheduleSettings /> },
          { id: 'book', group: 'admin' as const, rank: 6, title: 'Requirements Book', node: <BookSettings /> },
        ]
      : []),
    ...(canAdminister && attachmentsEnabled() ? [{ id: 'storage', group: 'admin' as const, rank: 7, title: 'File storage', node: <StorageUsage /> }] : []),
    ...(canAdminister && backupsEnabled()
      ? [
          {
            id: 'backups',
            group: 'admin' as const,
            rank: 8,
            title: 'Backups',
            tutorialId: 'settings-backups',
            node: (
              <>
                <BackupsPanel />
                <div className="mt-3">
                  <BackupsGuide defaultAudience={myRoles.includes('developer') ? 'developer' : 'leaders'} />
                </div>
              </>
            ),
          },
        ]
      : []),
    ...(canViewClubCredentials ? [{ id: 'club-accounts', group: 'admin' as const, rank: 9, title: 'Club accounts', node: <ClubAccountsPanel /> }] : []),
    ...(canReadBugReports ? [{ id: 'bugs', group: 'admin' as const, rank: 9.5, title: 'Bug reports', node: <BugReportsPanel /> }] : []),
    { id: 'handover', group: 'personal', rank: 10, title: 'Handover notes', tutorialId: 'settings-handover', node: <HandoverSettings /> },
    { id: 'seasons', group: 'personal', rank: 11, title: 'Seasons', tutorialId: 'settings-seasons', node: <SeasonSettings canManageSeasons={canManageSeasons} /> },
    { id: 'export', group: 'personal', rank: 12, title: 'Export', tutorialId: 'settings-export', node: <SeasonExport /> },
  ]

  // The order is worked out ONCE the person's habits (and anything needing attention) are known, and then holds
  // for the visit: recording a use never re-sorts the page under someone who is typing in it. Until then, and if
  // the habits cannot be read, the fixed order.
  const usage = useSettingsUsage()
  const attention = useSettingsAttention({ backups: canAdminister && backupsEnabled() })
  const ready = (usage.isSuccess || usage.isError) && attention.settled
  const ids = entries.map((e) => e.id).join(',')
  const ordered = useMemo(
    () => orderSections(entries, ready && usage.data ? usage.data : null, new Date(), ready ? attention.ids : new Set(), 'account'),
    // `entries` is rebuilt on every render; what it contains is what `ids` says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, ready, usage.data, attention.ids],
  )
  const byId = new Map(entries.map((e) => [e.id, e]))

  // At most once per section per visit, and never waited for or shown: this only tunes the next visit.
  const record = useRecordSettingsOpen()
  const seen = useRef(new Set<string>())
  const onUse = (id: string) => {
    if (seen.current.has(id)) return
    seen.current.add(id)
    record(id)
  }

  // One section at a time, named in the address (?section=roster) so Back, a bookmark and the tutorial can open it.
  const [params, setParams] = useUrlParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const flat = [...ordered.personal, ...ordered.admin]
  const current = (flat.find((s) => s.id === params.get('section')) ?? flat[0])?.id
  const currentEntry = current ? byId.get(current) : undefined
  const morePages = MORE_PAGES.filter((page) => isOffered(page, permissions))
  const choose = (id: string) => {
    onUse(id)
    setMenuOpen(false)
    setParams((c) => mergeSearchParams(c, { section: id }))
  }

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader
        title="Settings"
        description="Pick a section from the menu. Your account and the roster are first; the club pages you open less often are under More pages."
        tutorialId="settings-overview"
      />

      {/* Only what this person CANNOT do here, in words — never left to be inferred from which buttons happen
          to be missing. What they can do is not listed: the forms are simply there. */}
      {restriction && <Notice>{restriction}</Notice>}

      <div className="mt-3 sm:flex sm:items-start sm:gap-6">
        <nav aria-label="Settings sections" className="shrink-0 sm:sticky sm:top-4 sm:w-60" data-testid="settings-jump">
          {/* The burger: on a phone the list is folded away behind this one button and shows what is open. */}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded border border-slate-300 bg-surface px-3 text-sm font-medium text-slate-900 sm:hidden"
          >
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              {currentEntry?.title ?? 'Sections'}
            </span>
            <span className="text-xs text-slate-500">{menuOpen ? 'Close' : 'Sections'}</span>
          </button>
          <div id={menuId} className={`${menuOpen ? 'mt-2 block' : 'hidden'} sm:mt-0 sm:block`}>
            {(['personal', 'admin'] as const).map((group) =>
              ordered[group].length === 0 ? null : (
                <div key={group} role="group" aria-labelledby={`settings-group-${group}`} className="mb-3">
                  <p id={`settings-group-${group}`} className="mb-1 px-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {GROUP_LABEL[group]}
                  </p>
                  <ul className="space-y-0.5">
                    {ordered[group].map((section) => {
                      const entry = byId.get(section.id) as Entry
                      const active = section.id === current
                      return (
                        <li key={section.id}>
                          <button
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            data-section={section.id}
                            onClick={() => choose(section.id)}
                            className={menuItem(active)}
                          >
                            {entry.title}
                            {attention.ids.has(section.id) && <span className="ml-1 text-amber-800"> · needs attention</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ),
            )}
            {morePages.length > 0 && (
              <div role="group" aria-labelledby="settings-group-more" className="mb-3">
                <p id="settings-group-more" className="mb-1 px-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  More pages
                </p>
                <ul className="space-y-0.5">
                  {morePages.map((page) => (
                    <li key={page.to}>
                      <Link to={page.to} className={menuItem(false)} title={page.about}>
                        {page.label} <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {currentEntry && (
            <Section key={currentEntry.id} id={currentEntry.id} title={currentEntry.title} tutorialId={currentEntry.tutorialId} attention={attention.ids.has(currentEntry.id)} onUse={onUse}>
              {currentEntry.node}
            </Section>
          )}
        </div>
      </div>
    </main>
  )
}
