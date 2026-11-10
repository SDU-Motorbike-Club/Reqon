// The rules for a login e-mail (change-own-login). Pure, so the unit tests run under Vitest; the function itself is
// Deno-only. Deliberately loose: the club's logins are not always real mailboxes, and a stricter pattern would only
// reject addresses that work. The Auth server has the final say.

export const MAX_EMAIL = 254

// Returns what is wrong with the address, worded for a club member, or null when it is fine.
export function loginEmailProblem(value: unknown, current: string | null): string | null {
  if (typeof value !== 'string') return 'Enter the new login e-mail.'
  const email = value.trim()
  if (!email) return 'Enter the new login e-mail.'
  if (email.length > MAX_EMAIL) return `Use at most ${MAX_EMAIL} characters.`
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That doesn’t look like an e-mail address.'
  if (current && email.toLowerCase() === current.toLowerCase()) return 'That is already your login.'
  return null
}
