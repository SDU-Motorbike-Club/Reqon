import { DataError } from '../core/errors.ts'
import { invokeEdgeFunction } from '../data/edgeFunctions.ts'
import { supabase } from '../lib/supabase.ts'

// Replacing the temporary password the app issued (create-member, or a reset)
// with one only you know. Goes through the `set-own-password` Edge Function,
// which sets the password and then clears members.must_change_password —
// nobody can clear that flag directly (20260138000000_temporary_passwords.sql).
// It works only while the flag is set; after that, Settings -> Your account
// changes a password, and asks for the current one.
export async function setOwnPassword(email: string, password: string): Promise<void> {
  await invokeEdgeFunction<{ ok?: unknown }>('set-own-password', { password }, 'choose your password')
  // Setting a password through the Admin API ends every session of that user —
  // this one included, and any the person who issued the temporary password
  // might have opened. Sign straight back in with the new password so the
  // member is not thrown out to the login form.
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new DataError('Your new password is saved. Sign in again with it.', null)
  // Where a project keeps the other sessions alive, end them here. Best effort.
  await supabase.auth.signOut({ scope: 'others' })
}
