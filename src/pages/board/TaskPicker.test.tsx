import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { TaskRef } from '../../tasks/dependencies.ts'
import { TaskPicker } from './TaskPicker.tsx'

const ref = (id: string, title: string, subteam_key: string | null): TaskRef => ({
  id, title, state: 'todo', due_date: null, starts_on: null, subteam_key, archived_at: null,
})
const many = Array.from({ length: 30 }, (_, i) => ref(`t${i}`, `Task ${String(i).padStart(2, '0')}`, 'BODY'))
const dept = (key: string | null) => (key === 'BODY' ? 'Bodywork' : 'No department')

function Harness({ tasks = many }: { tasks?: TaskRef[] }) {
  const [value, setValue] = useState('')
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); document.title = 'submitted' }}>
        <TaskPicker id="p" label="Add a prerequisite" candidates={tasks} departmentName={dept} value={value} onChange={setValue} />
      </form>
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('TaskPicker', () => {
  it('shows a short list, never all of them, and says how many more there are', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('combobox', { name: 'Add a prerequisite' }))
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.getByText('Showing 8 of 30. Keep typing to narrow.')).toBeInTheDocument()
  })

  it('narrows as you type and picks with the keyboard without submitting a surrounding form', async () => {
    const user = userEvent.setup()
    document.title = ''
    render(<Harness />)
    const box = screen.getByRole('combobox', { name: 'Add a prerequisite' })
    await user.type(box, 'task 2')
    // 12 titles hold a "2"; 8 are shown, in title order: 02, 12, 20, …
    expect(screen.getAllByRole('option')).toHaveLength(8)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('t12')
    expect(box).toHaveValue('Task 12 — Bodywork')
    expect(document.title).toBe('')
  })

  it('closes on Escape, and typing after a choice drops the choice', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByRole('combobox', { name: 'Add a prerequisite' })
    await user.type(box, 'task 05')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('t5')
    await user.type(box, 'x')
    expect(screen.getByTestId('value')).toHaveTextContent(/^$/)
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox', { name: 'Add a prerequisite' }), 'zzz')
    expect(screen.getByText('No task matches “zzz”.')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
