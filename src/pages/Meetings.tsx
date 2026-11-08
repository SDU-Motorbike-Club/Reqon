import { useId, useState } from 'react'
import { usePermissions } from '../auth/usePermissions.ts'
import {
  useDeleteMeeting,
  useMeetingAttendance,
  useMeetingTemplate,
  useMeetings,
  useSaveMeetingTemplate,
  type Meeting,
} from '../data/useMeetings.ts'
import { useMembers } from '../data/useMembers.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { formatDay, todayIso } from '../lib/dates.ts'
import { RichTextField } from '../meetings/RichTextField.tsx'
import { MeetingDialog } from '../meetings/MeetingDialog.tsx'
import { MeetingText } from '../meetings/MeetingText.tsx'
import { agendaItems } from '../meetings/agendaPreview.ts'
import { DisclosureSummary } from '../meetings/DisclosureSummary.tsx'
import { MeetingDetail } from '../meetings/MeetingDetail.tsx'
import { meetingSummary, SUMMARY_PLACEHOLDER } from '../meetings/meetingSummary.ts'
import { splitMeetings } from '../meetings/splitMeetings.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { PageHeader } from '../ui/PageHeader.tsx'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { pageMain } from '../ui/layout.ts'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

// Real meetings: when the club met, where, what was on the agenda and what was
// decided. The screen that used to carry this name showed task proposals; those
// now live on their own screen.
//
// Who may do what comes from the database
// (20260108000000_proposals_and_meetings.sql): everyone on the roster reads,
// administrators create and edit, and only a president or developer deletes.

const PAST_PAGE = 8

const time = (value: string | null) => (value ? value.slice(0, 5) : null)

function when(meeting: Meeting): string {
  const start = time(meeting.starts_at)
  const end = time(meeting.ends_at)
  const clock = start ? (end ? `${start}–${end}` : start) : null
  return clock ? `${formatDay(meeting.held_on)}, ${clock}` : formatDay(meeting.held_on)
}

