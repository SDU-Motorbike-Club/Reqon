import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; title: string; season_id: string; subteam_key: string | null; completed_at: string | null; archived_at: string | null }
const state = vi.hoisted(() => ({
  rows: undefined as unknown[] | undefined,
  error: null as Error | null,
  asked: [] as (string | undefined)[],
}))

vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'me' } }) }))
vi.mock('../data/useContributions.ts', () => ({
  useContributions: (id: string | undefined) => {
    state.asked.push(id)
    return { data: state.rows, error: state.error, refetch: () => {} }
  },
}))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({
    isPending: false,
    error: null,
    data: [
      { id: 'me', full_name: 'Ada Rider', status: 'active' },
      { id: 'bo', full_name: 'Bo Wrench', status: 'active' },
      { id: 'old', full_name: 'Cy Alum', status: 'alumni' },
    ],
  }),
}))
vi.mock('../data/useSeasons.ts', () => ({
  useSeasons: () => ({
    error: null,
    data: [
      { id: 's1', label: '2025-26', is_current: false },
      { id: 's2', label: '2026-27', is_current: true },
    ],
  }),
}))
vi.mock('../data/useSubteams.ts', () => ({
  useSubteams: () => ({ data: [{ key: 'chassis', name: 'Chassis' }, { key: 'electronics', name: 'Electronics' }] }),
}))

const { default: Contributions } = await import('./Contributions.tsx')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}
const renderAt = (url = '/contributions') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/contributions" element={<><Contributions /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )

const row = (id: string, season_id: string, over: Partial<Row> = {}): Row => ({
  id, title: `Task ${id}`, season_id, subteam_key: 'chassis', completed_at: '2026-10-01T10:00:00Z', archived_at: null, ...over,
})

beforeEach(() => {
  state.rows = []
  state.error = null
  state.asked = []
})

describe('Contributions', () => {
  it('opens on your own record', () => {
    renderAt()
    expect(screen.getByLabelText('Whose record')).toHaveValue('me')
    expect(state.asked.at(-1)).toBe('me')
    expect(screen.getByText('No finished tasks yet')).toBeInTheDocument()
    expect(screen.getByText(/Tasks you finish appear here/)).toBeInTheDocument()
  })

  it('groups finished tasks by season with a count per department', () => {
    state.rows = [row('a', 's2'), row('b', 's2', { subteam_key: 'electronics' }), row('c', 's1', { subteam_key: null })]
    renderAt()
    expect(screen.getByTestId('contribution-summary')).toHaveTextContent('Ada Rider finished 3 tasks across 2 seasons.')
    const current = within(screen.getByTestId('season-s2'))
    expect(current.getByRole('heading')).toHaveTextContent('2026-27 (current) · 2 tasks')
    expect(current.getByText('Chassis 1 · Electronics 1')).toBeInTheDocument()
    const earlier = within(screen.getByTestId('season-s1'))
    expect(earlier.getByRole('heading')).toHaveTextContent('2025-26 · 1 task')
    expect(earlier.getByText('No department 1')).toBeInTheDocument()
  })

  it('links a current-season task to the Board, an archived one to the Archive, and an older season to nothing', () => {
    state.rows = [row('live', 's2'), row('arch', 's2', { archived_at: '2026-10-05T00:00:00Z' }), row('old', 's1')]
    renderAt()
    expect(screen.getByRole('link', { name: 'Task live' })).toHaveAttribute('href', '/board?task=live')
    expect(screen.getByRole('link', { name: 'Task arch' })).toHaveAttribute('href', '/archive?tab=tasks&id=arch')
    expect(screen.queryByRole('link', { name: 'Task old' })).not.toBeInTheDocument()
    expect(screen.getByText('Task old')).toBeInTheDocument()
  })

  it('switches to someone else, keeps that in the address, and marks former members', async () => {
    state.rows = [row('a', 's2')]
    const user = userEvent.setup()
    renderAt()
    const select = screen.getByLabelText('Whose record')
    expect(within(select).getByRole('option', { name: 'Ada Rider (you)' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Cy Alum (former member)' })).toBeInTheDocument()
    await user.selectOptions(select, 'bo')
    expect(screen.getByTestId('where')).toHaveTextContent('/contributions?member=bo')
    expect(state.asked.at(-1)).toBe('bo')
    expect(screen.getByTestId('contribution-summary')).toHaveTextContent('Bo Wrench finished 1 task.')
    await user.selectOptions(select, 'me')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/contributions$/)
  })

  it('falls back to yourself for a name that is not on the roster', () => {
    renderAt('/contributions?member=nobody')
    expect(screen.getByLabelText('Whose record')).toHaveValue('me')
    expect(state.asked.at(-1)).toBe('me')
  })

  it('says it plainly when someone else has finished nothing', () => {
    renderAt('/contributions?member=bo')
    expect(screen.getByText('Bo Wrench has not finished a task that they own.')).toBeInTheDocument()
  })

  it('shows loading and failure as such, never as an empty record', () => {
    state.rows = undefined
    const { unmount } = renderAt()
    expect(screen.getByText('Loading the contribution record…')).toBeInTheDocument()
    expect(screen.queryByText('No finished tasks yet')).not.toBeInTheDocument()
    unmount()
    state.error = new Error('offline')
    renderAt()
    expect(screen.getByText('Could not load the contribution record')).toBeInTheDocument()
  })
})
