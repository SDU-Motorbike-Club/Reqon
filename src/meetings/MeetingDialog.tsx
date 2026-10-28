import { useId, useMemo, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  useCreateMeeting,
  useMeetingAttendance,
  useSetMeetingAttendees,
  useUpdateMeeting,
  type Meeting,
  type MeetingDraft,
} from '../data/useMeetings.ts'
import { useMembers } from '../data/useMembers.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { isActive } from '../departments/types.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { ActionError } from '../ui/states.tsx'
import { AttendanceChecklist } from './AttendanceChecklist.tsx'
import { RichTextField } from './RichTextField.tsx'
import { isPastDay } from './meetingText.ts'

// Calling a meeting, or editing one that has happened.
//
// Two fields are required because the database requires them: a title and a
// date. Everything else is optional — the club regularly fixes the day before
// the hour, the room, or who turned up, and an invented value is worse than an
// empty one.
//
// Only administrators reach this (meeting_insert / meeting_update call
// is_admin()); a vice-president may write any meeting's agenda and minutes
// here, which is deliberately NOT the same as editing the global template.

type Errors = { title?: string; heldOn?: string; endsAt?: string }

export function MeetingDialog({
  open,
  meeting,
  template,
  onClose,
  onSaved,
}: {
  open: boolean
  // null = a new meeting, prefilled from the club's template.
  meeting: Meeting | null
  template: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const titleId = useId()
  const create = useCreateMeeting()
  const update = useUpdateMeeting()
  const setAttendees = useSetMeetingAttendees()
  const pending = create.isPending || update.isPending || setAttendees.isPending
  const error = create.error ?? update.error ?? setAttendees.error

  const close = () => {
    create.reset()
    update.reset()
    setAttendees.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} labelledBy={titleId} dismissible={!pending} size="wide">
      <Form
        // Remounted per meeting, so reopening never shows the previous one's
        // half-typed values.
        key={meeting?.id ?? 'new'}
        meeting={meeting}
        template={template}
        titleId={titleId}
        pending={pending}
        error={error}
        onCancel={close}
        // `present` is null when nobody touched the ticks: the saved list is then left exactly as it is.
        onSubmit={async (draft, present) => {
          try {
            if (meeting) {
              if (present) await setAttendees.mutateAsync({ meetingId: meeting.id, memberIds: present })
              await update.mutateAsync({ id: meeting.id, expectedUpdatedAt: meeting.updated_at, ...draft })
              onSaved('Meeting updated.')
            } else {
              const created = await create.mutateAsync(draft)
              if (present && present.length > 0) {
                try {
                  await setAttendees.mutateAsync({ meetingId: created.id, memberIds: present })
                } catch {
                  onSaved('Meeting added, but who came could not be saved. Open the meeting to tick them again.')
                  return
                }
              }
              onSaved('Meeting added.')
            }
          } catch {
            // Shown by ActionError; the dialog stays open with what was typed.
          }
        }}
      />
    </Dialog>
  )
}

