import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PasswordInput } from './PasswordInput.tsx'

function Field({ onSubmit = () => {}, disabled = false }: { onSubmit?: () => void; disabled?: boolean }) {
  const [value, setValue] = useState('')
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
      <label htmlFor="pw">Password</label>
      <PasswordInput id="pw" value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} className="block w-full" />
    </form>
  )
}

describe('PasswordInput', () => {
  it('hides the password until the eye is pressed, then hides it again', async () => {
    const user = userEvent.setup()
    render(<Field />)
    const input = screen.getByLabelText('Password')
    await user.type(input, 'hunter22')
    expect(input).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('hunter22')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('is not a submit button: pressing the eye does not send the form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Field onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    render(<Field />)
    await user.tab() // the field
    await user.tab() // the eye
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
  })

  it('keeps the caller’s classes and leaves room for the eye', () => {
    render(<Field />)
    expect(screen.getByLabelText('Password')).toHaveClass('block', 'w-full', 'pr-10')
  })

  it('disables the eye together with the field', () => {
    render(<Field disabled />)
    expect(screen.getByLabelText('Password')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })

  it('does not put the icon in the accessible name', () => {
    render(<Field />)
    expect(screen.getByRole('button', { name: 'Show password' }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
