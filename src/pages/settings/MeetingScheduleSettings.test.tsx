import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The weekly-meeting section over mocked data hooks: what it shows from the saved schedule, what it refuses
// before anything is sent, and that skipping and restoring go through the hooks. Who may change the schedule
// is the database's (is_admin(), checked in supabase/tests/meeting_schedule_test.sql).
const state = vi.hoisted(() => ({
  schedule: null as Record<string, unknown> | null,
  occurrences: [] as Record<string, unknown>[],
  saved: [] as Record<string, unknown>[],
  skipped: [] as string[],
  restored: [] as string[],
  saveError: null as Error | null,
}))

vi.mock('../../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'me' } }) }))
vi.mock('../../data/useMeetingSchedule.ts', () => ({
  useMeetingSchedule: () => ({ data: state.schedule, isPending: false, error: null, refetch: vi.fn() }),
  useUpcomingOccurrences: () => ({ data: state.occurrences, isPending: false, error: null }),
  useSaveMeetingSchedule: () => ({
    isPending: false,
    error: state.saveError,
    mutate: (draft: Record<string, unknown>, options?: { onSuccess?: () => void }) => {
      state.saved.push(draft)
      if (!state.saveError) options?.onSuccess?.()
    },
  }),
  useSkipOccurrence: () => ({ isPending: false, error: null, mutate: (v: { occurrenceDate: string }) => state.skipped.push(v.occurrenceDate) }),
  useRestoreOccurrence: () => ({ isPending: false, error: null, mutate: (date: string) => state.restored.push(date) }),
}))

const { MeetingScheduleSettings } = await import('./MeetingScheduleSettings.tsx')
const { scheduleProblems } = await import('./meetingScheduleModel.ts')

const schedule = (over: Record<string, unknown> = {}) => ({
  id: true, enabled: true, weekday: 2, starts_at: '16:30:00', ends_at: null, title: 'Club meeting', location: null,
  lead_days: 7, timezone: 'Europe/Copenhagen', updated_at: '2026-10-27T10:00:00Z', updated_by: null, ...over,
})
const occurrence = (date: string, status: string, over: Record<string, unknown> = {}) => ({
  occurrence_date: date, status, meeting_id: status === 'created' ? 'm1' : null, held_on: status === 'created' ? date : null, ...over,
})

const renderIt = () => render(<MemoryRouter><MeetingScheduleSettings /></MemoryRouter>)

beforeEach(() => {
  state.schedule = schedule()
  state.occurrences = []
  state.saved = []
  state.skipped = []
  state.restored = []
  state.saveError = null
})

describe('the saved schedule', () => {
  it('shows Tuesday 16:30 as the club asked, with its time-zone note', () => {
    renderIt()
    expect(screen.getByLabelText('Day')).toHaveValue('2')
    expect(screen.getByLabelText('Starts')).toHaveValue('16:30')
    expect(screen.getByLabelText('Created days ahead')).toHaveValue(7)
    expect(screen.getByLabelText('Create the weekly meeting automatically')).toBeChecked()
    expect(screen.getByText(/Times are club time \(Copenhagen\)/)).toBeInTheDocument()
  })

  it('sends exactly what was changed, with the optional fields as null when empty', async () => {
    const user = userEvent.setup()
    renderIt()
    await user.selectOptions(screen.getByLabelText('Day'), '4')
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '  Thursday build  ')
    await user.type(screen.getByLabelText('Where (optional)'), 'Workshop')
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(state.saved).toEqual([
      { enabled: true, weekday: 4, startsAt: '16:30', endsAt: null, title: 'Thursday build', location: 'Workshop', leadDays: 7 },
    ])
    expect(await screen.findByTestId('meeting-schedule-saved')).toBeInTheDocument()
  })

  it('can be switched off', async () => {
    const user = userEvent.setup()
    renderIt()
    await user.click(screen.getByLabelText('Create the weekly meeting automatically'))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(state.saved[0]).toMatchObject({ enabled: false })
  })

  it('refuses an empty name, an end before the start and a lead time out of range, and sends nothing', async () => {
    const user = userEvent.setup()
    renderIt()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Ends (optional)'), '15:00')
    await user.clear(screen.getByLabelText('Created days ahead'))
    await user.type(screen.getByLabelText('Created days ahead'), '40')
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(screen.getByText('Give the meeting a name.')).toBeInTheDocument()
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument()
    expect(screen.getByText('Between 1 and 21 days.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(state.saved).toEqual([])
  })

  it('shows the real refusal when the database says no', async () => {
    state.saveError = new Error('You do not have permission to change the meeting schedule.')
    const user = userEvent.setup()
    renderIt()
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission')
    expect(screen.queryByTestId('meeting-schedule-saved')).not.toBeInTheDocument()
  })

  it('says when there is no schedule row at all', () => {
    state.schedule = null
    renderIt()
    expect(screen.getByText(/no meeting schedule on this database yet/)).toBeInTheDocument()
  })
})

describe('the coming meetings', () => {
  beforeEach(() => {
    state.occurrences = [
      occurrence('2026-11-03', 'created', { held_on: '2026-11-04' }),
      occurrence('2026-11-10', 'pending'),
      occurrence('2026-11-17', 'skipped'),
    ]
  })

  it('says what became of each: created (and moved), not created yet, skipped', () => {
    renderIt()
    expect(within(screen.getByTestId('occurrence-2026-11-03')).getByText(/Created, moved to Wed/)).toBeInTheDocument()
    expect(within(screen.getByTestId('occurrence-2026-11-03')).getByRole('link', { name: 'see it on Meetings' })).toHaveAttribute('href', '/meetings')
    expect(within(screen.getByTestId('occurrence-2026-11-10')).getByText(/Not created yet — it is created 7 days ahead/)).toBeInTheDocument()
    expect(within(screen.getByTestId('occurrence-2026-11-17')).getByText('Skipped')).toBeInTheDocument()
  })

  it('skips one that is not created yet, and brings a skipped one back; a created one has neither button', async () => {
    const user = userEvent.setup()
    renderIt()
    expect(within(screen.getByTestId('occurrence-2026-11-03')).queryByRole('button')).not.toBeInTheDocument()
    await user.click(within(screen.getByTestId('occurrence-2026-11-10')).getByRole('button', { name: /Skip this one/ }))
    await user.click(within(screen.getByTestId('occurrence-2026-11-17')).getByRole('button', { name: /Bring it back/ }))
    await waitFor(() => expect(state.skipped).toEqual(['2026-11-10']))
    expect(state.restored).toEqual(['2026-11-17'])
  })

  it('warns that nothing is created while the schedule is switched off', () => {
    state.schedule = schedule({ enabled: false })
    renderIt()
    expect(screen.getByText(/Automatic creation is switched off/)).toBeInTheDocument()
  })
})

describe('scheduleProblems', () => {
  const ok = { enabled: true, weekday: 2, startsAt: '16:30', endsAt: null, title: 'Club meeting', location: null, leadDays: 7 }
  it('accepts the seeded schedule and the edges of the lead time', () => {
    expect(scheduleProblems(ok)).toEqual({})
    expect(scheduleProblems({ ...ok, leadDays: 1 })).toEqual({})
    expect(scheduleProblems({ ...ok, leadDays: 21 })).toEqual({})
  })
  it('refuses 0, 22, a fraction and NaN', () => {
    for (const leadDays of [0, 22, 3.5, Number.NaN]) expect(scheduleProblems({ ...ok, leadDays }).leadDays).toBeDefined()
  })
  it('refuses an end equal to the start', () => {
    expect(scheduleProblems({ ...ok, endsAt: '16:30' }).endsAt).toBeDefined()
  })
})
