import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { AssigneePicker, MAX_ASSIGNEES } from './AssigneePicker.tsx'

const people = [
  { id: 'a', name: 'Ana Popescu' },
  { id: 'b', name: 'Ben Ionescu' },
  { id: 'c', name: 'Cat Ionescu' },
]

function Harness({ start = [], list = people, viewerId = null }: { start?: string[]; list?: typeof people; viewerId?: string | null }) {
  const [value, setValue] = useState<string[]>(start)
  return (
    <form onSubmit={(e) => { e.preventDefault(); document.title = 'submitted' }}>
      <AssigneePicker label="Assigned to" people={list} value={value} onChange={setValue} viewerId={viewerId} />
      <output data-testid="value">{value.join(',')}</output>
    </form>
  )
}

describe('AssigneePicker', () => {
  it('is a labelled group of checkboxes, one label each, with a search box', () => {
    render(<Harness />)
    expect(screen.getByRole('group', { name: 'Assigned to' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByRole('checkbox', { name: 'Ben Ionescu' })).not.toBeChecked()
  })

  it('ticks several people and keeps the order they were ticked in (the first leads)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('checkbox', { name: 'Cat Ionescu' }))
    await user.click(screen.getByRole('checkbox', { name: 'Ana Popescu' }))
    expect(screen.getByTestId('value')).toHaveTextContent('c,a')
    expect(screen.getByText('2 assigned')).toBeInTheDocument()
    expect(screen.getByText('— lead')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Cat Ionescu/ }))
    expect(screen.getByTestId('value')).toHaveTextContent(/^a$/)
  })

  it('narrows by every word typed, keeps ticked people ticked while hidden, and never submits the form on Enter', async () => {
    const user = userEvent.setup()
    document.title = ''
    render(<Harness start={['a']} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'ionescu ben{Enter}')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Ben Ionescu' })).toBeInTheDocument()
    expect(screen.getByText(/1 assigned \(1 not in this search\)/)).toBeInTheDocument()
    expect(screen.getByTestId('value')).toHaveTextContent('a')
    expect(document.title).not.toBe('submitted')
  })

  it('says so when nobody matches', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'zzz')
    expect(screen.getByText('No one matches “zzz”.')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('offers the signed-in member first, as "Me"', () => {
    render(<Harness viewerId="c" />)
    expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName('Me (Cat Ionescu)')
  })

  it('stops at the cap the database enforces', () => {
    const crowd = Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }))
    render(<Harness list={crowd} start={crowd.slice(0, MAX_ASSIGNEES).map((p) => p.id)} />)
    expect(screen.getByRole('checkbox', { name: `Member ${MAX_ASSIGNEES}` })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /^Member 0/ })).toBeEnabled()
  })
})
