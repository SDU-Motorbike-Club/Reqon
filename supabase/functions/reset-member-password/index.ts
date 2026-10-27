// reset-member-password — Settings -> Roster -> "Reset password": issue someone
// a new temporary password, for when they forgot theirs.
//
// The database decides, as the caller (migration
// 20260138000000_temporary_passwords.sql): mark_password_reset(member) answers
// only for an active President, Vice President or Developer, never for
// themselves, and only for someone whose roles the caller could grant or
// remove (can_reset_password()) — so a reset can never be used to sign in as
// someone more powerful. It then sets must_change_password and logs the reset
// in `activity` under the caller's name. Only after that does this function use
// the service-role key, for exactly one call: setting the new password.
//
// Setting the password through the Admin API also ends every session the
// person has open, so the reset shuts out anyone signed in as them.
//
// If that call fails, the flag stays set. That is harmless: the person keeps
// their old password and is simply asked to choose a new one.
//
// Request:  POST { memberId }
// Response: 200 { password } | 4xx/5xx { error }
// The password is never logged, and is returned only in that one 200 answer.

import { corsHeaders, reply } from '../_shared/attachments.ts'
import { caller, service } from '../_shared/clients.ts'
import { generatePassword } from '../_shared/passwords.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const memberId = (raw as { memberId?: unknown } | null)?.memberId
  if (typeof memberId !== 'string' || !UUID.test(memberId)) {
    return reply(400, { error: 'Say whose password to reset.' })
  }

  const { error: markError } = await who.client.rpc('mark_password_reset', { p_member: memberId })
  if (markError) {
    if (markError.code === '42501') return reply(403, { error: markError.message })
    console.error('reset-member-password: mark_password_reset failed', markError.code)
    return reply(500, { error: 'Could not reset the password. Nothing was changed.' })
  }

  const password = generatePassword()
  const { error: updateError } = await admin.auth.admin.updateUserById(memberId, { password })
  if (updateError) {
    console.error('reset-member-password: updateUserById failed', updateError.code ?? updateError.status)
    return reply(500, {
      error: 'Could not set a new password. Their old one still works, and they will be asked to choose a new one when they next sign in.',
    })
  }

  // Audit line in the function logs: who reset whom. No email, no password.
  console.log('reset-member-password: reset', memberId, 'by', who.user.id)
  return reply(200, { password })
})
