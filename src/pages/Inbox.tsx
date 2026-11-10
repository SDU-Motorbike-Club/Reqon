import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnnouncementHistoryDialog, AnnouncementTag, NewAnnouncementDialog } from '../announcements/AnnouncementDialogs.tsx'
import { usePermissions } from '../auth/usePermissions.ts'
import { useMembers } from '../data/useMembers.ts'
import { useAnnouncements } from '../data/useAnnouncements.ts'
import { INBOX_SIZE, useMarkNotificationsRead, useNotifications } from '../data/useNotifications.ts'
import { formatInstant } from '../lib/dates.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import { describeNotification, type Notification } from '../notifications/presentation.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

const ANNOUNCEMENTS_IN_INBOX = 10

// "This needs you": what the database noticed for the signed-in person — a task
// handed to them, a proposal waiting for their review, their own proposal
// approved or sent back (20260139000000_notifications.sql). The activity
// history on each task and proposal still says who did what; this says what is
// yours to act on. Opening one marks it read.
export default function Inbox() {
  const notifications = useNotifications()
  const members = useMembers()
  const markRead = useMarkNotificationsRead()
  const { canAnnounce } = usePermissions()
  // The history is an address (?announcements=1), so an announcement in the list can open it and Back closes it.
  const [params, setParams] = useUrlParams()
  const historyOpen = params.get('announcements') === '1'
  const setHistory = (open: boolean) =>
    setParams((current) => mergeSearchParams(current, { announcements: open ? '1' : null, ...(open ? {} : { announcement: null }) }), { replace: !open })
  const [composing, setComposing] = useState(false)
  const names = new Map((members.data ?? []).map((m) => [m.id, m.full_name]))

  // The latest announcements join the list at their place in time, so the one you sent yourself (the database sends
  // none to its author) and one already purged from your notices still sit beside them. An announcement that
  // reached you as a notice is not shown twice. Opening one goes to the same history as the notice does.
  const history = useAnnouncements(true)
  const noticed = new Set((notifications.data ?? []).filter((n) => n.kind === 'announcement').map((n) => n.entity_id))
  const joined: Notification[] = (history.data ?? [])
    .filter((a) => !noticed.has(String(a.id)))
    .slice(0, ANNOUNCEMENTS_IN_INBOX)
    .map((a) => ({
      // Negative, so it cannot collide with a notification id; read_at is set, so it is never "new" and never marked.
      id: -a.id, member_id: '', season_id: null, kind: 'announcement', entity: 'announcement', entity_id: String(a.id),
      actor_id: a.author_id, activity_id: null, title: a.title, body: a.body, created_at: a.created_at, read_at: a.created_at,
    }))
  const rows = [...(notifications.data ?? []), ...joined].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const unread = rows.filter((n) => n.read_at === null)
  const earlier = rows.filter((n) => n.read_at !== null)

  const item = (n: Notification) => {
    const view = describeNotification(n, n.actor_id ? (names.get(n.actor_id) ?? null) : null)
    const isNew = n.read_at === null
    return (
      <li key={n.id}>
        <Link
          to={view.to}
          onClick={() => {
            if (isNew) markRead.mutate({ id: n.id })
          }}
          className={`flex items-start gap-2 px-3 py-2 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring ${view.label ? 'border-l-4 border-accent bg-slate-50' : ''}`}
          data-testid={`notification-${n.id}`}
        >
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isNew ? 'bg-info' : 'bg-transparent'}`}
          />
          <span className="min-w-0">
            {isNew && <span className="sr-only">New: </span>}
            {view.label && <AnnouncementTag />}
            {view.heading && <span className="block text-sm font-semibold break-words text-slate-900">{view.heading}</span>}
            <span className={`block text-sm text-pretty break-words whitespace-pre-line ${isNew ? 'font-medium text-slate-900' : 'text-slate-700'}`}>{view.text}</span>
            <time dateTime={n.created_at} className="text-xs text-slate-500">
              {formatInstant(n.created_at)}
            </time>
          </span>
        </Link>
      </li>
    )
  }

  const list = (label: string, group: Notification[]) =>
    group.length > 0 && (
      <section aria-label={label} className="mt-3 first:mt-0">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label} <span className="font-normal text-slate-500">({group.length})</span>
        </h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-surface">{group.map(item)}</ul>
      </section>
    )

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('reading')}>
      <PageHeader
        title="Inbox"
        description="What needs you: tasks handed to you, proposals waiting for your review, answers to your own proposals, messages from other members, and announcements to the whole club."
        // In the header, so an empty inbox still has them. Only the leadership writes an announcement.
        actions={
          canAnnounce ? (
            <button type="button" className={buttonPrimary} onClick={() => setComposing(true)}>
              New announcement
            </button>
          ) : undefined
        }
      >
        {/* Everyone reads the history. Quiet text under the description, like the Board's Archive link. */}
        <p className="mt-1 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => setHistory(true)}
            className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-0"
          >
            Previous announcements
          </button>
        </p>
      </PageHeader>
      {notifications.isLoading ? (
        <LoadingState label="Loading your inbox…" />
      ) : notifications.error ? (
        <ErrorState title="Could not load your inbox" error={notifications.error} onRetry={() => void notifications.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing needs you right now">
          When someone gives you a task, asks for your review or answers one of your proposals, it appears here.
        </EmptyState>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              {unread.length === 0 ? 'All read.' : `${unread.length} new`}
              {rows.length === INBOX_SIZE && ` · showing the latest ${INBOX_SIZE}`}
            </p>
            {unread.length > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate('all')}
                disabled={markRead.isPending}
                className={`${buttonSecondary} text-xs`}
              >
                Mark all read
              </button>
            )}
          </div>
          <ActionError error={markRead.error} className="mb-2" />
          {list('New', unread)}
          {list('Earlier', earlier)}
        </>
      )}
      <NewAnnouncementDialog open={composing} onClose={() => setComposing(false)} />
      <AnnouncementHistoryDialog open={historyOpen} onClose={() => setHistory(false)} />
    </main>
  )
}
