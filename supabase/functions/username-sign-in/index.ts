// username-sign-in — sign in with a username instead of the e-mail.
//
// Supabase Auth only knows e-mails. The browser must not be handed anyone's address before it has signed in (that
// would let a stranger turn a guessed username into an e-mail), so the lookup happens here: the username is turned
// into the e-mail with the service-role key, the password is checked with an ordinary sign-in, and only the resulting
// session tokens go back. The client then adopts that session (supabase.auth.setSession).
//
// Every failure — no such username, wrong password, a retired account — answers the same
// "Invalid login credentials", so the response does not say whether a username exists.
//
// Request:  POST { username, password }
// Response: 200 { access_token, refresh_token } | 400 { error } | 429/503 { error }
// Neither the password nor the e-mail is logged or echoed back.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { corsHeaders, reply } from '../_shared/attachments.ts'
import { jsonBody, service } from '../_shared/clients.ts'

const REFUSED = 'Invalid login credentials'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const raw = (await jsonBody(req)) as { username?: unknown; password?: unknown } | null | undefined
  if (!raw || typeof raw.username !== 'string' || typeof raw.password !== 'string' || !raw.password) {
    return reply(400, { error: REFUSED })
  }
  const username = raw.username.trim().toLowerCase()
  // A username never contains "@" (members_username_format); anything else cannot match, so do not even look.
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return reply(400, { error: REFUSED })

  const admin = service()
  if (admin instanceof Response) return admin
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return reply(500, { error: 'The function is not configured.' })

  const { data: member, error: memberError } = await admin.from('members').select('id, status').eq('username', username).maybeSingle()
  if (memberError) {
    console.error('username-sign-in: lookup failed', memberError.code)
    return reply(503, { error: 'Could not sign you in just now. Wait a minute, then try again.' })
  }
  if (!member || member.status === 'alumni') return reply(400, { error: REFUSED })

  const { data: found, error: userError } = await admin.auth.admin.getUserById(member.id)
  const email = found?.user?.email
  if (userError || !email) return reply(400, { error: REFUSED })

  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password: raw.password })
  if (error || !data.session) {
    if (error?.code === 'over_request_rate_limit') return reply(429, { error: 'Too many attempts. Wait a minute, then try again.' })
    return reply(400, { error: REFUSED })
  }
  return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token })
})
