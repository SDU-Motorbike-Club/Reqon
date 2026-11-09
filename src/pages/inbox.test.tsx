import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: number; member_id: string; activity_id: number; season_id: string | null; kind: string; entity: string
  entity_id: string; actor_id: string | null; title: string | null; created_at: string; read_at: string | null
  body?: string | null
}
type Past = { id: number; author_id: string | null; title: string | null; body: string; created_at: string }
const state = vi.hoisted(() => ({
  rows: [] as Row[], marked: [] as unknown[], loading: false, error: null as Error | null,
  canAnnounce: false, past: [] as Past[], sentAnnouncements: [] as { title: string; body: string }[],
}))

vi.mock('../data/useNotifications.ts', () => ({
  INBOX_SIZE: 50,
  useNotifications: () => ({ data: state.rows, isLoading: state.loading, error: state.error, refetch: () => {} }),
  useMarkNotificationsRead: () => ({ mutate: (v: unknown) => state.marked.push(v), isPending: false, error: null }),
}))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({
    data: [
      { id: 'm1', full_name: 'Ada Rider', status: 'active' },
      { id: 'm2', full_name: 'Bo Wrench', status: 'active' },
      { id: 'm3', full_name: 'Cy Old', status: 'alumni' },
      { id: 'm4', full_name: 'Di Trial', status: 'trial' },
    ],
  }),
}))
vi.mock('../auth/usePermissions.ts', () => ({ usePermissions: () => ({ canAnnounce: state.canAnnounce }) }))
vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'm1', status: 'active' } }) }))
vi.mock('../data/useAnnouncements.ts', () => ({
  ANNOUNCEMENT_TITLE_MAX: 100,
  ANNOUNCEMENT_MAX: 1000,
  HISTORY_SIZE: 100,
  useAnnouncements: () => ({ data: state.past, isPending: false, error: null, refetch: () => {} }),
  useSendAnnouncement: () => ({
    isPending: false,
    error: null,
    mutate: (v: { title: string; body: string }, options?: { onSuccess?: (n: number) => void }) => {
      state.sentAnnouncements.push(v)
      options?.onSuccess?.(2)
    },
  }),
}))

const { default: Inbox } = await import('./Inbox.tsx')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <Routes>
        <Route path="/inbox" element={<Inbox />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const row = (id: number, kind: string, extra: Partial<Row> = {}): Row => ({
  id, member_id: 'me', activity_id: id, season_id: 's1', kind, entity: 'task', entity_id: `t${id}`,
  actor_id: 'm1', title: `Thing ${id}`, created_at: '2026-10-24T09:00:00Z', read_at: null, ...extra,
})

beforeEach(() => {
  state.rows = []
  state.marked = []
  state.loading = false
  state.error = null
  state.canAnnounce = false
  state.past = []
  state.sentAnnouncements = []
})

describe('Inbox', () => {
  it('says what would appear when nothing needs you', () => {
    renderInbox()
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })

  it('puts new things first, in words, with who did them', () => {
    state.rows = [
      row(3, 'task_assigned'),
      row(2, 'review_requested', { entity: 'proposal', actor_id: 'm2' }),
      row(1, 'proposal_approved', { entity: 'proposal', read_at: '2026-10-23T10:00:00Z' }),
    ]
    renderInbox()
    const fresh = screen.getByRole('region', { name: 'New' })
    const texts = within(fresh).getAllByRole('link').map((a) => a.textContent ?? '')
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('New: Ada Rider gave you the task “Thing 3”.')
    expect(texts[1]).toContain('New: “Thing 2” waits for your review.')
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(earlier).getByRole('link')).toHaveTextContent('Ada Rider approved your proposal “Thing 1”.')
    expect(screen.getByText('2 new')).toBeInTheDocument()
  })

  it('opening a new one marks it read and goes where it is acted on', async () => {
    state.rows = [row(7, 'task_assigned')]
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByTestId('notification-7'))
    expect(state.marked).toEqual([{ id: 7 }])
    expect(screen.getByTestId('where')).toHaveTextContent('/board?task=t7')
  })

  it('shows a message from another member in full, and opening it goes to their profile to reply', async () => {
    state.rows = [row(9, 'message', { entity: 'member', entity_id: 'm2', actor_id: 'm2', title: null, body: 'Can you cover the Friday build?' })]
    const user = userEvent.setup()
    renderInbox()
    expect(screen.getByTestId('notification-9')).toHaveTextContent('Bo Wrench: Can you cover the Friday build?')
    expect(screen.getByTestId('notification-9')).toHaveAttribute('href', '/inbox?profile=m2')
    await user.click(screen.getByTestId('notification-9'))
    expect(state.marked).toEqual([{ id: 9 }])
  })

  it('opening one already read marks nothing', async () => {
    state.rows = [row(8, 'proposal_promoted', { entity: 'proposal', read_at: '2026-10-23T10:00:00Z' })]
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByTestId('notification-8'))
    expect(state.marked).toEqual([])
    expect(screen.getByTestId('where')).toHaveTextContent('/board?proposals=1&pscope=mine&view=history')
  })

  it('marks everything read at once', async () => {
    state.rows = [row(1, 'task_assigned'), row(2, 'task_blocked')]
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(state.marked).toEqual(['all'])
  })

  it('shows loading and failure as such, never as an empty inbox', () => {
    state.loading = true
    const { unmount } = renderInbox()
    expect(screen.getByRole('status')).toHaveTextContent('Loading your inbox…')
    expect(screen.queryByText('Nothing needs you right now')).not.toBeInTheDocument()
    unmount()
    state.loading = false
    state.error = new Error('offline')
    renderInbox()
    expect(screen.getByText('Could not load your inbox')).toBeInTheDocument()
  })
})

