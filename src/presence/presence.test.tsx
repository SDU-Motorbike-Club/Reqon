import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Importers: none (a test). Supabase and the signed-in member are replaced; ids are synthetic.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), online: ['m1', 'm2'] as string[] }))
vi.mock('../lib/supabase.ts', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../auth/context.ts', () => ({ useAuth: () => ({ status: 'member', member: { id: 'm1' } }) }))

const { Avatar } = await import('../ui/Avatar.tsx')
const { OnlineContext } = await import('./context.ts')
const { PresenceProvider } = await import('./PresenceProvider.tsx')
const { resumePresence } = await import('../data/usePresence.ts')

describe('the green ball on an avatar', () => {
  it('shows only for a member who is online, and says “Online” to a screen reader', () => {
    render(
      <OnlineContext.Provider value={new Set(['m1'])}>
        <Avatar name="Ada Rider" memberId="m1" />
        <Avatar name="Bo Wrench" memberId="m2" />
        <Avatar name="No Id" />
      </OnlineContext.Provider>,
    )
    expect(screen.getAllByTestId('online-dot')).toHaveLength(1)
    expect(screen.getByText('Online', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('shows on a photo as well as on initials, in every size', () => {
    render(
      <OnlineContext.Provider value={new Set(['m1'])}>
        <Avatar name="Ada Rider" image="data:image/webp;base64,AAAA" memberId="m1" size="xs" />
        <Avatar name="Ada Rider" memberId="m1" size="lg" />
      </OnlineContext.Provider>,
    )
    expect(screen.getAllByTestId('online-dot')).toHaveLength(2)
    expect(screen.getByTestId('avatar-image')).toBeInTheDocument()
    expect(screen.getByTestId('avatar-initials')).toBeInTheDocument()
  })

  it('is not there outside the signed-in app, where nobody is shown as online', () => {
    render(<Avatar name="Ada Rider" memberId="m1" />)
    expect(screen.queryByTestId('online-dot')).not.toBeInTheDocument()
  })
})

describe('PresenceProvider', () => {
  let now = 1_000_000

  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    resumePresence()
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async (name: string) => (name === 'online_member_ids' ? { data: mocks.online, error: null } : { data: null, error: null }))
  })
  afterEach(() => vi.restoreAllMocks())

  const touches = () => mocks.rpc.mock.calls.filter(([name]) => name === 'touch_presence').length
  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PresenceProvider>
          <Avatar name="Bo Wrench" memberId="m2" />
          <Avatar name="Cy Old" memberId="m3" />
        </PresenceProvider>
      </QueryClientProvider>,
    )

  it('says you are here as soon as you arrive, and lights the dots of the people the database says are online', async () => {
    mount()
    await waitFor(() => expect(touches()).toBe(1))
    expect(await screen.findAllByTestId('online-dot')).toHaveLength(1)
  })

  it('pings again on activity only after two minutes, however much you click in between', async () => {
    mount()
    await waitFor(() => expect(touches()).toBe(1))
    now += 30_000
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
      window.dispatchEvent(new Event('keydown'))
    })
    expect(touches()).toBe(1)
    now += 2 * 60 * 1000
    act(() => {
      window.dispatchEvent(new Event('keydown'))
    })
    await waitFor(() => expect(touches()).toBe(2))
  })

  it('sends nothing while the tab is hidden, and nothing without activity: no timer keeps you “online”', async () => {
    mount()
    await waitFor(() => expect(touches()).toBe(1))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    now += 10 * 60 * 1000
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })
    expect(touches()).toBe(1)
  })

  it('never signs anyone out: it only ever calls the presence functions', async () => {
    mount()
    await waitFor(() => expect(touches()).toBe(1))
    expect(mocks.rpc.mock.calls.every(([name]) => ['touch_presence', 'online_member_ids'].includes(name as string))).toBe(true)
  })
})
