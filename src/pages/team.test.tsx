import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  status: 'active' as 'active' | 'trial' | 'alumni',
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
const tool = (id: string, item: string, owner_id: string, location = 'workshop', held_by: string | null = null, shared = false) => ({ id, item, location, held_by, owner_id, shared })

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
  it('lists tools under the place they are in, so anyone can see where each one is', () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop'), tool('2', 'Torque wrench', 'me', 'home', 'me'), tool('3', 'Multimeter', 'bo', 'university', 'old')]
    renderAt()
    expect(within(screen.getByTestId('tools-at-workshop')).getByText('Jack')).toBeInTheDocument()
    expect(within(screen.getByTestId('tools-at-home')).getByText('Torque wrench')).toBeInTheDocument()
    expect(within(screen.getByTestId('tools-at-university')).getByText('Multimeter')).toBeInTheDocument()
    expect(within(screen.getByTestId('tools-at-workshop')).queryByText('Multimeter')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tools-at-other')).not.toBeInTheDocument()
  })

  it('says whose each tool is: a club tool, mine, or the owner\'s name, and who has it', () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null, true), tool('2', 'Torque wrench', 'me', 'workshop', 'me'), tool('3', 'Multimeter', 'bo', 'workshop', 'old')]
    renderAt()
    expect(within(screen.getByTestId('tool-1')).getByText('Club tool')).toBeInTheDocument()
    expect(within(screen.getByTestId('tool-2')).getByText('Mine')).toBeInTheDocument()
    expect(within(screen.getByTestId('tool-3')).getByText('Bo Wrench')).toBeInTheDocument()
    expect(screen.getByTestId('tool-holder-1')).toHaveTextContent('nobody')
    expect(screen.getByTestId('tool-holder-2')).toHaveTextContent('You')
    expect(screen.getByTestId('tool-holder-3')).toHaveTextContent('Cy Alum')
  })

  it('finds a tool by its name, its owner, who has it, where it is or "club tool"', async () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null, true), tool('2', 'Torque wrench', 'me', 'home', 'me'), tool('3', 'Multimeter', 'bo', 'university', 'old')]
    const user = userEvent.setup()
    renderAt()
    const find = screen.getByLabelText('Find a tool')
    await user.type(find, 'torq')
    expect(screen.getByTestId('tool-2')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-1')).not.toBeInTheDocument()
    await user.clear(find)
    await user.type(find, 'alum')
    expect(screen.getByTestId('tool-3')).toBeInTheDocument()
    await user.clear(find)
    await user.type(find, 'club tool')
    expect(screen.getByTestId('tool-1')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-3')).not.toBeInTheDocument()
    await user.clear(find)
    await user.type(find, 'nothing like this')
    expect(screen.getByText('No tool matches')).toBeInTheDocument()
  })

  it('takes a free tool in one tap, and gives it back in one tap', async () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null), tool('2', 'Torque wrench', 'bo', 'home', 'me')]
    const user = userEvent.setup()
    renderAt()
    await user.click(within(screen.getByTestId('tool-1')).getByRole('button', { name: 'I have it' }))
    await user.click(within(screen.getByTestId('tool-2')).getByRole('button', { name: 'Give back' }))
    expect(state.updated).toEqual([{ id: '1', heldBy: 'me' }, { id: '2', heldBy: null }])
  })

  it('opens the owner\'s tool in a side sheet to change where it is and who has it, as two separate things', async () => {
    state.tools = [tool('2', 'Torque wrench', 'me', 'workshop', null)]
    const user = userEvent.setup()
    renderAt()
    expect(screen.queryByLabelText('Where is Torque wrench')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Torque wrench' }))
    await user.selectOptions(screen.getByLabelText('Where is Torque wrench'), 'home')
    await user.selectOptions(screen.getByLabelText('Who has Torque wrench'), 'bo')
    expect(state.updated).toEqual([{ id: '2', location: 'home' }, { id: '2', heldBy: 'bo' }])
    await user.selectOptions(screen.getByLabelText('Who has Torque wrench'), '')
    expect(state.updated.at(-1)).toEqual({ id: '2', heldBy: null })
  })

  it('lets any full member take a free tool, and edit it, whoever owns it', async () => {
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null)]
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: 'I have it' }))
    expect(state.updated).toEqual([{ id: '1', heldBy: 'me' }])
    await user.click(screen.getByRole('button', { name: 'Edit Jack' }))
    expect(screen.getByLabelText('Where is Jack')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Jack' })).not.toBeInTheDocument()
  })

  it('lets any full member change a tool another member has, rename it, and hand it to someone else', async () => {
    state.tools = [tool('3', 'Multimeter', 'bo', 'university', 'old')]
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: 'Edit Multimeter' }))
    await user.selectOptions(screen.getByLabelText('Where is Multimeter'), 'workshop')
    await user.selectOptions(screen.getByLabelText('Who has Multimeter'), 'bo')
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Fluke multimeter')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(state.updated).toEqual([{ id: '3', location: 'workshop' }, { id: '3', heldBy: 'bo' }, { id: '3', item: 'Fluke multimeter' }])
  })

  it('lets a member on trial see where everything is, and list their own tool, but not change any', () => {
    state.status = 'trial'
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null), tool('2', 'Torque wrench', 'me', 'home', 'me')]
    renderAt()
    expect(screen.getByTestId('tools-at-workshop')).toHaveTextContent('Jack')
    expect(screen.getByTestId('tools-add-open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I have it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Give back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })

  it('lists a tool as the member\'s own by default, from a dialog, and asks for a name first', async () => {
    const user = userEvent.setup()
    renderAt()
    expect(screen.queryByRole('form', { name: 'Add a tool' })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('tools-add-open'))
    const form = within(screen.getByRole('form', { name: 'Add a tool' }))
    expect(form.queryByLabelText('List it for')).not.toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(screen.getByText('Name the tool.')).toBeInTheDocument()
    expect(state.added).toEqual([])
    await user.type(form.getByLabelText('Tool'), '  Cordless drill ')
    await user.selectOptions(form.getByLabelText('Where it is'), 'home')
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(state.added).toEqual([{ item: 'Cordless drill', location: 'home', heldBy: null }])
  })

  it('lets the person listing it say it is a club tool, from a dropdown', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByTestId('tools-add-open'))
    const form = within(screen.getByRole('form', { name: 'Add a tool' }))
    const kind = form.getByLabelText('Whose tool is it')
    expect(within(kind).getByRole('option', { name: 'My own tool' })).toBeInTheDocument()
    await user.type(form.getByLabelText('Tool'), 'Workshop vise')
    await user.selectOptions(kind, 'club')
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(state.added).toEqual([{ item: 'Workshop vise', location: 'workshop', heldBy: null, shared: true }])
  })

  it('moves a tool, and removes it only after a second click', async () => {
    state.tools = [tool('2', 'Torque wrench', 'me')]
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: 'Edit Torque wrench' }))
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
    await user.click(screen.getByRole('button', { name: 'Edit Jack' }))
    expect(screen.getByLabelText('Where is Jack')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(screen.getByTestId('tools-add-open'))
    const form = within(screen.getByRole('form', { name: 'Add a tool' }))
    await user.type(form.getByLabelText('Tool'), 'Club vise')
    await user.selectOptions(form.getByLabelText('List it for'), 'bo')
    await user.click(form.getByRole('button', { name: 'Add tool' }))
    expect(state.added).toEqual([{ item: 'Club vise', location: 'workshop', heldBy: null, ownerId: 'bo' }])
  })

  it('offers an admin every active member as owner, and no retired one', async () => {
    state.admin = true
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByTestId('tools-add-open'))
    const owner = screen.getByLabelText('List it for')
    expect(within(owner).queryByRole('option', { name: 'Cy Alum' })).not.toBeInTheDocument()
    expect(within(owner).getByRole('option', { name: 'Bo Wrench' })).toBeInTheDocument()
  })

  it('is read-only for a retired member, who still sees where everything is', () => {
    state.status = 'alumni'
    state.tools = [tool('1', 'Jack', 'bo', 'workshop', null), tool('2', 'Torque wrench', 'me')]
    renderAt()
    expect(screen.getByTestId('tools-at-workshop')).toHaveTextContent('Jack')
    expect(screen.queryByTestId('tools-add-open')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I have it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Torque wrench' })).not.toBeInTheDocument()
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