function Form({
  meeting,
  template,
  titleId,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  meeting: Meeting | null
  template: string
  titleId: string
  pending: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: MeetingDraft, present: string[] | null) => void
}) {
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [heldOn, setHeldOn] = useState(meeting?.held_on ?? '')
  // Postgres `time` comes back as HH:MM:SS; a time input wants HH:MM.
  const [startsAt, setStartsAt] = useState((meeting?.starts_at ?? '').slice(0, 5))
  const [endsAt, setEndsAt] = useState((meeting?.ends_at ?? '').slice(0, 5))
  const [location, setLocation] = useState(meeting?.location ?? '')
  const [subteamKey, setSubteamKey] = useState(meeting?.subteam_key ?? '')
  const departments = useSubteams().data ?? []
  // A saved department that has since been archived stays choosable, so opening
  // and saving an old meeting never silently drops it.
  const choices = departments.filter((d) => isActive(d) || d.key === meeting?.subteam_key)
  // Warn about a date the person has just picked, not about a past meeting they
  // are only adding minutes to.
  const pastDate = heldOn !== (meeting?.held_on ?? '') && isPastDay(heldOn)
  const [agenda, setAgenda] = useState(meeting ? (meeting.agenda ?? '') : template)
  const [notes, setNotes] = useState(meeting?.notes ?? '')
  // Who came is a tick list. What was ticked before is only replaced when the person ticks something here, so
  // saving before the list has loaded can never wipe it. The old free-text line is kept as it was.
  const members = useMembers().data ?? []
  const attendance = useMeetingAttendance()
  const saved = useMemo(() => new Set(meeting ? (attendance.data?.get(meeting.id) ?? []) : []), [attendance.data, meeting])
  const [ticked, setTicked] = useState<Set<string> | null>(null)
  const present = ticked ?? saved
  const people = members
    .filter((m) => m.status !== 'alumni' || saved.has(m.id))
    .map((m) => ({ id: m.id, name: m.status === 'alumni' ? `${m.full_name} (retired)` : m.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const attendanceLoading = meeting !== null && attendance.isPending
  const [errors, setErrors] = useState<Errors>({})
  const fieldId = (name: string) => `${titleId}-${name}`

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return

    const found: Errors = {}
    if (title.trim() === '') found.title = 'Give the meeting a name.'
    if (heldOn === '') found.heldOn = 'A meeting needs a date.'
    // The database checks this too (meetings_ends_after_starts).
    if (endsAt !== '' && startsAt !== '' && endsAt <= startsAt) {
      found.endsAt = 'The end must be after the start.'
    }

    const firstBad = found.title ? 'title' : found.heldOn ? 'held-on' : found.endsAt ? 'ends-at' : null
    if (firstBad) {
      // Render the messages before moving focus, or focus lands on a field
      // whose error has not been painted yet.
      flushSync(() => setErrors(found))
      document.getElementById(fieldId(firstBad))?.focus()
      return
    }

    setErrors({})
    onSubmit(
      {
        title: title.trim(),
        heldOn,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        location: location.trim() || null,
        subteamKey: subteamKey || null,
        agenda: agenda.trim() || null,
        notes: notes.trim() || null,
        attendees: meeting?.attendees ?? null,
      },
      ticked ? [...ticked] : null,
    )
  }

  const field =
    'mt-1 min-h-11 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
  const label = 'block text-xs font-medium text-slate-600'

  return (
    <form onSubmit={submit} noValidate>
      <h2 id={titleId} className="text-base font-semibold text-balance text-slate-900">
        {meeting ? 'Edit meeting' : 'New meeting'}
      </h2>

      <fieldset className="mt-3 grid gap-3" disabled={pending}>
        <legend className="sr-only">Meeting details</legend>

        <div>
          <label className={label} htmlFor={fieldId('title')}>
            Name
          </label>
          <input
            id={fieldId('title')}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? fieldId('title-error') : undefined}
            placeholder="Weekly build meeting"
            className={field}
          />
          {errors.title && (
            <p id={fieldId('title-error')} className="mt-1 text-xs text-red-700">
              {errors.title}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor={fieldId('held-on')}>
              Date
            </label>
            <input
              id={fieldId('held-on')}
              name="held_on"
              type="date"
              value={heldOn}
              onChange={(e) => setHeldOn(e.target.value)}
              aria-invalid={errors.heldOn ? true : undefined}
              aria-describedby={errors.heldOn ? fieldId('held-on-error') : undefined}
              className={field}
            />
            {errors.heldOn && (
              <p id={fieldId('held-on-error')} className="mt-1 text-xs text-red-700">
                {errors.heldOn}
              </p>
            )}
            {pastDate && !errors.heldOn && (
              <p role="status" data-testid="past-date-warning" className="mt-1 text-xs text-amber-900">
                That day has already passed. You can still save it, for example to record a meeting that took place. Nobody is notified for a past date.
              </p>
            )}
          </div>
          <div>
            <label className={label} htmlFor={fieldId('starts-at')}>
              Starts (optional)
            </label>
            <input
              id={fieldId('starts-at')}
              name="starts_at"
              type="time"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor={fieldId('ends-at')}>
              Ends (optional)
            </label>
            <input
              id={fieldId('ends-at')}
              name="ends_at"
              type="time"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-invalid={errors.endsAt ? true : undefined}
              aria-describedby={errors.endsAt ? fieldId('ends-at-error') : undefined}
              className={field}
            />
            {errors.endsAt && (
              <p id={fieldId('ends-at-error')} className="mt-1 text-xs text-red-700">
                {errors.endsAt}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className={label} htmlFor={fieldId('location')}>
            Where (optional)
          </label>
          <input
            id={fieldId('location')}
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Workshop, or a link"
            className={field}
          />
        </div>

        <div>
          <label className={label} htmlFor={fieldId('subteam')}>
            For (optional)
          </label>
          <select
            id={fieldId('subteam')}
            name="subteam_key"
            value={subteamKey}
            onChange={(e) => setSubteamKey(e.target.value)}
            aria-describedby={fieldId('subteam-note')}
            className={field}
          >
            <option value="">The whole club</option>
            {choices.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
                {isActive(d) ? '' : ' (archived)'}
              </option>
            ))}
          </select>
          <p id={fieldId('subteam-note')} className="mt-1 text-xs text-slate-600">
            A department is told in its inbox, together with its Head. On the whole club, every member is told.
          </p>
        </div>

        <RichTextField
          id={fieldId('agenda')}
          label="Agenda"
          value={agenda}
          onChange={setAgenda}
          size="large"
          disabled={pending}
          note={meeting ? undefined : 'Started from the club’s default agenda; changes here are for this meeting only.'}
        />

        <RichTextField
          id={fieldId('notes')}
          label="Minutes (optional)"
          value={notes}
          onChange={setNotes}
          size="medium"
          disabled={pending}
          placeholder="What was decided, and who took what away."
        />

        {attendanceLoading ? (
          <p role="status" className="text-xs text-slate-600">
            Loading who came…
          </p>
        ) : (
          <AttendanceChecklist people={people} present={present} onChange={setTicked} />
        )}
        {meeting?.attendees && (
          <p className="text-xs text-slate-600" data-testid="legacy-attendees">
            Written before the tick list: {meeting.attendees}
          </p>
        )}
      </fieldset>

      <ActionError error={error} className="mt-3" />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonSecondary} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={pending}>
          {pending ? 'Saving…' : meeting ? 'Save changes' : 'Add meeting'}
        </button>
      </div>
    </form>
  )
}
