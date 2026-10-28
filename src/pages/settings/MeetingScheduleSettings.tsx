import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/context.ts'
import {
  useMeetingSchedule,
  useRestoreOccurrence,
  useSaveMeetingSchedule,
  useSkipOccurrence,
  useUpcomingOccurrences,
  type MeetingSchedule,
  type MeetingScheduleDraft,
  type Occurrence,
} from '../../data/useMeetingSchedule.ts'
import { formatDay } from '../../lib/dates.ts'
import { buttonPrimary, buttonSecondary } from '../../ui/buttons.ts'
import { ActionError, ErrorState, LoadingState } from '../../ui/states.tsx'
import { scheduleProblems, type ScheduleProblems } from './meetingScheduleModel.ts'

// The weekly meeting that creates itself, and the weeks it is skipped. Only the President, Vice President
// and Developer reach this (the section is gated by canAdminister and the database checks is_admin()).
// A change applies to meetings that do not exist yet; a meeting already created keeps its own day, time and place.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const clock = (value: string | null) => (value ?? '').slice(0, 5)

const dayWithWeekday = (iso: string) => {
  const weekday = new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
  return `${weekday} ${formatDay(iso)}`
}

export function MeetingScheduleSettings() {
  const schedule = useMeetingSchedule()
  const occurrences = useUpcomingOccurrences()

  if (schedule.isPending) return <LoadingState label="Loading the meeting schedule…" />
  if (schedule.error) {
    return <ErrorState title="Could not load the meeting schedule" error={schedule.error} onRetry={() => void schedule.refetch()} />
  }
  if (!schedule.data) {
    return <p className="text-sm text-slate-600">There is no meeting schedule on this database yet. Apply the latest migrations.</p>
  }

  return (
    <div className="space-y-4">
      {/* Remounted when the saved row changes, so the form never shows a stale draft after a save. */}
      <ScheduleForm key={schedule.data.updated_at} schedule={schedule.data} />
      <Upcoming occurrences={occurrences.data ?? []} error={occurrences.error} loading={occurrences.isPending} enabled={schedule.data.enabled} leadDays={schedule.data.lead_days} />
    </div>
  )
}

