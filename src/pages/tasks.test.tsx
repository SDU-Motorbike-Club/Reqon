import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; title: string; state: string; priority: string; due_date: string | null; owner_name: string | null; department_name: string | null; milestone_name: string | null }
const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  total: 0,
  pending: false,
  error: null as Error | null,
  asked: [] as unknown[],
}))

vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'me', status: 'active' } }) }))
vi.mock('../data/useSubteams.ts', () => ({
  useSubteams: () => ({ data: [{ key: 'BODY', name: 'Bodywork', archived_at: null }, { key: 'OLD', name: 'Retired', archived_at: '2026-01-01' }] }),
}))
vi.mock('../data/useTaskList.ts', () => ({
  useTaskList: (list: unknown) => {
    state.asked.push(list)
    return { data: state.pending ? undefined : { rows: state.rows, total: state.total }, isPending: state.pending, error: state.error, refetch: () => {} }
  },
}))
vi.mock('../lib/dates.ts', async (orig) => ({ ...(await orig<typeof import('../lib/dates.ts')>()), todayIso: () => '2026-10-27' }))

const { default: Tasks } = await import('./Tasks.tsx')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}
const renderAt = (url = '/tasks') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tasks" element={<><Tasks /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, title: `Task ${id}`, state: 'todo', priority: 'normal', due_date: '2026-12-01', owner_name: 'Ada Rider', department_name: 'Bodywork', milestone_name: 'Team Plan', ...over,
})
const lastAsked = () => state.asked.at(-1) as Record<string, unknown>

beforeEach(() => {
  state.rows = [row('a'), row('b', { owner_name: null, department_name: null, due_date: null, priority: 'urgent' })]
  state.total = 2
  state.pending = false
  state.error = null
  state.asked = []
})

describe('Tasks list', () => {
  it('opens on the default order: soonest deadline first, open tasks only', () => {
    renderAt()
    expect(lastAsked()).toMatchObject({ sort: 'due', dir: 'asc', state: 'open', page: 1, q: '' })
    expect(screen.getByRole('columnheader', { name: /Deadline/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Owner/ })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByTestId('tasks-summary')).toHaveTextContent('Showing 1–2 of 2 tasks')
  })

  it('draws the rows with a link to the task, and says plainly what is missing', () => {
    renderAt()
    expect(screen.getByRole('link', { name: 'Task a' })).toHaveAttribute('href', '/board?task=a')
    const second = within(screen.getByTestId('task-row-b'))
    expect(second.getByText('unassigned')).toBeInTheDocument()
    expect(second.getByText('no deadline')).toBeInTheDocument()
    expect(second.getByText('Urgent')).toBeInTheDocument()
  })

  it('marks an overdue open task, and not a finished one', () => {
    state.rows = [row('late', { due_date: '2026-10-01' }), row('doneold', { due_date: '2026-10-01', state: 'done' })]
    renderAt()
    expect(within(screen.getByTestId('task-row-late')).getByText('(overdue)')).toBeInTheDocument()
    expect(within(screen.getByTestId('task-row-doneold')).queryByText('(overdue)')).not.toBeInTheDocument()
  })

  it('sorts the whole list by a heading, flips on the second click, and keeps it in the address', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByTestId('sort-title'))
    expect(screen.getByTestId('where')).toHaveTextContent('/tasks?sort=title&dir=asc')
    expect(lastAsked()).toMatchObject({ sort: 'title', dir: 'asc', page: 1 })
    expect(screen.getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'ascending')
    await user.click(screen.getByTestId('sort-title'))
    expect(screen.getByTestId('where')).toHaveTextContent('sort=title&dir=desc')
    expect(screen.getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'descending')
    await user.click(screen.getByTestId('sort-owner'))
    expect(screen.getByTestId('where')).toHaveTextContent('sort=owner&dir=asc')
  })

  it('opens from a shared link with the sort, filters and page it carries', () => {
    renderAt('/tasks?sort=owner&dir=desc&state=blocked&dept=BODY&q=brake&page=2')
    expect(lastAsked()).toMatchObject({ sort: 'owner', dir: 'desc', state: 'blocked', department: 'BODY', q: 'brake', page: 2 })
    expect(screen.getByLabelText('Search tasks')).toHaveValue('brake')
    expect(screen.getByLabelText('State')).toHaveValue('blocked')
    expect(screen.getByRole('columnheader', { name: /Owner/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('treats an unknown column as the default order', () => {
    renderAt('/tasks?sort=owner_id;drop%20table&dir=desc')
    expect(lastAsked()).toMatchObject({ sort: 'due', dir: 'asc' })
  })

  it('keeps the sort when a filter changes, and goes back to page 1', async () => {
    const user = userEvent.setup()
    renderAt('/tasks?sort=owner&dir=desc&page=3')
    await user.selectOptions(screen.getByLabelText('State'), 'done')
    expect(screen.getByTestId('where')).toHaveTextContent('sort=owner&dir=desc&state=done')
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=')
    await user.type(screen.getByLabelText('Search tasks'), 'fairing')
    expect(lastAsked()).toMatchObject({ sort: 'owner', dir: 'desc', q: 'fairing', page: 1 })
  })

  it('offers the filters, and clears them but not the sort', async () => {
    const user = userEvent.setup()
    renderAt('/tasks?sort=title&dir=asc&scope=mine&dept=none')
    expect(within(screen.getByLabelText('Department')).queryByRole('option', { name: 'Retired' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/tasks\?sort=title&dir=asc$/)
  })

  it('pages through the list', async () => {
    state.total = 60
    const user = userEvent.setup()
    renderAt('/tasks?page=2')
    expect(screen.getByTestId('tasks-summary')).toHaveTextContent('Showing 26–50 of 60 tasks')
    expect(screen.getByTestId('tasks-pages')).toHaveTextContent('Page 2 of 3')
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('page=3')
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('shows loading, failure and emptiness as themselves', () => {
    state.pending = true
    const { unmount } = renderAt()
    expect(screen.getByText('Loading the task list…')).toBeInTheDocument()
    unmount()
    state.pending = false
    state.error = new Error('offline')
    const second = renderAt()
    expect(screen.getByText('Could not load the task list')).toBeInTheDocument()
    second.unmount()
    state.error = null
    state.rows = []
    state.total = 0
    renderAt('/tasks?q=zzz')
    expect(screen.getByText('No tasks match')).toBeInTheDocument()
  })

  it('says so when a page is past the end', () => {
    state.rows = []
    state.total = 10
    renderAt('/tasks?page=9')
    expect(screen.getByText(/past the end of the list/)).toBeInTheDocument()
  })
})
