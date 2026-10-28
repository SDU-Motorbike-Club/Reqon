import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Your account" over mocked hooks: what the card says about you, and that choosing, replacing and removing a
// picture go through the hooks with what the image helper produced. The canvas work itself is a browser matter
// (account/avatarImage.test.ts covers which part of a photo is kept).
const state = vi.hoisted(() => ({
  member: { id: 'm1', full_name: 'Ada Rider', role: 'Team lead', status: 'active' as 'active' | 'trial' | 'alumni' },
  roles: ['president'] as string[],
  image: null as string | null,
  saved: [] as string[],
  removed: 0,
  saveError: null as Error | null,
  pictureError: null as Error | null,
  picked: [] as unknown[],
}))

vi.mock('../../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: state.member, user: { id: 'm1' } }) }))
vi.mock('../../auth/usePermissions.ts', () => ({ usePermissions: () => ({ roles: state.roles }) }))
vi.mock('../../account/ChangePasswordForm.tsx', () => ({ ChangePasswordForm: () => <p>Password form</p> }))
vi.mock('../../account/avatarImage.ts', () => ({
  pictureToAvatar: async (file: unknown) => {
    state.picked.push(file)
    if (state.pictureError) throw state.pictureError
    return 'data:image/webp;base64,AAAA'
  },
}))
vi.mock('../../data/useAvatars.ts', () => ({
  useMyAvatar: () => ({ data: state.image }),
  useSetMyAvatar: () => ({
    isPending: false,
    error: null,
    mutateAsync: async (image: string) => {
      if (state.saveError) throw state.saveError
      state.saved.push(image)
    },
  }),
  useRemoveMyAvatar: () => ({
    isPending: false,
    error: null,
    mutate: (_: void, o?: { onSuccess?: () => void }) => {
      state.removed += 1
      o?.onSuccess?.()
    },
  }),
}))

const { ProfileSection } = await import('./ProfileSection.tsx')

const photo = (name = 'me.jpg') => new File(['x'], name, { type: 'image/jpeg' })

beforeEach(() => {
  state.member = { id: 'm1', full_name: 'Ada Rider', role: 'Team lead', status: 'active' }
  state.roles = ['president']
  state.image = null
  state.saved = []
  state.removed = 0
  state.saveError = null
  state.pictureError = null
  state.picked = []
})

describe('who you are', () => {
  it('shows your name, your job title and your roles on one card, with the password form under it', () => {
    render(<ProfileSection />)
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Ada Rider')
    expect(screen.getByTestId('profile-title')).toHaveTextContent('Team lead')
    expect(screen.getByText('President')).toBeInTheDocument()
    expect(screen.getByText('Password form')).toBeInTheDocument()
  })

  it('does not offer to edit the job title here, since the roster is where it is set', () => {
    render(<ProfileSection />)
    expect(screen.queryByLabelText(/job title/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('says when you are on trial or retired', () => {
    state.member.status = 'trial'
    const { unmount } = render(<ProfileSection />)
    expect(screen.getByTestId('profile-title')).toHaveTextContent('on trial')
    unmount()
    state.member.status = 'alumni'
    render(<ProfileSection />)
    expect(screen.getByTestId('profile-title')).toHaveTextContent('retired')
  })
})

describe('the picture', () => {
  it('shows your initials until you add a photo, and offers only Add', () => {
    render(<ProfileSection />)
    expect(screen.getByTestId('avatar-initials')).toHaveTextContent('AR')
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument()
  })

  it('shows your photo once you have one, and offers Change and Remove', () => {
    state.image = 'data:image/webp;base64,AAAA'
    render(<ProfileSection />)
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', 'data:image/webp;base64,AAAA')
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument()
  })

  it('turns the chosen file into the small picture and saves exactly that', async () => {
    const user = userEvent.setup()
    render(<ProfileSection />)
    const file = photo()
    await user.upload(screen.getByTestId('profile-photo-input'), file)
    await waitFor(() => expect(state.saved).toEqual(['data:image/webp;base64,AAAA']))
    expect(state.picked).toEqual([file])
    expect(await screen.findByTestId('profile-photo-done')).toHaveTextContent('Photo saved.')
  })

  it('says why a file could not be used, and saves nothing', async () => {
    state.pictureError = new Error('That file could not be read as a picture. Try a JPEG or PNG.')
    const user = userEvent.setup()
    render(<ProfileSection />)
    await user.upload(screen.getByTestId('profile-photo-input'), photo('scan.heic'))
    expect(await screen.findByTestId('profile-photo-problem')).toHaveTextContent('Try a JPEG or PNG')
    expect(state.saved).toEqual([])
    expect(screen.queryByTestId('profile-photo-done')).not.toBeInTheDocument()
  })

  it('says so when the database refuses the picture', async () => {
    state.saveError = new Error('save your picture: new row violates check constraint')
    const user = userEvent.setup()
    render(<ProfileSection />)
    await user.upload(screen.getByTestId('profile-photo-input'), photo())
    expect(await screen.findByTestId('profile-photo-problem')).toHaveTextContent('check constraint')
  })

  it('removes your photo and says so', async () => {
    state.image = 'data:image/webp;base64,AAAA'
    const user = userEvent.setup()
    render(<ProfileSection />)
    await user.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(state.removed).toBe(1)
    expect(screen.getByTestId('profile-photo-done')).toHaveTextContent('Photo removed.')
  })

  it('gives a retired member no way to change the photo, because the database would refuse it', () => {
    state.member.status = 'alumni'
    render(<ProfileSection />)
    expect(screen.queryByRole('button', { name: /photo/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('profile-photo-input')).not.toBeInTheDocument()
  })
})