function ScheduleForm({ schedule }: { schedule: MeetingSchedule }) {
  const auth = useAuth()
  const save = useSaveMeetingSchedule(auth.status === 'member' ? auth.member.id : null)
  const id = useId()
  const [enabled, setEnabled] = useState(schedule.enabled)
  const [weekday, setWeekday] = useState(schedule.weekday)
  const [startsAt, setStartsAt] = useState(clock(schedule.starts_at))
  const [endsAt, setEndsAt] = useState(clock(schedule.ends_at))
  const [title, setTitle] = useState(schedule.title)
  const [location, setLocation] = useState(schedule.location ?? '')
  const [leadDays, setLeadDays] = useState(String(schedule.lead_days))
  const [problems, setProblems] = useState<ScheduleProblems>({})
  const [saved, setSaved] = useState(false)

  const draft = (): MeetingScheduleDraft => ({
    enabled,
    weekday,
    startsAt,
    endsAt: endsAt || null,
    title: title.trim(),
    location: location.trim() || null,
    leadDays: Number(leadDays),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (save.isPending) return
    const found = scheduleProblems(draft())
    setProblems(found)
    setSaved(false)
    if (Object.keys(found).length > 0) return
    save.mutate(draft(), { onSuccess: () => setSaved(true) })
  }

  const field =
    'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
  const label = 'block text-xs font-medium text-slate-600'
  const err = (text?: string, key?: string) =>
    text ? (
      <p id={`${id}-${key}-error`} className="mt-1 text-xs text-red-700">
        {text}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="rounded-lg border border-slate-200 bg-surface p-3" data-testid="meeting-schedule-form">
      <fieldset disabled={save.isPending} className="grid gap-3">
        <legend className="sr-only">Weekly meeting</legend>

        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-900 sm:min-h-0">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 rounded border-slate-400" />
          Create the weekly meeting automatically
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor={`${id}-weekday`}>
              Day
            </label>
            <select id={`${id}-weekday`} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
              {WEEKDAYS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`${id}-starts`}>
              Starts
            </label>
            <input
              id={`${id}-starts`}
              type="time"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-invalid={problems.startsAt ? true : undefined}
              aria-describedby={problems.startsAt ? `${id}-startsAt-error` : undefined}
              className={field}
            />
            {err(problems.startsAt, 'startsAt')}
          </div>
          <div>
            <label className={label} htmlFor={`${id}-ends`}>
              Ends (optional)
            </label>
            <input
              id={`${id}-ends`}
              type="time"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-invalid={problems.endsAt ? true : undefined}
              aria-describedby={problems.endsAt ? `${id}-endsAt-error` : undefined}
              className={field}
            />
            {err(problems.endsAt, 'endsAt')}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <label className={label} htmlFor={`${id}-title`}>
              Name
            </label>
            <input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={problems.title ? true : undefined}
              aria-describedby={problems.title ? `${id}-title-error` : undefined}
              className={field}
            />
            {err(problems.title, 'title')}
          </div>
          <div>
            <label className={label} htmlFor={`${id}-where`}>
              Where (optional)
            </label>
            <input id={`${id}-where`} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Workshop, or a link" className={field} />
          </div>
          <div>
            <label className={label} htmlFor={`${id}-lead`}>
              Created days ahead
            </label>
            <input
              id={`${id}-lead`}
              type="number"
              min={1}
              max={21}
              inputMode="numeric"
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
              aria-invalid={problems.leadDays ? true : undefined}
              aria-describedby={problems.leadDays ? `${id}-leadDays-error` : undefined}
              className={field}
            />
            {err(problems.leadDays, 'leadDays')}
          </div>
        </div>
      </fieldset>

      <p className="mt-2 text-xs text-slate-600">
        Times are club time (Copenhagen). Every member is told in their inbox when a meeting is created, and it starts from the default
        agenda. A change here applies to meetings that are not created yet; one that already exists keeps its own day, time and place, so
        edit that meeting on the Meetings page instead.
      </p>

      <ActionError error={save.error} className="mt-2" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save schedule'}
        </button>
        {saved && (
          <p role="status" className="text-sm text-emerald-800" data-testid="meeting-schedule-saved">
            Schedule saved.
          </p>
        )}
      </div>
    </form>
  )
}

function Upcoming({
  occurrences,
  error,
  loading,
  enabled,
  leadDays,
}: {
  occurrences: Occurrence[]
  error: Error | null
  loading: boolean
  enabled: boolean
  leadDays: number
}) {
  const skip = useSkipOccurrence()
  const restore = useRestoreOccurrence()

  return (
    <section aria-label="Coming meetings" data-testid="meeting-occurrences">
      <h3 className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Coming meetings</h3>
      {!enabled && <p className="mt-1 text-xs text-amber-900">Automatic creation is switched off: nothing below is created until it is switched on again.</p>}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-700">
          Could not load the coming meetings: {error.message}
        </p>
      ) : loading ? (
        <p role="status" className="mt-1 text-xs text-slate-500">
          Loading…
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface">
          {occurrences.map((o) => {
            const moved = o.held_on && o.held_on !== o.occurrence_date
            return (
              <li key={o.occurrence_date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`occurrence-${o.occurrence_date}`}>
                <span className="text-slate-900">
                  {dayWithWeekday(o.occurrence_date)}
                  <span className="ml-2 text-xs text-slate-600">
                    {o.status === 'created' ? (
                      <>
                        Created{moved ? `, moved to ${dayWithWeekday(o.held_on as string)}` : ''} ·{' '}
                        <Link to="/meetings" className="underline underline-offset-2">
                          see it on Meetings
                        </Link>
                      </>
                    ) : o.status === 'skipped' ? (
                      'Skipped'
                    ) : (
                      `Not created yet — it is created ${leadDays} days ahead`
                    )}
                  </span>
                </span>
                {o.status === 'pending' && (
                  <button type="button" className={buttonSecondary} disabled={skip.isPending} onClick={() => skip.mutate({ occurrenceDate: o.occurrence_date })}>
                    Skip this one<span className="sr-only"> ({dayWithWeekday(o.occurrence_date)})</span>
                  </button>
                )}
                {o.status === 'skipped' && (
                  <button type="button" className={buttonSecondary} disabled={restore.isPending} onClick={() => restore.mutate(o.occurrence_date)}>
                    Bring it back<span className="sr-only"> ({dayWithWeekday(o.occurrence_date)})</span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ActionError error={skip.error ?? restore.error} className="mt-2" />
    </section>
  )
}
