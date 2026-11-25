import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'

// The wire contract between the browser and the account Edge Functions: the request bodies and the response
// fields that src/auth/*.ts and src/data/useMembers.ts send and read, checked over real HTTP against the real
// functions and the real Auth server. The unit tests mock both ends of this wire, so a renamed field on either
// side would pass them and break sign-in, onboarding and password resets for real.
//
// No browser: plain fetch is enough. One throw-away member is created THROUGH create-member and carried through
// reset -> choose password -> change login -> username sign-in, then removed.
//
// Needs the Edge Functions served: npx supabase functions serve --env-file supabase/functions/.env.local

const URL = 'http://127.0.0.1:54321'
const stack = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)="?([^"]*)"?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1], m[2]]),
)
const ANON = stack.ANON_KEY
const admin = createClient(URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const STAMP = Date.now()
const EMAIL = `e2e-contract-${STAMP}@test.local`
const NEW_EMAIL = `e2e-contract-moved-${STAMP}@test.local`
const USERNAME = `e2econtract${STAMP}`.slice(0, 29)
const FIRST_PASSWORD = `First-${STAMP}-aA1!`
const CHOSEN_PASSWORD = `Chosen-${STAMP}-bB2!`

type Answer = { status: number; body: Record<string, unknown> }

async function call(name: string, body: unknown, token?: string): Promise<Answer> {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON: leave {} so the assertions on `error` / fields fail with the status in the message
  }
  return { status: res.status, body: parsed as Record<string, unknown> }
}

async function tokenFor(email: string, password: string): Promise<string> {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`could not sign in as ${email}: ${error?.message}`)
  return data.session.access_token
}

const fixtures = readManifest()
let vp = ''
let member = ''
let newId = ''

test.describe.configure({ mode: 'serial' })

// The wire contract is the same on both viewport projects; run it once.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'API-only; runs once')
})

test.beforeAll(async () => {
  const res = await fetch(`${URL}/functions/v1/create-member`, { method: 'OPTIONS' })
  expect(res.status, 'Edge Functions are not served. Run: npx supabase functions serve --env-file supabase/functions/.env.local').toBe(200)
  vp = await tokenFor(fixtures.users.vicepresident.email, fixtures.password)
  member = await tokenFor(fixtures.users.member.email, fixtures.password)
})

test.afterAll(async () => {
  if (!newId) return
  // The login's roster row and role rows cascade from auth.users.
  const { error } = await admin.auth.admin.deleteUser(newId)
  if (error) console.error(`[edge-functions-contract] FAILED to delete ${newId}: ${error.message}`)
})

test.describe('every signed-in function refuses a missing session in words the client shows', () => {
  for (const name of ['create-member', 'reset-member-password', 'set-own-password', 'change-own-login']) {
    test(name, async () => {
      // The anon key is a valid JWT for the gateway but not a signed-in person: the function itself must refuse.
      const answer = await call(name, {}, ANON)
      expect(answer.status).toBe(401)
      expect(typeof answer.body.error).toBe('string')
    })
  }
})

test.describe('create-member', () => {
  test('a plain member is refused with 403 (the client turns that into "no permission")', async () => {
    const answer = await call('create-member', { email: EMAIL, fullName: 'E2E Contract', jobTitle: '', password: FIRST_PASSWORD }, member)
    expect(answer.status).toBe(403)
    expect(typeof answer.body.error).toBe('string')
  })

  test('a malformed body is a 400 with a sentence, not a crash', async () => {
    const answer = await call('create-member', { email: 'not-an-email', fullName: '', password: 'x' }, vp)
    expect(answer.status).toBe(400)
    expect(typeof answer.body.error).toBe('string')
  })

  test('the Vice President adds someone: answers { id, linked } and the roster row asks for a new password', async () => {
    const answer = await call('create-member', { email: EMAIL, fullName: 'E2E Contract', jobTitle: 'Tester', password: FIRST_PASSWORD }, vp)
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    expect(typeof answer.body.id).toBe('string')
    expect(answer.body.linked).toBe(false)
    newId = answer.body.id as string
    expect(runSql(`select full_name, must_change_password, status from members where id = '${newId}'`).trim()).toBe('E2E Contract|t|active')
  })

  test('adding the same person again is a 409', async () => {
    const answer = await call('create-member', { email: EMAIL, fullName: 'E2E Contract', jobTitle: '', password: FIRST_PASSWORD }, vp)
    expect(answer.status).toBe(409)
    expect(typeof answer.body.error).toBe('string')
  })
})

