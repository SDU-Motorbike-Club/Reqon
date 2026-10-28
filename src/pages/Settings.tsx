import { useMemo, useRef, type ReactNode } from 'react'
import { PageHeader } from '../ui/PageHeader.tsx'
import { usePermissions } from '../auth/usePermissions.ts'
import { pageMain } from '../ui/layout.ts'
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

type Entry = SectionMeta & { title: string; tutorialId?: string; node: ReactNode }

export default function Settings() {
  const { canAdminister, canManageRoles, canManageDepartments, canManageSeasons, canViewClubCredentials, roles: myRoles } = usePermissions()
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

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('reading')}>
      <PageHeader
        title="Settings"
        description="Your account, the roster, departments, milestone dates, handover notes and seasons. The sections you use most come first."
        tutorialId="settings-overview"
      />

      {/* Only what this person CANNOT do here, in words — never left to be inferred from which buttons happen
          to be missing. What they can do is not listed: the forms are simply there. */}
      {restriction && <Notice>{restriction}</Notice>}

      <nav aria-label="Settings sections" className="mb-2 flex flex-wrap gap-1.5 text-xs" data-testid="settings-jump">
        {(['personal', 'admin'] as const).flatMap((group) =>
          ordered[group].map((section) => {
            const entry = byId.get(section.id) as Entry
            return (
              <a
                key={section.id}
                href={`#s-${entry.title.replace(/\s+/g, '-')}`}
                onClick={(event) => {
                  onUse(section.id)
                  // Scroll to the section and put focus on its heading, without adding a history entry for every chip
                  // clicked (Back would otherwise walk through them).
                  const heading = document.getElementById(`s-${entry.title.replace(/\s+/g, '-')}`)
                  if (!heading) return
                  event.preventDefault()
                  heading.tabIndex = -1
                  heading.scrollIntoView?.({ block: 'start' })
                  heading.focus({ preventScroll: true })
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-300 bg-surface px-3 text-slate-800 hover:bg-slate-50 sm:min-h-0 sm:py-1"
              >
                {entry.title}
                {attention.ids.has(section.id) && <span className="text-amber-800"> · needs attention</span>}
              </a>
            )
          }),
        )}
      </nav>

      {(['personal', 'admin'] as const).map((group) =>
        ordered[group].length === 0 ? null : (
          <div key={group} role="group" aria-labelledby={`settings-group-${group}`}>
            <p id={`settings-group-${group}`} className="mt-6 border-b border-slate-200 pb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {GROUP_LABEL[group]}
            </p>
            {ordered[group].map((section) => {
              const entry = byId.get(section.id) as Entry
              return (
                <Section key={section.id} id={section.id} title={entry.title} tutorialId={entry.tutorialId} attention={attention.ids.has(section.id)} onUse={onUse}>
                  {entry.node}
                </Section>
              )
            })}
          </div>
        ),
      )}
    </main>
  )
}
