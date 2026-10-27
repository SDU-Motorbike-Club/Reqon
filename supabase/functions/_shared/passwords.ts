// Temporary passwords for create-member and reset-member-password, and the
// rules every new password follows (set-own-password). Pure, so the unit tests
// run under Vitest; the functions themselves are Deno-only.
//
// A temporary password is read aloud or pasted into a WhatsApp message, so it
// leaves out characters that look alike (0/O, 1/l/I) and comes in groups of
// four: 16 characters from 55 symbols is about 92 bits, far more than an
// online guess can reach before Auth's rate limit stops it.

export const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
export const TEMP_LENGTH = 16

// Same limits as create-member always had (and src/account/ChangePasswordForm.tsx).
export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 72 // bcrypt ignores everything after 72 bytes

type RandomBytes = (bytes: Uint8Array) => Uint8Array

// Rejection sampling: a byte at or above the largest multiple of the alphabet
// size is thrown away, so every symbol is exactly equally likely (a plain
// `byte % 55` would favour the first 36 symbols).
export function generatePassword(random: RandomBytes = (b) => crypto.getRandomValues(b)): string {
  const n = TEMP_ALPHABET.length
  const limit = 256 - (256 % n)
  const out: string[] = []
  while (out.length < TEMP_LENGTH) {
    for (const byte of random(new Uint8Array(32))) {
      if (byte < limit && out.length < TEMP_LENGTH) out.push(TEMP_ALPHABET[byte % n])
    }
  }
  return out.join('').replace(/(.{4})(?=.)/g, '$1-')
}

// null when it may be used; otherwise the sentence to show the person.
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `The password must be at least ${MIN_PASSWORD} characters.`
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) {
    return `The password must be at most ${MAX_PASSWORD} characters.`
  }
  return null
}
