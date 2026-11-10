import { invokeEdgeFunction } from '../data/edgeFunctions.ts'
import { supabase } from '../lib/supabase.ts'

// What the login form calls a username: anything with no "@" (a username can never contain one,
// members_username_format). Everything else is an e-mail.
export const isUsername = (login: string): boolean => !login.includes('@')

// Signing in with a username. The `username-sign-in` Edge Function finds the account, checks the password and hands
// back a session; the browser never sees the e-mail behind the username. Resolves with the error text to show, or
// null on success — the same shape as the e-mail sign-in it stands next to.
export async function signInWithUsername(username: string, password: string): Promise<string | null> {
  try {
    const session = await invokeEdgeFunction<{ access_token?: string; refresh_token?: string }>(
      'username-sign-in',
      { username, password },
      'sign in',
    )
    if (!session.access_token || !session.refresh_token) return 'Invalid login credentials'
    const { error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not sign you in.'
  }
}
