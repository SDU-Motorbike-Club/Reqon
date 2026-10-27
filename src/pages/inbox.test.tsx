import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: number; member_id: string; activity_id: number; season_id: string | null; kind: string; entity: string
  entity_id: string; actor_id: string | null; title: string | null; created_at: string; read_at: string | null
}
const state = vi.hoisted(() => ({ rows: [] as Row[], marked: [] as unknown[], loading: false, error: null as Error | null }))

vi.mock('../data/useNotifications.ts', () => ({
  INBOX_SIZE: 50,
  useNotifications: () => ({ data: state.rows, isLoading: state.loading, error: state.error, refetch: () => {} }),
  useMarkNotificationsRead: () => ({ mutate: (v: unknown) => state.marked.push(v), isPending: false, error: null }),
}))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({ data: [{ id: 'm1', full_name: 'Ada Rider' }, { id: 'm2', full_name: 'Bo Wrench' }] }),
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

  it('opening one already read marks nothing', async () => {
    state.rows = [row(8, 'proposal_promoted', { entity: 'proposal', read_at: '2026-10-23T10:00:00Z' })]
    const user = userEvent.setup()
    renderInbox()
    await user.click(screen.getByTestId('notification-8'))
    expect(state.marked).toEqual([])
    expect(screen.getByTestId('where')).toHaveTextContent('/proposals?scope=mine&view=history')
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
