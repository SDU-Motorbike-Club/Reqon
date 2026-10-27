import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutate = vi.fn()
vi.mock('../../data/useMilestones.ts', () => ({
  useSetMilestoneSubmission: () => ({ mutate, isPending: false, error: null }),
}))

const { SubmissionState } = await import('./SubmissionState.tsx')
const { todayIso } = await import('../../lib/dates.ts')

type M = Parameters<typeof SubmissionState>[0]['milestone']
const milestone = (patch: Record<string, unknown> = {}) =>
  ({ key: 'MS1-1', code: 'MS1-1', name: 'Team plan', submitted_on: null, submitted_by: null, accepted_on: null, accepted_by: null, ...patch }) as unknown as M

const view = (m: M) => <SubmissionState milestone={m} canRecord memberNames={new Map()} />

beforeEach(() => mutate.mockReset())

describe('SubmissionState', () => {
  it('shows submission and acceptance as separate facts (the work figure is the bar above)', () => {
    render(view(milestone({ submitted_on: '2026-09-01' })))
    expect(screen.queryByTestId('work-MS1-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('submitted-MS1-1')).not.toHaveTextContent('Not recorded')
    expect(screen.getByTestId('accepted-MS1-1')).toHaveTextContent('Not recorded')
  })

  it('starts a first record from today, and leaves acceptance empty', async () => {
    const user = userEvent.setup()
    render(view(milestone()))
    await user.click(screen.getByTestId('submission-edit-MS1-1'))
    expect(screen.getByLabelText('Submitted on')).toHaveValue(todayIso())
    expect(screen.getByLabelText('Accepted on')).toHaveValue('')
  })

  it('refuses to overwrite dates another person recorded while the form was open', async () => {
    const user = userEvent.setup()
    const { rerender } = render(view(milestone()))
    await user.click(screen.getByTestId('submission-edit-MS1-1'))
    await user.type(screen.getByLabelText('Submitted on'), '2026-09-02')
    rerender(view(milestone({ submitted_on: '2026-09-01' })))
    expect(screen.getByTestId('submission-changed-MS1-1')).toHaveTextContent('Someone else changed these dates')
    expect(screen.getByRole('button', { name: /^Save record for/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Show their dates' }))
    expect(screen.getByLabelText('Submitted on')).toHaveValue('2026-09-01')
    expect(screen.queryByTestId('submission-changed-MS1-1')).not.toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('offers no controls without authority', () => {
    render(<SubmissionState milestone={milestone()} canRecord={false} memberNames={new Map()} />)
    expect(screen.queryByTestId('submission-edit-MS1-1')).not.toBeInTheDocument()
  })
})
