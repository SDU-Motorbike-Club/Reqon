import { useId } from 'react'
import type { Meeting } from '../data/useMeetings.ts'
import { formatDay } from '../lib/dates.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { buttonSecondary } from '../ui/buttons.ts'
import { MeetingShare } from './MeetingShare.tsx'
import { MeetingText } from './MeetingText.tsx'
import { meetingSummary, SUMMARY_PLACEHOLDER } from './meetingSummary.ts'

// What opens when a meeting card is clicked: everything the card leaves out, plus Share, Edit and Delete (the card
// itself carries no controls, so the whole card can be one click target).
export function MeetingDetail({
  meeting,
  upcoming,
  came,
  department,
  onClose,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  // null = closed.
  meeting: Meeting | null
  upcoming: boolean
  // Names of the people who came, already sorted.
  came: string[]
  department: string | null
  onClose: () => void
  // Who may edit or delete is decided by the database; these only say which buttons to offer.
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const titleId = useId()
  const summary = meeting ? meetingSummary(meeting) : null
  const label = 'text-xs font-medium tracking-wide text-slate-500 uppercase'
  const clock = meeting?.starts_at ? meeting.starts_at.slice(0, 5) + (meeting.ends_at ? `–${meeting.ends_at.slice(0, 5)}` : '') : null

  return (
    <Dialog open={meeting !== null} onClose={onClose} labelledBy={titleId} size="wide">
      {meeting && (
        <div>
          {/* First in the DOM so focus and scroll start at the top of a long meeting. */}
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            {canEdit && (
              <button type="button" className={buttonSecondary} aria-label={`Edit ${meeting.title}`} onClick={onEdit}>
                Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className={buttonSecondary} aria-label={`Delete ${meeting.title}`} onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" className={buttonSecondary} onClick={onClose}>
              Close
            </button>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-balance break-words text-slate-950">
                {meeting.title}
              </h2>
              <p className="mt-0.5 text-sm break-words text-slate-600">
                {[meeting.location, department ? `For ${department}` : null].filter(Boolean).join(' · ') || 'The whole club'}
              </p>
            </div>
            <time dateTime={meeting.held_on} className="shrink-0 text-right text-sm font-semibold text-slate-950">
              {formatDay(meeting.held_on)}
              {clock && <span className="block text-xs font-normal text-slate-600">{clock}</span>}
            </time>
          </div>

          <section className="mt-4" aria-label="Summary">
            <p className={label}>Summary</p>
            <p className={`mt-1 text-sm break-words ${summary ? 'text-slate-800' : 'text-slate-500'}`} data-testid={`meeting-summary-${meeting.id}`}>
              {summary ? summary.text : upcoming ? SUMMARY_PLACEHOLDER : 'No summary yet.'}
              {summary?.fromMinutes && <span className="text-slate-500"> (from the minutes)</span>}
            </p>
          </section>

          {meeting.agenda && (
            <section className="mt-4" aria-label="Agenda">
              <p className={label}>Agenda</p>
              <div className="mt-1">
                <MeetingText text={meeting.agenda} testId={`meeting-agenda-${meeting.id}`} />
              </div>
            </section>
          )}
          {meeting.notes && (
            <section className="mt-4 border-t border-slate-100 pt-3" aria-label="Minutes">
              <p className={label}>Minutes</p>
              <div className="mt-1">
                <MeetingText text={meeting.notes} testId={`meeting-notes-${meeting.id}`} />
              </div>
            </section>
          )}
          {came.length > 0 ? (
            <p className="mt-4 text-sm text-slate-700" data-testid={`meeting-who-${meeting.id}`}>
              Who came ({came.length}): {came.join(', ')}
            </p>
          ) : (
            meeting.attendees && <p className="mt-4 text-sm text-slate-700">Who came: {meeting.attendees}</p>
          )}

          <div className="mt-5 border-t border-slate-100 pt-2">
            <MeetingShare meeting={meeting} department={department} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
