import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  sendError: null as Error | null,
  reports: [] as Record<string, unknown>[],
  statusCalls: [] as unknown[],
  deleted: [] as string[],
}))

vi.mock('../data/useBugReports.ts', () => ({
  sendBugReport: async (r: Record<string, unknown>) => {
    if (state.sendError) throw state.sendError
    state.sent.push(r)
  },
  useSendBugReport: () => ({
    mutateAsync: async (r: Record<string, unknown>) => {
      if (state.sendError) throw state.sendError
      state.sent.push(r)
    },
    isPending: false,
    error: state.sendError,
  }),
  useBugReports: () => ({ data: state.reports, error: null, isPending: false, refetch: () => {} }),
  useSetBugStatus: () => ({ mutate: (v: unknown) => state.statusCalls.push(v), isPending: false, error: null }),
  useDeleteBugReport: () => ({ mutate: (id: string, o?: { onSettled?: () => void }) => { state.deleted.push(id); o?.onSettled?.() }, isPending: false, error: null }),
}))
vi.mock('../data/useMembers.ts', () => ({ useMembers: () => ({ data: [{ id: 'm1', full_name: 'Ada Rider' }] }) }))

const { DataError } = await import('../core/errors.ts')
const { BugReportProvider } = await import('./BugReportProvider.tsx')
const { useBugReport } = await import('./bugReportContext.ts')
const { ErrorState, ActionError } = await import('../ui/states.tsx')
const { BugReportsPanel } = await import('./BugReportsPanel.tsx')
const { ErrorBoundary } = await import('../ui/ErrorBoundary.tsx')

function Opener() {
  const report = useBugReport()
  return report ? <button onClick={() => report()}>Report a bug</button> : <span>no provider</span>
}

function withApp(node: React.ReactNode, path = '/board?task=x') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <BugReportProvider>{node}</BugReportProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.sent = []
  state.sendError = null
  state.reports = []
  state.statusCalls = []
  state.deleted = []
})

describe('the Report a bug dialog', () => {
  it('sends what the person wrote, with the page path and no query string, then says thank you', async () => {
    const user = userEvent.setup()
    withApp(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Report a bug' }))
    const form = within(screen.getByRole('form', { name: 'Report a bug' }))
    await user.type(form.getByLabelText(/What went wrong/), 'The card would not move')
    await user.click(form.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(state.sent).toHaveLength(1))
    expect(state.sent[0]).toMatchObject({ source: 'manual', message: 'The card would not move', details: null, page: '/board' })
    expect(await screen.findByTestId('bug-sent')).toHaveTextContent('A developer will see it')
  })

  it('asks for a sentence when there is no error attached, and sends nothing without one', async () => {
    const user = userEvent.setup()
    withApp(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Report a bug' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(screen.getByText('Say what went wrong.')).toBeInTheDocument()
    expect(state.sent).toEqual([])
  })

  it('keeps what was typed and shows the reason when sending fails', async () => {
    state.sendError = new Error('Too many reports in the last hour. Please wait a little.')
    const user = userEvent.setup()
    withApp(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Report a bug' }))
    await user.type(screen.getByLabelText(/What went wrong/), 'Still broken')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText(/Too many reports/)).toBeInTheDocument()
    expect(screen.getByLabelText(/What went wrong/)).toHaveValue('Still broken')
  })
})

describe('Report this problem on an error', () => {
  it('is offered on a load error, shows the error text that will be sent, and files it as an error report', async () => {
    const user = userEvent.setup()
    withApp(<ErrorState title="Could not load the board" error={new Error('offline')} onRetry={() => {}} />)
    await user.click(screen.getByTestId('report-problem'))
    expect(screen.getByTestId('bug-details')).toHaveTextContent('Error: offline')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(state.sent).toHaveLength(1))
    expect(state.sent[0]).toMatchObject({ source: 'error', message: '', details: 'Error: offline' })
  })

  it('is offered on a failed save, but not on a refusal because of who you are', () => {
    const { unmount } = withApp(<ActionError error={new Error('The save failed')} />)
    expect(screen.getByTestId('report-problem')).toBeInTheDocument()
    unmount()
    const refused = new DataError('change that', null, { permission: true })
    withApp(<ActionError error={refused} />)
    expect(screen.queryByTestId('report-problem')).not.toBeInTheDocument()
  })

  it('is not offered outside the signed-in app, where there is nobody to report to', () => {
    render(<ErrorState title="Could not load" error={new Error('x')} onRetry={() => {}} />)
    expect(screen.queryByTestId('report-problem')).not.toBeInTheDocument()
  })
})

describe('the crash screen', () => {
  it('sends the error to the developers from the screen itself', async () => {
    const user = userEvent.setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): never {
      throw new Error('render blew up')
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    await user.click(screen.getByTestId('crash-report'))
    await waitFor(() => expect(state.sent).toHaveLength(1))
    expect(state.sent[0]).toMatchObject({ source: 'error', message: '' })
    expect(String(state.sent[0].details)).toContain('render blew up')
    expect(await screen.findByText('Report sent')).toBeInTheDocument()
    log.mockRestore()
  })
})

describe('the Developer list in Settings', () => {
  const report = (id: string, over: Record<string, unknown> = {}) => ({
    id, created_at: '2026-10-28T12:30:00Z', reported_by: 'm1', source: 'manual', message: `Problem ${id}`, details: null,
    page: '/board', user_agent: 'Firefox', status: 'open', resolved_at: null, resolved_by: null, ...over,
  })

  it('is a button with the open count, and the list opens in an overlay, open reports first', async () => {
    state.reports = [report('a', { status: 'done' }), report('b'), report('c', { source: 'error', details: 'TypeError: x' })]
    const user = userEvent.setup()
    render(<BugReportsPanel />)
    expect(screen.getByTestId('bug-reports-open')).toHaveTextContent('Bug reports (2 open)')
    expect(screen.queryByTestId('bug-list')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('bug-reports-open'))
    const ids = within(screen.getByTestId('bug-list')).getAllByRole('listitem').map((li) => li.getAttribute('data-testid'))
    expect(ids).toEqual(['bug-b', 'bug-c', 'bug-a'])
    expect(screen.getByTestId('bug-b')).toHaveTextContent('Ada Rider')
    expect(screen.getByTestId('bug-b')).toHaveTextContent('28/10/26')
    expect(screen.getByTestId('bug-c')).toHaveTextContent('Error')
  })

  it('marks done and reopens, and deletes only after a second click', async () => {
    state.reports = [report('b'), report('a', { status: 'done' })]
    const user = userEvent.setup()
    render(<BugReportsPanel />)
    await user.click(screen.getByTestId('bug-reports-open'))
    await user.click(within(screen.getByTestId('bug-b')).getByRole('button', { name: 'Mark done' }))
    await user.click(within(screen.getByTestId('bug-a')).getByRole('button', { name: 'Reopen' }))
    expect(state.statusCalls).toEqual([{ id: 'b', status: 'done' }, { id: 'a', status: 'open' }])
    await user.click(within(screen.getByTestId('bug-b')).getByRole('button', { name: 'Delete' }))
    expect(state.deleted).toEqual([])
    await user.click(within(screen.getByTestId('bug-b')).getByRole('button', { name: 'Delete for good?' }))
    expect(state.deleted).toEqual(['b'])
  })

  it('says so when nobody has reported anything', async () => {
    const user = userEvent.setup()
    render(<BugReportsPanel />)
    await user.click(screen.getByTestId('bug-reports-open'))
    expect(screen.getByText('No bug reports')).toBeInTheDocument()
  })
})