export default function Meetings() {
  const can = usePermissions()
  const meetings = useMeetings()
  const template = useMeetingTemplate()
  const remove = useDeleteMeeting()
  const departments = useSubteams()
  const members = useMembers()
  const attendance = useMeetingAttendance()
  // Who came, by name and in alphabetical order; a member who has since left the roster still reads by name.
  const whoCame = (meetingId: string): string[] => {
    const names = new Map((members.data ?? []).map((m) => [m.id, m.full_name]))
    return (attendance.data?.get(meetingId) ?? []).map((id) => names.get(id) ?? 'Someone no longer on the roster').sort((a, b) => a.localeCompare(b))
  }
  const departmentName = (key: string | null) =>
    key ? (departments.data?.find((d) => d.key === key)?.name ?? key) : null
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Meeting | null>(null)
  // The meeting whose detail dialog is open (a card was clicked).
  const [viewing, setViewing] = useState<{ meeting: Meeting; upcoming: boolean } | null>(null)
  const [message, setMessage] = useState('')
  const deleteTitleId = useId()

  const rows = meetings.data ?? []
  const { upcoming, past } = splitMeetings(rows, todayIso())
  // A whole season of weekly meetings is a long scroll of full agendas and minutes, so the most recent are shown first.
  const [allPast, setAllPast] = useState(false)
  const olderHidden = allPast ? 0 : Math.max(0, past.length - PAST_PAGE)
  const groups = [
    { label: 'Upcoming', items: upcoming, total: upcoming.length },
    { label: 'Past', items: allPast ? past : past.slice(0, PAST_PAGE), total: past.length },
  ].filter((g) => g.total > 0)

  const closeDelete = () => {
    remove.reset()
    setDeleting(null)
  }
  async function confirmDelete(meeting: Meeting) {
    try {
      await remove.mutateAsync(meeting.id)
      setDeleting(null)
      setMessage('Meeting deleted.')
    } catch {
      // Shown in the dialog; nothing on screen changes.
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader
        title="Meetings"
        description="When the club met, what was on the agenda, and what was decided."
        actions={
          can.canCreateMeeting && (
            <button
              type="button"
              className={buttonPrimary}
              data-tutorial="meeting-new"
              onClick={() => {
                setMessage('')
                setEditing('new')
              }}
            >
              New meeting
            </button>
          )
        }
      >
        <p className="text-sm text-slate-700" data-testid="meeting-access">
          {can.canCreateMeeting
            ? 'You can call a meeting and write its agenda and minutes.'
            : 'Everyone can read these. The President or Vice President calls a meeting.'}
        </p>
      </PageHeader>

      <p role="status" className="mt-1 min-h-5 text-sm text-emerald-800">
        {message}
      </p>

      <div className="mt-1" data-tutorial="meeting-list">
        {meetings.error ? (
          <ErrorState
            title="Could not load meetings"
            error={meetings.error}
            onRetry={() => void meetings.refetch()}
          />
        ) : meetings.isPending ? (
          <LoadingState label="Loading meetings…" />
        ) : rows.length === 0 ? (
          <EmptyState title="No meetings yet">
            {can.canCreateMeeting
              ? 'Call the first one with “New meeting”. It starts from the club’s agenda template.'
              : 'When the board calls a meeting, it appears here with its agenda and minutes.'}
          </EmptyState>
        ) : (
          <div className="space-y-8">
           {groups.map((group) => {
            const isUpcoming = group.label === 'Upcoming'
            return (
            <section key={group.label} aria-labelledby={`meetings-${group.label}`}>
          {/* The heading is the region's name; the hint sits beside it, outside, so the name stays "Upcoming (2)". */}
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-200 pb-2">
            <h2 id={`meetings-${group.label}`} className="text-base font-semibold text-slate-950">
              {group.label} ({group.total})
            </h2>
            <p className="text-xs text-slate-500">{isUpcoming ? 'Soonest first' : 'Newest first'}</p>
          </div>
          <ul className={isUpcoming ? 'space-y-4' : 'space-y-2'}>
            {group.items.map((meeting) => {
              const summary = meetingSummary(meeting)
              const items = agendaItems(meeting.agenda ?? '')
              const start = time(meeting.starts_at)
              const clock = start ? (time(meeting.ends_at) ? `${start}–${time(meeting.ends_at)}` : start) : null
              const where = [meeting.location, meeting.subteam_key ? `For ${departmentName(meeting.subteam_key)}` : null].filter(Boolean).join(' · ')
              const weekday = new Date(`${meeting.held_on}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })
              // The title is the real button and its ::after stretches over the whole card, so the whole card is the
              // click target and nothing else sits on it (Share, Edit and Delete live in the detail dialog).
              const open = (
                <button
                  type="button"
                  className="cursor-pointer rounded text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-ring"
                  onClick={() => setViewing({ meeting, upcoming: isUpcoming })}
                >
                  {meeting.title}
                </button>
              )
              // A meeting still to come is a large open card: it is the one thing to read next. Past meetings are
              // quiet one-glance rows. Hierarchy is size and space, with no boxes or labels inside the card.
              return isUpcoming ? (
                <li
                  key={meeting.id}
                  className="pc-lift relative rounded-xl border border-accent/40 bg-surface p-5 transition-colors duration-150 ease-out hover:bg-slate-50/40 sm:p-7"
                  data-testid={`meeting-${meeting.id}`}
                >
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <h3 className="text-xl font-semibold text-balance break-words text-slate-950 sm:text-2xl">{open}</h3>
                      {where && <p className="mt-1 text-sm break-words text-slate-600">{where}</p>}
                    </div>
                    <time dateTime={meeting.held_on} className="shrink-0 text-right">
                      <span className="block text-2xl font-semibold tabular-nums text-slate-950 sm:text-3xl">{formatDay(meeting.held_on)}</span>
                      <span className="mt-0.5 block text-sm text-slate-600">
                        {weekday}
                        {clock ? `, ${clock}` : ''}
                      </span>
                    </time>
                  </div>
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <p className="text-sm text-pretty break-words text-slate-500" data-testid={`meeting-summary-${meeting.id}`}>
                      {summary ? summary.text : SUMMARY_PLACEHOLDER}
                    </p>
                    {items.length > 0 ? (
                      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base text-pretty text-slate-800">
                        {items.slice(0, 4).map((item, index) => (
                          <li key={index}>
                            <span className="line-clamp-2 break-words">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-base text-slate-500">The agenda is not written yet.</p>
                    )}
                    {items.length > 4 && <p className="mt-2 text-sm text-slate-500">+{items.length - 4} more</p>}
                  </div>
                </li>
              ) : (
                <li
                  key={meeting.id}
                  className="pc-lift relative rounded-lg border border-slate-200 bg-surface px-4 py-3 transition-colors duration-150 ease-out hover:bg-slate-50/40"
                  data-testid={`meeting-${meeting.id}`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="min-w-0 text-base font-medium text-balance break-words text-slate-950">{open}</h3>
                    <time dateTime={meeting.held_on} className="shrink-0 text-sm tabular-nums text-slate-600">
                      {formatDay(meeting.held_on)}
                    </time>
                  </div>
                  <p className={`mt-0.5 line-clamp-2 text-sm text-pretty break-words ${summary ? 'text-slate-700' : 'text-slate-500'}`} data-testid={`meeting-summary-${meeting.id}`}>
                    {summary ? summary.text : 'No summary yet.'}
                    {summary?.fromMinutes && <span className="text-slate-500"> (from the minutes)</span>}
                  </p>
                  {where && <p className="mt-0.5 truncate text-xs text-slate-500">{where}</p>}
                </li>
              )
            })}
          </ul>
          {group.label === 'Past' && (olderHidden > 0 || allPast) && past.length > PAST_PAGE && (
            <button
              type="button"
              className={`${buttonSecondary} mt-3`}
              data-testid="meetings-older-toggle"
              onClick={() => setAllPast((all) => !all)}
            >
              {allPast ? 'Show fewer' : `Show ${olderHidden} older ${olderHidden === 1 ? 'meeting' : 'meetings'}`}
            </button>
          )}
            </section>
            )
           })}
          </div>
        )}
      </div>

      {/* The global agenda template. Editing THIS is president or developer
          only (template_write: can_delete_records()); a vice-president still
          writes each meeting's own agenda above. */}
      {(can.canCreateMeeting || can.canEditMeetingTemplate) && (
        <DefaultAgenda canEdit={can.canEditMeetingTemplate} onSaved={setMessage} />
      )}

      <MeetingDetail
        meeting={viewing?.meeting ?? null}
        upcoming={viewing?.upcoming ?? false}
        came={viewing ? whoCame(viewing.meeting.id) : []}
        department={viewing ? departmentName(viewing.meeting.subteam_key) : null}
        onClose={() => setViewing(null)}
        canEdit={can.canCreateMeeting}
        canDelete={can.canDeleteMeeting}
        onEdit={() => {
          if (!viewing) return
          setMessage('')
          setEditing(viewing.meeting)
          setViewing(null)
        }}
        onDelete={() => {
          if (!viewing) return
          setMessage('')
          setDeleting(viewing.meeting)
          setViewing(null)
        }}
      />

      <MeetingDialog
        open={editing !== null}
        meeting={editing === 'new' ? null : editing}
        template={template.data ?? ''}
        onClose={() => setEditing(null)}
        onSaved={(text) => {
          setEditing(null)
          setMessage(text)
        }}
      />

      <Dialog
        open={deleting !== null}
        onClose={closeDelete}
        labelledBy={deleteTitleId}
        dismissible={!remove.isPending}
      >
        {deleting && (
          <div>
            <h2 id={deleteTitleId} className="text-base font-semibold text-balance text-slate-900">
              Delete this meeting?
            </h2>
            <p className="mt-2 text-sm text-pretty text-slate-700">
              “{deleting.title}” of {when(deleting)} will be removed for everyone, with its agenda
              and minutes. This cannot be undone.
            </p>
            <ActionError error={remove.error} className="mt-3" />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={buttonSecondary}
                disabled={remove.isPending}
                onClick={closeDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonDanger}
                disabled={remove.isPending}
                onClick={() => void confirmDelete(deleting)}
              >
                {remove.isPending ? 'Deleting…' : 'Delete meeting'}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  )
}

// The default agenda every new meeting starts from. Separate from any one
// meeting's content on purpose: this is club configuration. Readable by
// whoever calls meetings; edited in a dialog by the President or a Developer.
//
// The draft lives here, outside the dialog, so closing the dialog by accident
// (Escape, a click outside) or a failed save never loses what was typed; only
// "Discard changes" or a successful save clears it.
function DefaultAgenda({ canEdit, onSaved }: { canEdit: boolean; onSaved: (message: string) => void }) {
  const template = useMeetingTemplate()
  const save = useSaveMeetingTemplate()
  const [open, setOpen] = useState(false)
  // The text being edited, and the saved text it started from.
  const [draft, setDraft] = useState<{ body: string; base: string } | null>(null)
  const id = useId()
  const current = template.data ?? ''
  const dirty = draft !== null && draft.body !== draft.base
  // Someone else saved a different default agenda after this draft began.
  const movedOn = draft !== null && template.data !== undefined && draft.base !== current

  const openEditor = () => {
    save.reset()
    if (draft === null) setDraft({ body: current, base: current })
    setOpen(true)
  }
  const discard = () => {
    setDraft(null)
    save.reset()
    setOpen(false)
  }
  async function submit() {
    if (!draft) return
    try {
      await save.mutateAsync(draft.body)
      setDraft(null)
      setOpen(false)
      onSaved('Default agenda saved. Meetings that already exist are unchanged.')
    } catch {
      // Shown in the dialog; the draft stays.
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-slate-200 bg-surface p-3" aria-labelledby={`${id}-heading`} data-tutorial="meeting-template">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="text-sm font-semibold text-slate-900">
            Default agenda for new meetings
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Every new meeting starts from this. Changing it changes nothing about meetings that already exist.
            {canEdit ? '' : ' The President edits it.'}
          </p>
        </div>
        {canEdit && (
          <button type="button" className={buttonSecondary} onClick={openEditor} disabled={template.isPending} data-testid="template-edit">
            Edit default agenda
          </button>
        )}
      </div>
      {dirty && !open && (
        <p className="mt-2 text-xs text-amber-900" data-testid="template-draft-kept">
          You have unsaved changes to the default agenda. Open “Edit default agenda” to save or discard them.
        </p>
      )}
      <details className="group mt-1">
        <DisclosureSummary>Show the default agenda</DisclosureSummary>
        <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-2">
          {template.error ? (
            <ActionError error={template.error} />
          ) : template.isPending ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : current.trim() ? (
            <MeetingText text={current} testId="template-view" />
          ) : (
            <p className="text-sm text-slate-600">The default agenda is empty.</p>
          )}
        </div>
      </details>

      <Dialog open={open} onClose={() => setOpen(false)} labelledBy={`${id}-dialog`} dismissible={!save.isPending}>
        {draft && (
          <div>
            <h2 id={`${id}-dialog`} className="text-base font-semibold text-balance text-slate-900">
              Edit default agenda
            </h2>
            {movedOn && (
              <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                Someone saved a different default agenda after you started. Saving replaces it with yours.{' '}
                <button type="button" className="underline underline-offset-2" onClick={() => setDraft({ body: current, base: current })}>
                  Start again from theirs
                </button>
              </p>
            )}
            <div className="mt-3">
              <RichTextField
                id={`${id}-body`}
                label="Default agenda"
                value={draft.body}
                onChange={(body) => setDraft({ ...draft, body })}
                size="large"
                disabled={save.isPending}
              />
            </div>
            <ActionError error={save.error} className="mt-3" />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonSecondary} disabled={save.isPending || !dirty} onClick={discard}>
                Discard changes
              </button>
              <button type="button" className={buttonSecondary} disabled={save.isPending} onClick={() => setOpen(false)}>
                Close
              </button>
              <button type="button" className={buttonPrimary} disabled={save.isPending || !dirty} onClick={() => void submit()}>
                {save.isPending ? 'Saving…' : 'Save default agenda'}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  )
}
