import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Fake Supabase ---------------------------------------------------------
// One shared fake stands in for the real client. Each test sets what the
// session is and what the `members` lookup returns, which is exactly the two
// facts the auth state depends on.

type AuthCallback = (event: string, session: unknown) => void

const state = {
  session: null as unknown,
  memberRow: null as unknown,
  memberError: null as { message: string } | null,
  callbacks: [] as AuthCallback[],
  signInResult: { error: null as { message: string } | null },
  signOutCalls: 0,
  signOutThrows: false,
  memberQueries: 0,
  memberColumns: '',
  // set-own-password: what the Edge Function answers, and every call to it.
  invokeError: null as { status: number; message: string } | null,
  invokes: [] as { name: string; body: unknown }[],
  othersSignedOut: 0,
}

const supabase = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: state.session } })),
    onAuthStateChange: vi.fn((cb: AuthCallback) => {
      state.callbacks.push(cb)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    signInWithPassword: vi.fn(async () => state.signInResult),
    signOut: vi.fn(async (options?: { scope?: string }) => {
      // Signing out the OTHER devices leaves this one signed in.
      if (options?.scope === 'others') {
        state.othersSignedOut += 1
        return { error: null }
      }
      state.signOutCalls += 1
      if (state.signOutThrows) throw new Error('offline')
      state.session = null
      state.callbacks.forEach((cb) => cb('SIGNED_OUT', null))
      return { error: null }
    }),
  },
  functions: {
    invoke: vi.fn(async (name: string, { body }: { body: unknown }) => {
      state.invokes.push({ name, body })
      if (state.invokeError) {
        return {
          data: null,
          error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
            context: new Response(JSON.stringify({ error: state.invokeError.message }), { status: state.invokeError.status }),
          }),
        }
      }
      // The function clears the flag once the new password is set.
      state.memberRow = { ...(state.memberRow as object), must_change_password: false }
      return { data: { ok: true }, error: null }
    }),
  },
  from: vi.fn(() => ({
    select: (columns: string) => {
      return {
        eq: () => ({
          maybeSingle: async () => {
            state.memberQueries += 1
            // Only the roster lookup ends in maybeSingle().
            state.memberColumns = columns
            return { data: state.memberRow, error: state.memberError }
          },
          // AuthProvider's live role refresh awaits the query directly.
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: (state.memberRow as { member_roles?: unknown[] } | null)?.member_roles ?? [],
              error: null,
            }),
        }),
      }
    },
  })),
}

vi.mock('../lib/supabase.ts', () => ({ get supabase() { return supabase } }))

const { AuthProvider } = await import('./AuthProvider.tsx')
const { useAuth } = await import('./context.ts')
const { default: RequireAuth } = await import('./RequireAuth.tsx')
const { usePermissions } = await import('./usePermissions.ts')

const ROSTERED_SESSION = { user: { id: 'user-1', email: 'rostered@sdu.dk' } }
// As the lookup returns it: the roster row with its privileged roles embedded.
const MEMBER_ROW = { id: 'user-1', full_name: 'Ada Rider', status: 'active', member_roles: [] }

let queryClient: QueryClient

function Protected() {
  const { signOut } = useAuth()
  return (
    <>
      <p>SECRET BIKE DATA</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  )
}

function renderApp(children: ReactNode = <Protected />) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RequireAuth>{children}</RequireAuth>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.session = null
  state.memberRow = null
  state.memberError = null
  state.callbacks = []
  state.signInResult = { error: null }
  state.signOutCalls = 0
  state.signOutThrows = false
  state.memberQueries = 0
  state.memberColumns = ''
  state.invokeError = null
  state.invokes = []
  state.othersSignedOut = 0
  vi.clearAllMocks()
})

// --- Tests -----------------------------------------------------------------

describe('signed out', () => {
  it('shows the login form and never the protected UI', async () => {
    renderApp()
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
  })

  it('offers no public sign-up and no dead password-reset link', async () => {
    renderApp()
    await screen.findByLabelText('Email')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/forgot|reset/i)).not.toBeInTheDocument()
  })

  it('shows the auth error when the credentials are wrong', async () => {
    state.signInResult = { error: { message: 'Invalid login credentials' } }
    renderApp()
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@sdu.dk')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
  })
})

describe('signed in and on the roster', () => {
  it('renders the protected UI', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = MEMBER_ROW
    renderApp()
    expect(await screen.findByText('SECRET BIKE DATA')).toBeInTheDocument()
  })
})

describe('signed in with a temporary password', () => {
  beforeEach(() => {
    state.session = ROSTERED_SESSION
    state.memberRow = { ...MEMBER_ROW, must_change_password: true }
  })

  it('asks for a new password before anything else', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument()
    expect(screen.getByText(/Welcome, Ada\./)).toBeInTheDocument()
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
  })

  it('checks the two passwords locally before asking the server', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByLabelText('New password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('New password'))
    await user.type(screen.getByLabelText('New password'), 'my-own-secret')
    await user.type(screen.getByLabelText('Confirm new password'), 'my-own-secreT')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByText('The two passwords don’t match.')).toBeInTheDocument()
    expect(state.invokes).toEqual([])
  })

  it('saves it through set-own-password, signs out other devices, then opens the app', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByLabelText('New password'), 'my-own-secret')
    await user.type(screen.getByLabelText('Confirm new password'), 'my-own-secret')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    expect(await screen.findByText('SECRET BIKE DATA')).toBeInTheDocument()
    expect(state.invokes).toEqual([{ name: 'set-own-password', body: { password: 'my-own-secret' } }])
    // The Admin API ended this session too, so it signs straight back in.
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'rostered@sdu.dk', password: 'my-own-secret' })
    expect(state.othersSignedOut).toBe(1)
    // This device stays signed in.
    expect(state.signOutCalls).toBe(0)
  })

  it('shows the server’s reason and stays on the screen when it refuses', async () => {
    state.invokeError = { status: 400, message: 'Choose something other than your temporary password.' }
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByLabelText('New password'), 'Temp-1-pass')
    await user.type(screen.getByLabelText('Confirm new password'), 'Temp-1-pass')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose something other than your temporary password.')
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeEnabled()
  })

  it('can still sign out', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })
})

