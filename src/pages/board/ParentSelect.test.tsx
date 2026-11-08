import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { tasks: [] as { id: string; title: string; parent_id: string | null }[], mutate: vi.fn(), error: null as Error | null }

vi.mock('../../data/useTasks.ts', () => ({ useTasks: () => ({ data: state.tasks }) }))
vi.mock('../../data/useTaskParent.ts', () => ({
  useSetTaskParent: () => ({ mutate: state.mutate, isPending: false, error: state.error }),
}))

const { ParentSelect } = await import('./ParentSelect.tsx')

const t = (id: string, title: string, parent_id: string | null = null) => ({ id, title, parent_id })

beforeEach(() => {
  state.mutate = vi.fn()
  state.error = null
  state.tasks = [t('shirts', 'Get club t-shirts'), t('website', 'Website'), t('design', 'Design shirts', 'shirts'), t('solo', 'Solo task')]
})

describe('ParentSelect', () => {
  it('offers only top-level tasks other than itself, and sets the chosen parent', async () => {
    const user = userEvent.setup()
    render(<ParentSelect task={{ id: 'solo', parent_id: null }} />)
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Not part of another task', 'Get club t-shirts', 'Website'])
    await user.selectOptions(screen.getByLabelText('Part of'), 'shirts')
    expect(state.mutate).toHaveBeenCalledWith({ id: 'solo', parentId: 'shirts' })
  })

  it('shows the current parent and can take the task out again', async () => {
    const user = userEvent.setup()
    render(<ParentSelect task={{ id: 'design', parent_id: 'shirts' }} />)
    expect(screen.getByLabelText('Part of')).toHaveValue('shirts')
    await user.selectOptions(screen.getByLabelText('Part of'), '')
    expect(state.mutate).toHaveBeenCalledWith({ id: 'design', parentId: null })
  })

  it('is disabled, with a reason, for a task that has subtasks of its own', () => {
    render(<ParentSelect task={{ id: 'shirts', parent_id: null }} />)
    expect(screen.getByLabelText('Part of')).toBeDisabled()
    expect(screen.getByText(/has subtasks, so it cannot be part of another task/)).toBeInTheDocument()
  })
})
