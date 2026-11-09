import { useId, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { ANNOUNCEMENT_MAX, ANNOUNCEMENT_TITLE_MAX, HISTORY_SIZE, useAnnouncements, useSendAnnouncement } from '../data/useAnnouncements.ts'
import { useMembers } from '../data/useMembers.ts'
import { formatInstant } from '../lib/dates.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

// The tag that tells an announcement from an ordinary notice. Words, not only colour.
export function AnnouncementTag() {
  return (
    <span className="mr-1.5 inline-block rounded bg-accent px-1.5 py-0.5 align-middle text-[11px] font-semibold tracking-wide text-white uppercase">
      Announcement
    </span>
  )
}

// Write one announcement to everyone. Only offered to the people send_announcement() accepts; the database checks again.
export function NewAnnouncementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="announce-dialog-title">
      {open && <Compose onClose={onClose} />}
    </Dialog>
  )
}

function Compose({ onClose }: { onClose: () => void }) {
  const id = useId()
  const auth = useAuth()
  const members = useMembers()
  const send = useSendAnnouncement()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reached, setReached] = useState<number | null>(null)
  const meId = auth.status === 'member' ? auth.member.id : null
  // Who it will reach: active and trial members, not the author. The database counts the same way.
  const recipients = useMemo(
    () => (members.data ?? []).filter((m) => m.status !== 'alumni' && m.id !== meId).length,
    [members.data, meId],
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    const headline = title.trim()
    const text = body.trim()
    if (!headline || !text) return
    send.mutate({ title: headline, body: text }, { onSuccess: (n) => setReached(n) })
  }

  if (reached !== null) {
    return (
      <div data-testid="announce-dialog">
        <h2 id="announce-dialog-title" className="text-base font-semibold text-slate-900">
          Announcement sent
        </h2>
        <p role="status" className="mt-2 text-sm text-slate-700">
          It reached {reached} {reached === 1 ? 'member' : 'members'}. It is now in the list of previous announcements.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonPrimary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} data-testid="announce-dialog">
      <h2 id="announce-dialog-title" className="text-base font-semibold text-slate-900">
        New announcement
      </h2>
      <p className="mt-1 text-sm text-slate-600">Goes to every active member’s inbox, marked as an announcement. It cannot be taken back.</p>
      {/* 16px on a phone (text-base), so iOS does not zoom the page when a box is tapped. */}
      <label htmlFor={`${id}-title`} className="mt-3 block text-sm font-medium text-slate-900">
        Title
      </label>
      <input
        id={`${id}-title`}
        type="text"
        required
        maxLength={ANNOUNCEMENT_TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={send.isPending}
        placeholder="A short headline"
        className="mt-1 block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 py-1.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:text-sm"
      />
      <label htmlFor={id} className="mt-3 block text-sm font-medium text-slate-900">
        Description
      </label>
      <textarea
        id={id}
        rows={5}
        required
        maxLength={ANNOUNCEMENT_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={send.isPending}
        placeholder="What should everyone know?"
        className="mt-1 block w-full rounded border border-slate-300 bg-surface px-2.5 py-1.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:text-sm"
      />
      <p className="mt-1 text-xs text-slate-500">
        {body.length}/{ANNOUNCEMENT_MAX}
      </p>
      <ActionError error={send.error} className="mt-2" />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonSecondary} onClick={onClose} disabled={send.isPending}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={send.isPending || !title.trim() || !body.trim() || recipients === 0}>
          {send.isPending ? 'Sending…' : `Send to all ${recipients} ${recipients === 1 ? 'member' : 'members'}`}
        </button>
      </div>
    </form>
  )
}

// Every earlier announcement, newest first. Read by anyone who can see the inbox.
export function AnnouncementHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="announce-history-title">
      {open && <History onClose={onClose} />}
    </Dialog>
  )
}

function History({ onClose }: { onClose: () => void }) {
  const list = useAnnouncements(true)
  const members = useMembers()
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  const rows = list.data ?? []

  return (
    <div data-testid="announce-history">
      <h2 id="announce-history-title" className="text-base font-semibold text-slate-900">
        Previous announcements
      </h2>
      <div className="mt-3">
        {list.isPending ? (
          <LoadingState label="Loading the announcements…" />
        ) : list.error ? (
          <ErrorState title="Could not load the announcements" error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No announcements yet">When the leadership announces something to the whole club, it is kept here.</EmptyState>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-slate-200 overflow-auto rounded-lg border border-slate-200">
            {rows.map((a) => (
              <li key={a.id} className="px-3 py-2" data-testid={`announcement-${a.id}`}>
                <p className="text-xs text-slate-600">
                  <AnnouncementTag />
                  {a.author_id ? (names.get(a.author_id) ?? 'A former member') : 'A former member'} ·{' '}
                  <time dateTime={a.created_at}>{formatInstant(a.created_at)}</time>
                </p>
                {a.title && <p className="mt-1 text-sm font-semibold break-words text-slate-900">{a.title}</p>}
                <p className="mt-1 text-sm break-words whitespace-pre-line text-slate-900">{a.body}</p>
              </li>
            ))}
          </ul>
        )}
        {rows.length === HISTORY_SIZE && <p className="mt-2 text-xs text-slate-500">Showing the latest {HISTORY_SIZE}.</p>}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
