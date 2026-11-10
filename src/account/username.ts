// The rule for a username, the same one the database enforces (members_username_format, 20260160000000). Checked here
// first so a mistake is explained in words instead of being sent and refused.

export const USERNAME_MIN = 3
export const USERNAME_MAX = 30

// Returns what is wrong with `value`, or null when it is acceptable. An empty value is fine here: it clears the name.
export function usernameProblem(value: string): string | null {
  const name = value.trim().toLowerCase()
  if (!name) return null
  if (name.includes('@')) return 'A username can’t contain @. To sign in with an e-mail, use the e-mail row.'
  if (name.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`
  if (name.length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`
  if (!/^[a-z0-9]/.test(name)) return 'Start with a letter or a digit.'
  if (!/^[a-z0-9._-]+$/.test(name)) return 'Use only letters, digits, dot, dash and underscore.'
  return null
}
