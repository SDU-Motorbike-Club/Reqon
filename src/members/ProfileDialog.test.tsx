import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sent: [] as { to: string; body: string }[],
  email: 'ada@club.test' as string | null,
  emailError: null as Error | null,
  sendError: null as Error | null,
}))

vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'me', status: 'active' } }) }))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({
    isPending: false,
    data: [
      { id: 'me', full_name: 'Me Myself', role: 'Software', status: 'active', phone: '+40 700 000 000' },
      { id: 'm2', full_name: 'Ada Rider', role: 'Chassis', status: 'active', phone: '+40 711 111 111' },
      { id: 'm3', full_name: 'Cy Old', role: 'Software', status: 'alumni', phone: null },
    ],
  }),
}))
vi.mock('../data/useAvatars.ts', () => ({ useAvatars: () => ({ data: new Map<string, string>() }) }))
vi.mock('../data/useProfile.ts', () => ({
  MESSAGE_MAX: 1000,
  useMemberEmail: () => ({ data: state.email, isPending: false, error: state.emailError }),
  useSendMessage: () => ({
    isPending: false,
    error: state.sendError,
    mutate: (v: { to: string; body: string }, options?: { onSuccess?: () => void }) => {
      state.sent.push(v)
      if (!state.sendError) options?.onSuccess?.()
    },
  }),
}))

const { ProfileDialog } = await import('./ProfileDialog.tsx')
const { ProfileLink } = await import('./ProfileLink.tsx')

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ProfileLink memberId="m2">Ada Rider</ProfileLink>
      <ProfileDialog />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.sent = []
  state.email = 'ada@club.test'
  state.emailError = null
  state.sendError = null
})

describe('ProfileDialog', () => {
  it('is closed until a profile is asked for, and opens from a member name', async () => {
    renderAt('/board')
    expect(screen.queryByTestId('profile-dialog')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ada Rider' }))
    expect(screen.getByTestId('profile-dialog')).toBeInTheDocument()
  })

  it('shows the name, job title and the login email as a mail link, and no phone', () => {
    renderAt('/board?profile=m2')
    const dialog = within(screen.getByTestId('profile-dialog'))
    expect(dialog.getByRole('heading', { name: 'Ada Rider' })).toBeInTheDocument()
    expect(dialog.getByText('Chassis')).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'ada@club.test' })).toHaveAttribute('href', 'mailto:ada@club.test')
    expect(dialog.queryByText(/phone/i)).not.toBeInTheDocument()
    expect(dialog.queryByText(/711/)).not.toBeInTheDocument()
  })

  it('says so when the email cannot be read, instead of showing nothing', () => {
    state.emailError = new Error('boom')
    renderAt('/board?profile=m2')
    expect(screen.getByTestId('profile-email')).toHaveTextContent('Could not load the email.')
  })

  it('sends the trimmed message to that person and clears the box', async () => {
    const user = userEvent.setup()
    renderAt('/board?profile=m2')
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('Message to Ada'), '  Can you cover Friday?  ')
    await user.click(send)
    expect(state.sent).toEqual([{ to: 'm2', body: 'Can you cover Friday?' }])
    expect(screen.getByRole('status')).toHaveTextContent('Message sent. Ada will see it in their inbox.')
    expect(screen.getByLabelText('Message to Ada')).toHaveValue('')
  })

  it('shows the server’s refusal and does not claim the message was sent', async () => {
    state.sendError = new Error('Too many messages in the last hour. Please wait a little.')
    const user = userEvent.setup()
    renderAt('/board?profile=m2')
    await user.type(screen.getByLabelText('Message to Ada'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Too many messages')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers no message box on your own profile', () => {
    renderAt('/board?profile=me')
    expect(screen.getByTestId('profile-no-message')).toHaveTextContent('This is you.')
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
  })

  it('offers no message box for a retired member', () => {
    renderAt('/board?profile=m3')
    expect(screen.getByTestId('profile-no-message')).toHaveTextContent('Retired members cannot receive messages.')
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
  })

  it('says so for an id that is not on the roster', () => {
    renderAt('/board?profile=ghost')
    expect(screen.getByText('This person is not on the roster.')).toBeInTheDocument()
  })

  it('closes with the Close button', async () => {
    const user = userEvent.setup()
    renderAt('/board?scope=mine&profile=m2')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('profile-dialog')).not.toBeInTheDocument()
  })
})
