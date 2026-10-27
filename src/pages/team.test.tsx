import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  status: 'active' as 'active' | 'alumni',
  admin: false,
  tools: [] as Record<string, unknown>[] | undefined,
  error: null as Error | null,
  added: [] as unknown[],
  updated: [] as unknown[],
  removed: [] as string[],
}))

vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'me', status: state.status } }) }))
vi.mock('../auth/usePermissions.ts', () => ({ usePermissions: () => ({ canAddMembers: state.admin }) }))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({
    error: null,
    data: [
      { id: 'me', full_name: 'Ada Rider', status: 'active' },
      { id: 'bo', full_name: 'Bo Wrench', status: 'active' },
      { id: 'old', full_name: 'Cy Alum', status: 'alumni' },
    ],
  }),
}))
vi.mock('../data/useTeam.ts', () => ({
  useTools: () => ({ data: state.tools, error: state.error, isPending: state.tools === undefined, refetch: () => {} }),
  useAddTool: () => ({ mutateAsync: async (v: unknown) => { state.added.push(v) }, isPending: false, error: null }),
  useUpdateTool: () => ({ mutate: (v: unknown) => state.updated.push(v), isPending: false, error: null }),
  useRemoveTool: () => ({ mutate: (id: string, o?: { onSettled?: () => void }) => { state.removed.push(id); o?.onSettled?.() }, isPending: false, error: null }),
}))

const { default: Team } = await import('./Team.tsx')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}
const renderAt = (url = '/team') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/team" element={<><Team /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const tool = (id: string, item: string, owner_id: string, location = 'workshop', held_by: string | null = null) => ({ id, item, location, held_by, owner_id })

beforeEach(() => {
  state.status = 'active'
  state.admin = false
  state.tools = []
  state.error = null
  state.added = []
  state.updated = []
  state.removed = []
})

describe('Team', () => {
  it('lists tools by owner with yours first, and says where each is and who has it', () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null), tool('2', 'Torque wrench', 'me', 'home', 'me'), tool('3', 'Multimeter', 'bo', 'university', 'old')]
    renderAt()
    const mine = within(screen.getByTestId('tools-me'))
    expect(mine.getByRole('heading')).toHaveTextContent('Yours')
    expect(screen.getByTestId('tool-facts-2')).toHaveTextContent('Where: At home · Who has it: You')
    expect(screen.getByTestId('tool-facts-1')).toHaveTextContent('Where: In the workshop · Who has it: Nobody')
    expect(screen.getByTestId('tool-facts-3')).toHaveTextContent('Where: At the university · Who has it: Cy Alum')
    expect(within(screen.getByTestId('tools-bo')).getByRole('heading')).toHaveTextContent('Bo Wrench')
  })

  it('lets the owner change where it is and who has it, as two separate things', async () => {
    state.tools = [tool('2', 'Torque wrench', 'me', 'workshop', null)]
    const user = userEvent.setup()
    renderAt()
    await user.selectOptions(screen.getByLabelText('Where is Torque wrench'), 'home')
    await user.selectOptions(screen.getByLabelText('Who has Torque wrench'), 'bo')
    expect(state.updated).toEqual([{ id: '2', location: 'home' }, { id: '2', heldBy: 'bo' }])
    await user.selectOptions(screen.getByLabelText('Who has Torque wrench'), '')
    expect(state.updated.at(-1)).toEqual({ id: '2', heldBy: null })
  })

  it('offers someone else\'s tool nobody has as "I have it", and nothing else', async () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null)]
    const user = userEvent.setup()
    renderAt()
    expect(screen.queryByLabelText('Where is Jack')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Jack' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'I have it' }))
    expect(state.updated).toEqual([{ id: '1', heldBy: 'me' }])
  })

  it('lets whoever has it move it and hand it on, but not remove it, and offers no "I have it"', () => {
    state.tools = [tool('1', 'Jack', 'bo', 'home', 'me')]
    renderAt()
    expect(screen.getByLabelText('Where is Jack')).toBeInTheDocument()
    expect(screen.getByLabelText('Who has Jack')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I have it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Jack' })).not.toBeInTheDocument()
  })

  it('does not let someone else touch a tool another member has', () => {
    state.tools = [tool('3', 'Multimeter', 'bo', 'university', 'old')]
    renderAt()
    expect(screen.queryByLabelText('Where is Multimeter')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I have it' })).not.toBeInTheDocument()
  })

  it('adds a tool for yourself, and asks for a name first', async () => {
    const user = userEvent.setup()
    renderAt()
    const form = within(screen.getByRole('form', { name: 'Add a tool' }))
    expect(form.queryByLabelText('Whose it is')).not.toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(screen.getByText('Name the tool.')).toBeInTheDocument()
    expect(state.added).toEqual([])
    await user.type(form.getByLabelText('Tool'), '  Cordless drill ')
    await user.selectOptions(form.getByLabelText('Where it is'), 'home')
    await user.selectOptions(form.getByLabelText('Who has it'), 'me')
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(state.added).toEqual([{ item: 'Cordless drill', location: 'home', heldBy: 'me' }])
    expect(form.getByLabelText('Tool')).toHaveValue('')
  })

  it('moves a tool, and removes it only after a second click', async () => {
    state.tools = [tool('2', 'Torque wrench', 'me')]
    const user = userEvent.setup()
    renderAt()
    await user.selectOptions(screen.getByLabelText('Where is Torque wrench'), 'home')
    expect(state.updated).toEqual([{ id: '2', location: 'home' }])
    await user.click(screen.getByRole('button', { name: 'Remove Torque wrench' }))
    expect(state.removed).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Remove Torque wrench?' }))
    expect(state.removed).toEqual(['2'])
  })

  it('lets an admin list and change anyone\'s tool', async () => {
    state.admin = true
    state.tools = [tool('1', 'Jack', 'bo')]
    const user = userEvent.setup()
    renderAt()
    expect(screen.getByLabelText('Where is Jack')).toBeInTheDocument()
    const form = within(screen.getByRole('form', { name: 'Add a tool' }))
    await user.type(form.getByLabelText('Tool'), 'Club vise')
    await user.selectOptions(form.getByLabelText('Whose it is'), 'bo')
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(state.added).toEqual([{ item: 'Club vise', location: 'workshop', heldBy: null, ownerId: 'bo' }])
    expect(within(form.getByLabelText('Whose it is')).queryByRole('option', { name: 'Cy Alum' })).not.toBeInTheDocument()
  })

  it('is read-only for a retired member', () => {
    state.status = 'alumni'
    state.tools = [tool('2', 'Torque wrench', 'me')]
    renderAt()
    expect(screen.queryByRole('form', { name: 'Add a tool' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Where is Torque wrench')).not.toBeInTheDocument()
  })

  it('says so when no tool is listed, and shows a failure as such', () => {
    renderAt()
    expect(screen.getByText('No tools listed yet')).toBeInTheDocument()
  })

  it('shows a load failure as such, not as an empty list', () => {
    state.error = new Error('offline')
    renderAt()
    expect(screen.getByText('Could not load the tool list')).toBeInTheDocument()
    expect(screen.queryByText('No tools listed yet')).not.toBeInTheDocument()
  })
})
