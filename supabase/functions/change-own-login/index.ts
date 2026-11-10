// change-own-login — the member changes the e-mail they sign in with.
//
// Why an Edge Function and not supabase.auth.updateUser({ email }): that call works by mailing a confirmation link
// to the new address (and, with double_confirm_changes, to the old one too). This club runs without a mailer, and
// many logins are not real mailboxes (cla@sdumotorbike.test), so the change would sit "pending" for ever. Here the
// member proves it is them with their current password and the change is made at once, with the service-role key,
// which never leaves this function. The password does not change.
//
// Changing the e-mail through the Admin API ends every session the member has, the caller's included;
// src/auth/changeLogin.ts signs straight back in with the new address.
//
// Request:  POST { email, password }   (email = the new login, password = the current one)
// Response: 200 { ok: true } | 4xx/5xx { error }
// Neither address nor the password is logged or echoed back.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { corsHeaders, reply } from '../_shared/attachments.ts'
import { caller, jsonBody, service } from '../_shared/clients.ts'
import { loginEmailProblem } from '../_shared/emails.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const who = await caller(req)
  if (who instanceof Response) return who
  const admin = service()
  if (admin instanceof Response) return admin

  const raw = (await jsonBody(req)) as { email?: unknown; password?: unknown } | null | undefined
  if (!raw || typeof raw !== 'object') return reply(400, { error: 'Send a JSON body.' })
  const problem = loginEmailProblem(raw.email, who.user.email ?? null)
  if (problem) return reply(400, { error: problem })
  if (typeof raw.password !== 'string' || !raw.password) return reply(400, { error: 'Enter your current password.' })
  const newEmail = (raw.email as string).trim()

  // Only someone on the roster has a login worth changing here (RLS shows a roster row only to the roster).
  const { data: me, error: meError } = await who.client.from('members').select('id').eq('id', who.user.id).maybeSingle()
  if (meError) return reply(500, { error: 'Could not check your account. Nothing was changed.' })
  if (!me) return reply(403, { error: 'Your account is not on the club roster.' })

  // The current password has to sign in: a stolen session alone must not be enough to take the account over. The
  // probe session is ended again at once (scope local: only that one).
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey || !who.user.email) return reply(500, { error: 'The function is not configured.' })
  const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: proof, error: proofError } = await probe.auth.signInWithPassword({ email: who.user.email, password: raw.password })
  if (proof.session) {
    await probe.auth.signOut({ scope: 'local' })
  } else {
    const wrong = proofError?.code === 'invalid_credentials' || /invalid login credentials/i.test(proofError?.message ?? '')
    // 400, not 403: the client turns every 403 into "you don't have permission" and drops this wording.
    if (wrong) return reply(400, { error: 'That isn’t your current password.' })
    return reply(503, { error: 'Could not check your password just now. Wait a minute, then try again.' })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(who.user.id, { email: newEmail, email_confirm: true })
  if (updateError) {
    if (updateError.code === 'email_exists') return reply(409, { error: 'Another account already uses that e-mail.' })
    if (updateError.code === 'email_address_invalid' || updateError.code === 'validation_failed') {
      return reply(400, { error: 'That doesn’t look like an e-mail address.' })
    }
    console.error('change-own-login: updateUserById failed', updateError.code ?? updateError.status)
    return reply(500, { error: 'Could not change your login. Nothing was changed.' })
  }

  // Audit line in the function logs: who, never the addresses or the password.
  console.log('change-own-login: changed for', who.user.id)
  return reply(200, { ok: true })
})
