import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ change: vi.fn(), done: vi.fn(), cancel: vi.fn() }))
vi.mock('../auth/changeLogin.ts', () => ({ changeLogin: mocks.change }))

const { ChangeLoginForm } = await import('./ChangeLoginForm.tsx')

const setup = () => render(<ChangeLoginForm currentEmail="cla@club.test" onDone={mocks.done} onCancel={mocks.cancel} />)

beforeEach(() => {
  mocks.change.mockReset()
  mocks.change.mockImplementation(async () => {})
  mocks.done.mockReset()
  mocks.cancel.mockReset()
})

describe('ChangeLoginForm (the Email row)', () => {
  it('opens on the new email with the cursor in it, and cannot be saved until both fields are filled', () => {
    setup()
    expect(screen.getByLabelText('New email')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save new email' })).toBeDisabled()
  })

  it('saves, and tells the row what to sign in with from now on', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('New email'), '  new@club.test ')
    await user.type(screen.getByLabelText('Your password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Save new email' }))
    expect(mocks.change).toHaveBeenCalledWith({ currentPassword: 'secret123', newEmail: 'new@club.test' })
    await waitFor(() => expect(mocks.done).toHaveBeenCalledWith('Email changed. Sign in with new@club.test from now on; your password is the same.'))
  })

  it('puts a wrong password next to the password and keeps what was typed', async () => {
    mocks.change.mockImplementation(async () => {
      throw new Error('That isn’t your current password.')
    })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('New email'), 'new@club.test')
    await user.type(screen.getByLabelText('Your password'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Save new email' }))
    await waitFor(() => expect(screen.getByLabelText('Your password')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('That isn’t your current password.')).toBeInTheDocument()
    expect(screen.getByLabelText('New email')).toHaveValue('new@club.test')
    expect(mocks.done).not.toHaveBeenCalled()
  })

  it('refuses the address you already have without asking the server, and shows a taken one next to the email', async () => {
    mocks.change.mockImplementation(async () => {
      throw new Error('Another account already uses that e-mail.')
    })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your password'), 'secret123')
    await user.type(screen.getByLabelText('New email'), 'CLA@club.test')
    await user.click(screen.getByRole('button', { name: 'Save new email' }))
    expect(screen.getByText('That is already your email.')).toBeInTheDocument()
    expect(mocks.change).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('New email'))
    await user.type(screen.getByLabelText('New email'), 'taken@club.test')
    await user.click(screen.getByRole('button', { name: 'Save new email' }))
    await waitFor(() => expect(screen.getByLabelText('New email')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('Another account already uses that e-mail.')).toBeInTheDocument()
  })

  it('Cancel hands control back to the row', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.cancel).toHaveBeenCalled()
  })
})
