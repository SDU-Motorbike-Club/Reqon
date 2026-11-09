import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// Signed OUT: the privacy page must render without any account.
vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'signedOut' }) }))

const { default: App } = await import('../App.tsx')

describe('privacy policy', () => {
  it('is readable without signing in, and the sign-in form links to it', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('/privacy')
  })
})
