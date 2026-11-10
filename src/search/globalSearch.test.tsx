import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => ({ data: [] as unknown[], error: null as Error | null, fetching: false, asked: [] as string[] }))
vi.mock('../data/useGlobalSearch.ts', () => ({
  MIN_TERM: 2,
  useGlobalSearch: (text: string) => {
    search.asked.push(text)
    return { term: text.trim(), result: { data: search.data, error: search.error, isFetching: search.fetching } }
  },
}))

const { GlobalSearch } = await import('./GlobalSearch.tsx')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}
function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <GlobalSearch />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  search.data = []
  search.error = null
  search.fetching = false
  search.asked = []
})

describe('GlobalSearch', () => {
  it('shows nothing until two letters are typed', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox', { name: 'Search the whole site' }), 'b')
    expect(screen.queryByTestId('global-search-results')).not.toBeInTheDocument()
  })

  it('shows each hit with its title, the words around the match, “…” where the text goes on, and its page', async () => {
    search.data = [
      { key: 'task-1', title: 'Fix the brake lever', text: `${'Long preamble about the bike. '.repeat(4)}The brake pad is worn and needs to be replaced before the next race weekend at the track.`, page: 'Board', to: '/board?task=1' },
    ]
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'brake')
    const hit = within(screen.getByTestId('global-search-results')).getByRole('link')
    expect(within(hit).getByText('Fix the brake lever')).toBeInTheDocument()
    expect(within(hit).getByText('Board')).toBeInTheDocument()
    expect(within(hit).getByText('brake', { selector: 'mark' })).toBeInTheDocument()
    expect(hit.textContent).toContain('…')
  })

  it('goes to the hit, then closes and empties itself', async () => {
    search.data = [{ key: 'a-1', title: 'Workshop', text: 'Closed Monday', page: 'Announcements', to: '/inbox?announcements=1&announcement=1' }]
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'closed')
    await user.click(screen.getByRole('link', { name: /Workshop/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/inbox?announcements=1&announcement=1')
  })

  it('says when nothing matches, when it is still looking, and when it fails', async () => {
    const user = userEvent.setup()
    renderSearch()
    const box = screen.getByRole('searchbox')
    await user.type(box, 'zzz')
    expect(screen.getByText('Nothing found for “zzz”.')).toBeInTheDocument()
    search.fetching = true
    await user.type(box, 'z')
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    search.fetching = false
    search.error = new Error('offline')
    await user.type(box, 'z')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not search: offline')
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'zzz')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('global-search-results')).not.toBeInTheDocument()
  })
})
