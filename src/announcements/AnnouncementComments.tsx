import { useId, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { usePermissions } from '../auth/usePermissions.ts'
import { COMMENT_MAX, useAnnouncementComments, useDeleteAnnouncementComment, usePostAnnouncementComment } from '../data/useAnnouncements.ts'
import { useAvatars } from '../data/useAvatars.ts'
import { useMembers } from '../data/useMembers.ts'
import { formatInstant } from '../lib/dates.ts'
import { ProfileLink } from '../members/ProfileLink.tsx'
import { Avatar } from '../ui/Avatar.tsx'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { ActionError, ErrorState, LoadingState } from '../ui/states.tsx'

const FORMER = 'A former member'

// The group-chat thread under one announcement: every comment with its author's picture and name, oldest first, and a
// box to add yours. Anyone the database lets read announcements may comment (the database checks again).
export function AnnouncementComments({ announcementId, count, defaultOpen = false }: { announcementId: number; count: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={buttonSecondary}
        data-testid={`comments-toggle-${announcementId}`}
      >
        {count === 0 ? 'Comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`}
      </button>
      <div id={panelId} hidden={!open}>
        {open && <Thread announcementId={announcementId} />}
      </div>
    </div>
  )
}

function Thread({ announcementId }: { announcementId: number }) {
  const auth = useAuth()
  const { canAnnounce } = usePermissions()
  const thread = useAnnouncementComments(announcementId, true)
  const members = useMembers()
  const avatars = useAvatars()
  const post = usePostAnnouncementComment(announcementId)
  const remove = useDeleteAnnouncementComment(announcementId)
  const [text, setText] = useState('')
  const inputId = useId()
  const meId = auth.status === 'member' ? auth.member.id : null
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? FORMER) : FORMER)
  const rows = thread.data ?? []

  function submit(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    post.mutate(body, { onSuccess: () => setText('') })
  }

  return (
    <div className="mt-2 space-y-3" data-testid={`comments-${announcementId}`}>
      {thread.isPending ? (
        <LoadingState label="Loading the comments…" />
      ) : thread.error ? (
        <ErrorState title="Could not load the comments" error={thread.error} onRetry={() => void thread.refetch()} />
      ) : (
        <ul className="space-y-2" aria-label="Comments">
          {rows.length === 0 && <li className="text-xs text-slate-600">No comments yet. Be the first.</li>}
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-2" data-testid={`comment-${c.id}`}>
              <Avatar name={nameOf(c.author_id)} image={c.author_id ? avatars.data?.get(c.author_id) : null} size="sm" />
              <div className="min-w-0">
                <div className="rounded-2xl bg-slate-100 px-3 py-1.5">
                  <p className="text-xs font-semibold text-slate-900">
                    {c.author_id ? <ProfileLink memberId={c.author_id}>{nameOf(c.author_id)}</ProfileLink> : FORMER}
                  </p>
                  <p className="text-sm break-words whitespace-pre-line text-slate-900">{c.body}</p>
                </div>
                <p className="mt-0.5 pl-3 text-[11px] text-slate-500">
                  <time dateTime={c.created_at}>{formatInstant(c.created_at)}</time>
                  {(c.author_id === meId || canAnnounce) && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(c.id)}
                      disabled={remove.isPending}
                      className="ml-2 rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                    >
                      Delete
                    </button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ActionError error={remove.error} />

      {meId && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <Avatar name={nameOf(meId)} image={avatars.data?.get(meId)} size="sm" />
          <label htmlFor={inputId} className="sr-only">
            Write a comment
          </label>
          {/* 16px on a phone (text-base), so iOS does not zoom the page when the box is tapped. */}
          <input
            id={inputId}
            type="text"
            value={text}
            maxLength={COMMENT_MAX}
            onChange={(e) => setText(e.target.value)}
            disabled={post.isPending}
            placeholder="Write a comment…"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-slate-300 bg-surface px-3 py-1.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 sm:text-sm"
          />
          <button
            type="submit"
            disabled={post.isPending || !text.trim()}
            className={`${buttonPrimary} shrink-0 rounded-full px-4`}
          >
            {post.isPending ? 'Posting…' : 'Post'}
          </button>
        </form>
      )}
      <ActionError error={post.error} />
    </div>
  )
}
