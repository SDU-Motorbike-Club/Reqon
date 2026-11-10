import { invokeEdgeFunction } from '../data/edgeFunctions.ts'
import { supabase } from '../lib/supabase.ts'

// Changing the e-mail you sign in with. Goes through the `change-own-login` Edge Function, which checks the current
// password and then changes the e-mail at once. supabase.auth.updateUser({ email }) is not used: it waits for a
// confirmation link mailed to the new address, and this club has no mailer (and some logins are not real mailboxes),
// so it would stay "pending" for ever.
export async function changeLogin({ currentPassword, newEmail }: { currentPassword: string; newEmail: string }): Promise<void> {
  await invokeEdgeFunction<{ ok?: unknown }>('change-own-login', { email: newEmail, password: currentPassword }, 'change your login')
  // The Admin API ends every session of that user, this one included. Sign straight back in with the new address so
  // the member is not thrown out to the login form.
  const { error } = await supabase.auth.signInWithPassword({ email: newEmail.trim(), password: currentPassword })
  if (error) throw new Error(`Your login is changed. Sign in again with ${newEmail.trim()}.`)
  // Best effort: end any other device's session, which still carries the old address.
  await supabase.auth.signOut({ scope: 'others' })
}