describe('Inbox announcements', () => {
  it('shows an announcement with its own label and sends its link to the history', () => {
    state.rows = [
      row(5, 'announcement', { entity: 'announcement', entity_id: '3', actor_id: 'm2', title: 'Workshop closed', body: 'Back on Monday.' }),
      row(4, 'task_assigned'),
    ]
    renderInbox()
    const announcement = screen.getByTestId('notification-5')
    expect(within(announcement).getByText('Announcement')).toBeInTheDocument()
    // The title is the headline, the description follows it, with the sender.
    expect(within(announcement).getByText('Workshop closed')).toHaveClass('font-semibold')
    expect(announcement).toHaveTextContent('Bo Wrench: Back on Monday.')
    expect(announcement).toHaveAttribute('href', '/inbox?announcements=1')
    // An ordinary notice carries no such label.
    expect(within(screen.getByTestId('notification-4')).queryByText('Announcement')).not.toBeInTheDocument()
  })

  it('offers everyone the history, even when the inbox is empty, and only the leadership the New button', () => {
    renderInbox()
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous announcements' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New announcement' })).not.toBeInTheDocument()
  })

  it('shows the New announcement button to someone who may send, in an empty inbox too', () => {
    state.canAnnounce = true
    renderInbox()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous announcements' })).toBeInTheDocument()
  })

  it('lists previous announcements, newest first as given, with who wrote them', async () => {
    state.past = [
      { id: 2, author_id: 'm2', title: 'Second title', body: 'Second one', created_at: '2026-11-02T09:00:00Z' },
      { id: 1, author_id: null, title: null, body: 'First one', created_at: '2026-11-01T09:00:00Z' },
    ]
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByRole('button', { name: 'Previous announcements' }))
    const history = within(screen.getByTestId('announce-history'))
    expect(history.getByTestId('announcement-2')).toHaveTextContent('Bo Wrench')
    expect(history.getByTestId('announcement-2')).toHaveTextContent('Second title')
    expect(history.getByTestId('announcement-2')).toHaveTextContent('Second one')
    expect(history.getByTestId('announcement-1')).toHaveTextContent('A former member')
    await user.click(history.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('announce-history')).not.toBeInTheDocument()
  })

  it('says so when there are no previous announcements', async () => {
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByRole('button', { name: 'Previous announcements' }))
    expect(screen.getByText('No announcements yet')).toBeInTheDocument()
  })

  it('sends the trimmed text to everyone but the author and retired members, and says how many it reached', async () => {
    state.canAnnounce = true
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByRole('button', { name: 'New announcement' }))
    const dialog = within(screen.getByTestId('announce-dialog'))
    // Bo (active) and Di (trial); not Ada (the author) and not Cy (retired).
    const send = dialog.getByRole('button', { name: 'Send to all 2 members' })
    expect(send).toBeDisabled()
    // Both a title and a description are needed.
    await user.type(dialog.getByLabelText('Title'), '  Workshop closed  ')
    expect(send).toBeDisabled()
    await user.type(dialog.getByLabelText('Description'), '  Back on Monday.  ')
    await user.click(send)
    expect(state.sentAnnouncements).toEqual([{ title: 'Workshop closed', body: 'Back on Monday.' }])
    expect(screen.getByRole('status')).toHaveTextContent('It reached 2 members.')
  })
})