describe('signed in with a password they chose themselves', () => {
  it('never sees the screen: an existing member has no flag', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = { ...MEMBER_ROW, must_change_password: false }
    renderApp()
    expect(await screen.findByText('SECRET BIKE DATA')).toBeInTheDocument()
    expect(screen.queryByText('Choose your password')).not.toBeInTheDocument()
  })
})

describe('signed in but NOT on the roster', () => {
  beforeEach(() => {
    state.session = { user: { id: 'stranger-1', email: 'stranger@sdu.dk' } }
    state.memberRow = null
  })

  it('shows the exact roster message and blocks the app', async () => {
    renderApp()
    expect(
      await screen.findByText(
        'Your account is not on the club roster; ask the President or Vice President to add you.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
  })

  it('is not treated as signed out — it offers sign-out, not a login form', async () => {
    renderApp()
    await screen.findByText(/not on the club roster/)
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('while authorization is still resolving', () => {
  it('shows a loading state, not the protected UI', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = MEMBER_ROW
    renderApp()
    // Before the member lookup resolves, nothing protected may be on screen.
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
    expect(await screen.findByText('SECRET BIKE DATA')).toBeInTheDocument()
  })
})

describe('when the roster lookup fails', () => {
  it('shows an error, not a silent allow and not a silent deny', async () => {
    state.session = ROSTERED_SESSION
    state.memberError = { message: 'network down' }
    renderApp()
    expect(await screen.findByText('Could not check your account')).toBeInTheDocument()
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
    // Crucially it must NOT claim the user is off the roster.
    expect(screen.queryByText(/not on the club roster/)).not.toBeInTheDocument()
  })
})

describe('sign out', () => {
  it('returns to the login form and clears the query cache', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = MEMBER_ROW
    renderApp()
    await screen.findByText('SECRET BIKE DATA')

    // Seed the cache with the previous user's data.
    queryClient.setQueryData(['tasks'], [{ id: 1, title: 'previous user task' }])
    expect(queryClient.getQueryData(['tasks'])).toBeDefined()

    const { supabase: client } = await import('../lib/supabase.ts')
    await client.auth.signOut()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
    // The previous user's rows must not survive into the next session.
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })
})

describe('sign out when the network is down', () => {
  it('still drops the session and the cached rows', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = MEMBER_ROW
    state.signOutThrows = true
    const { container } = renderApp()
    await screen.findByText('SECRET BIKE DATA')

    queryClient.setQueryData(['tasks'], [{ id: 1, title: 'previous user task' }])

    // The UI calls signOut and the server call fails.
    const { AuthProvider: _p } = await import('./AuthProvider.tsx')
    void _p
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(screen.queryByText('SECRET BIKE DATA')).not.toBeInTheDocument()
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
    expect(container).toBeTruthy()
  })
})

describe('privileged roles', () => {
  function RoleProbe() {
    const auth = useAuth()
    const can = usePermissions()
    if (auth.status !== 'member') return null
    return (
      <p data-testid="probe">
        {[
          `roles=${auth.roles.join(',')}`,
          `administer=${can.canAdminister}`,
          `manageRoles=${can.canManageRoles}`,
          `viewFinances=${can.canViewFinances}`,
          `manageFinances=${can.canManageFinances}`,
          `embedLeaks=${'member_roles' in auth.member}`,
        ].join(' ')}
      </p>
    )
  }

  it('arrive with the roster row, in the same request', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = { ...MEMBER_ROW, member_roles: [{ role: 'treasurer' }, { role: 'developer' }] }
    renderApp(<RoleProbe />)
    expect(await screen.findByTestId('probe')).toHaveTextContent(
      'roles=treasurer,developer administer=true manageRoles=true viewFinances=true manageFinances=true embedLeaks=false',
    )
    expect(state.memberQueries).toBe(1)
    // member_roles points at members twice (member_id and assigned_by); without
    // the hint PostgREST refuses the embed as ambiguous.
    expect(state.memberColumns).toContain('member_roles!member_roles_member_id_fkey(role)')
  })

  it('pick up a role change made elsewhere, without signing in again', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = { ...MEMBER_ROW, member_roles: [{ role: 'treasurer' }] }
    renderApp(<RoleProbe />)
    expect(await screen.findByTestId('probe')).toHaveTextContent('manageFinances=true')

    // The President takes Treasurer away on another device. The next re-read
    // (every minute, on tab focus, or after any refusal) brings it in.
    state.memberRow = { ...MEMBER_ROW, member_roles: [] }
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['member_roles'] })
    })
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('roles= administer=false'))
    expect(screen.getByTestId('probe')).toHaveTextContent('manageFinances=false')
  })

  it('a member with no roles gets no privileges', async () => {
    state.session = ROSTERED_SESSION
    state.memberRow = MEMBER_ROW
    renderApp(<RoleProbe />)
    expect(await screen.findByTestId('probe')).toHaveTextContent(
      'roles= administer=false manageRoles=false viewFinances=false manageFinances=false',
    )
  })
})
