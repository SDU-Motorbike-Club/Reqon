import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Importers: none (a test). It renders UsernameForm with the data hook and the auth context replaced; the usernames are
// synthetic, and nothing is written anywhere.
const mocks = vi.hoisted(() => ({ run: vi.fn(), retry: vi.fn(), done: vi.fn(), cancel: vi.fn(), error: null as Error | null, pending: false }))
vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', retry: mocks.retry }) }))
vi.mock('../data/useUsername.ts', () => ({
  useSetMyUsername: () => ({
    mutate: mocks.run,
    reset: () => {
      mocks.error = null
    },
    error: mocks.error,
    isPending: mocks.pending,
  }),
}))

const { UsernameForm } = await import('./UsernameForm.tsx')

const setup = (current: string | null = null) => render(<UsernameForm current={current} onDone={mocks.done} onCancel={mocks.cancel} />)

beforeEach(() => {
  mocks.run.mockReset()
  mocks.run.mockImplementation((_name: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.())
  mocks.retry.mockReset()
  mocks.done.mockReset()
  mocks.cancel.mockReset()
  mocks.error = null
  mocks.pending = false
})

describe('UsernameForm', () => {
  it('opens with the cursor in the box and Save off until there is a new name', () => {
    setup()
    expect(screen.getByLabelText('Username')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove username' })).not.toBeInTheDocument()
  })

  it('saves the name lower-cased and trimmed, refreshes who you are and tells the row', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Username'), '  Ada.Rider ')
    await user.click(screen.getByRole('button', { name: 'Save username' }))
    expect(mocks.run.mock.calls[0][0]).toBe('ada.rider')
    expect(mocks.retry).toHaveBeenCalled()
    expect(mocks.done).toHaveBeenCalledWith('Username saved. You can sign in with it now.')
  })

  it('explains a bad name as you type it and will not send it', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Username'), 'ab')
    expect(screen.getByText('Use at least 3 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Username'))
    await user.type(screen.getByLabelText('Username'), 'me@club.test')
    expect(screen.getByText(/can’t contain @/)).toBeInTheDocument()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('shows the server’s answer, such as a name that is taken, beside the box', async () => {
    mocks.run.mockImplementation(() => {
      mocks.error = new Error('That username is taken.')
    })
    const user = userEvent.setup()
    const view = setup()
    await user.type(screen.getByLabelText('Username'), 'ada.rider')
    await user.click(screen.getByRole('button', { name: 'Save username' }))
    view.rerender(<UsernameForm current={null} onDone={mocks.done} onCancel={mocks.cancel} />)
    await waitFor(() => expect(screen.getByText('That username is taken.')).toBeInTheDocument())
    expect(mocks.done).not.toHaveBeenCalled()
  })

  it('offers to remove the username you have, and removing is a save of nothing', async () => {
    const user = userEvent.setup()
    setup('ada.rider')
    expect(screen.getByLabelText('Username')).toHaveValue('ada.rider')
    expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove username' }))
    expect(mocks.run.mock.calls[0][0]).toBe('')
    expect(mocks.done).toHaveBeenCalledWith('Username removed.')
  })

  it('Cancel hands control back to the row', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.cancel).toHaveBeenCalled()
  })
})