test.describe('reset-member-password', () => {
  test('a plain member cannot reset anyone (403)', async () => {
    const answer = await call('reset-member-password', { memberId: newId }, member)
    expect(answer.status).toBe(403)
  })

  test('nobody resets their own password (403)', async () => {
    const answer = await call('reset-member-password', { memberId: fixtures.users.vicepresident.id }, vp)
    expect(answer.status).toBe(403)
  })

  test('a body without a valid id is a 400', async () => {
    const answer = await call('reset-member-password', { memberId: 'nope' }, vp)
    expect(answer.status).toBe(400)
    expect(typeof answer.body.error).toBe('string')
  })

  test('the Vice President resets: answers { password } that signs in, and the flag is set again', async () => {
    runSql(`update members set must_change_password = false where id = '${newId}'`)
    const answer = await call('reset-member-password', { memberId: newId }, vp)
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    expect(typeof answer.body.password).toBe('string')
    // The reset password really works, and the old one no longer does.
    await expect(tokenFor(EMAIL, answer.body.password as string)).resolves.toBeTruthy()
    await expect(tokenFor(EMAIL, FIRST_PASSWORD)).rejects.toThrow()
    expect(runSql(`select must_change_password from members where id = '${newId}'`).trim()).toBe('t')
    // Carry on with a known password.
    await admin.auth.admin.updateUserById(newId, { password: FIRST_PASSWORD })
  })
})

test.describe('set-own-password', () => {
  test('someone who already chose a password is told so (409)', async () => {
    const answer = await call('set-own-password', { password: CHOSEN_PASSWORD }, member)
    expect(answer.status).toBe(409)
    expect(typeof answer.body.error).toBe('string')
  })

  test('too short is a 400; keeping the temporary password is a 400', async () => {
    const token = await tokenFor(EMAIL, FIRST_PASSWORD)
    expect((await call('set-own-password', { password: 'short' }, token)).status).toBe(400)
    expect((await call('set-own-password', { password: FIRST_PASSWORD }, token)).status).toBe(400)
  })

  test('choosing one answers { ok: true }, clears the flag and the new password signs in', async () => {
    const token = await tokenFor(EMAIL, FIRST_PASSWORD)
    const answer = await call('set-own-password', { password: CHOSEN_PASSWORD }, token)
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    expect(answer.body.ok).toBe(true)
    expect(runSql(`select must_change_password from members where id = '${newId}'`).trim()).toBe('f')
    await expect(tokenFor(EMAIL, CHOSEN_PASSWORD)).resolves.toBeTruthy()
  })
})

test.describe('change-own-login', () => {
  test('the wrong current password is a 400 with the wording the form shows', async () => {
    const token = await tokenFor(EMAIL, CHOSEN_PASSWORD)
    const answer = await call('change-own-login', { email: NEW_EMAIL, password: 'definitely-not-it' }, token)
    expect(answer.status).toBe(400)
    expect(typeof answer.body.error).toBe('string')
  })

  test('an e-mail another account uses is a 409', async () => {
    const token = await tokenFor(EMAIL, CHOSEN_PASSWORD)
    const answer = await call('change-own-login', { email: fixtures.users.member.email, password: CHOSEN_PASSWORD }, token)
    expect(answer.status).toBe(409)
  })

  test('changing it answers { ok: true } and the new address signs in at once', async () => {
    const token = await tokenFor(EMAIL, CHOSEN_PASSWORD)
    const answer = await call('change-own-login', { email: NEW_EMAIL, password: CHOSEN_PASSWORD }, token)
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    expect(answer.body.ok).toBe(true)
    await expect(tokenFor(NEW_EMAIL, CHOSEN_PASSWORD)).resolves.toBeTruthy()
    await expect(tokenFor(EMAIL, CHOSEN_PASSWORD)).rejects.toThrow()
  })
})

test.describe('username-sign-in', () => {
  test('a username signs in: answers { access_token, refresh_token } that the API accepts', async () => {
    runSql(`update members set username = '${USERNAME}' where id = '${newId}'`)
    const answer = await call('username-sign-in', { username: USERNAME.toUpperCase(), password: CHOSEN_PASSWORD })
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    expect(typeof answer.body.access_token).toBe('string')
    expect(typeof answer.body.refresh_token).toBe('string')
    const client = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data, error } = await client.auth.setSession({
      access_token: answer.body.access_token as string,
      refresh_token: answer.body.refresh_token as string,
    })
    expect(error).toBeNull()
    expect(data.user?.id).toBe(newId)
  })

  test('a wrong password and an unknown username are refused with the SAME 400 wording', async () => {
    const wrong = await call('username-sign-in', { username: USERNAME, password: 'wrong-password-1' })
    const unknown = await call('username-sign-in', { username: 'nobody-by-that-name', password: CHOSEN_PASSWORD })
    expect(wrong.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(wrong.body.error).toBe('Invalid login credentials')
    expect(unknown.body.error).toBe(wrong.body.error)
  })
})
