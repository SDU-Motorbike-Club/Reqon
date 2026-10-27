// set-own-password — the member replaces the temporary password the app gave
// them (create-member, or a reset) with one only they know.
//
// Why an Edge Function: the "temporary password" flag (members
// .must_change_password, migration 20260138000000_temporary_passwords.sql)
// cannot be cleared through the API by anyone, so a member cannot dismiss the
// "Choose your password" screen while keeping the password an admin saw. Here
// the new password is set first and the flag cleared only after that worked,
// both with the service-role key, which never leaves this function.
//
// Setting the password through the Admin API ends every session the member
// has, the caller's included; src/auth/setOwnPassword.ts signs straight back in
// with the new password.
//
// It works ONLY while the caller's flag is set. Afterwards a password is
// changed in Settings -> Your account, which asks for the current one; this
// function does not, so it must not become a way around that.
//
// Request:  POST { password }
// Response: 200 { ok: true } | 4xx/5xx { error }
// The password is never logged or echoed back.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { corsHeaders, reply } from '../_shared/attachments.ts'
import { caller, service } from '../_shared/clients.ts'
import { passwordProblem } from '../_shared/passwords.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const who = await caller(req)
  if (who instanceof Response) return who
  const admin = service()
  if (admin instanceof Response) return admin

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return reply(400, { error: 'Send a JSON body.' })
  }
  const password = (raw as { password?: unknown } | null)?.password
  const problem = passwordProblem(password)
  if (problem) return reply(400, { error: problem })
  const newPassword = password as string

  // Read as the caller: RLS shows a roster row only to someone on the roster.
  const { data: me, error: meError } = await who.client
    .from('members')
    .select('must_change_password')
    .eq('id', who.user.id)
    .maybeSingle()
  if (meError) return reply(500, { error: 'Could not check your account. Nothing was changed.' })
  if (!me) return reply(403, { error: 'Your account is not on the club roster.' })
  if (!me.must_change_password) {
    return reply(409, { error: 'You have already chosen your password. Change it in Settings → Your account.' })
  }

  // The temporary password was seen by whoever issued it, so it may not be
  // kept. The Admin API does not refuse "the same password" the way a user's
  // own update does, so try it: if it signs in, it is the same one. That probe
  // session is ended again at once (scope local: only that one session).
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey || !who.user.email) return reply(500, { error: 'The function is not configured.' })
  const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: same, error: probeError } = await probe.auth.signInWithPassword({
    email: who.user.email,
    password: newPassword,
  })
  if (same.session) {
    await probe.auth.signOut({ scope: 'local' })
    return reply(400, { error: 'Choose something other than your temporary password.' })
  }
  const wrongPassword =
    probeError?.code === 'invalid_credentials' || /invalid login credentials/i.test(probeError?.message ?? '')
  if (!wrongPassword) {
    return reply(503, { error: 'Could not check your new password just now. Wait a minute, then try again.' })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(who.user.id, { password: newPassword })
  if (updateError) {
    if (updateError.code === 'weak_password') {
      return reply(400, { error: `That password is too weak: ${updateError.message}` })
    }
    console.error('set-own-password: updateUserById failed', updateError.code ?? updateError.status)
    return reply(500, { error: 'Could not change your password. Nothing was changed.' })
  }

  const { error: flagError } = await admin
    .from('members')
    .update({ must_change_password: false })
    .eq('id', who.user.id)
  if (flagError) {
    // The password did change; only the flag is left. Signing in with the new
    // password brings this screen back once more, and any other new password
    // then clears it.
    console.error('set-own-password: password changed but flag not cleared', flagError.code)
    return reply(500, {
      error: 'Your new password is saved, but Reqon could not record that. Sign out, sign in with your new password, and choose one more.',
    })
  }

  // Audit line in the function logs. No email, no password.
  console.log('set-own-password: chosen by', who.user.id)
  return reply(200, { ok: true })
})
