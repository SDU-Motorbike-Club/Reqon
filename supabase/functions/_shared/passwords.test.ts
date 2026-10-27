import { describe, expect, it } from 'vitest'
import { generatePassword, MAX_PASSWORD, MIN_PASSWORD, passwordProblem, TEMP_ALPHABET, TEMP_LENGTH } from './passwords.ts'

describe('generatePassword', () => {
  it('makes four groups of four from the unambiguous alphabet', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}-[^-]{4}$/)
    const symbols = password.replaceAll('-', '')
    expect(symbols).toHaveLength(TEMP_LENGTH)
    for (const ch of symbols) expect(TEMP_ALPHABET).toContain(ch)
    expect(TEMP_ALPHABET).not.toMatch(/[0O1lI]/)
  })

  it('differs every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()))
    expect(seen.size).toBe(200)
  })

  it('throws away bytes that would bias the alphabet', () => {
    // 220 = 256 - 256 % 55 is the first biased byte, so the whole first batch
    // is dropped; 56 % 55 = 1 is 'B'.
    let call = 0
    const random = (bytes: Uint8Array) => bytes.fill(call++ === 0 ? 220 : 56)
    expect(generatePassword(random)).toBe('BBBB-BBBB-BBBB-BBBB')
    expect(call).toBe(2)
  })

  it('is always a password passwordProblem accepts', () => {
    expect(passwordProblem(generatePassword())).toBeNull()
  })
})

describe('passwordProblem', () => {
  it('accepts 8 to 72 bytes', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD))).toBeNull()
    expect(passwordProblem('a'.repeat(MAX_PASSWORD))).toBeNull()
  })

  it('refuses short, missing and over-long passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/)
    expect(passwordProblem(undefined)).toMatch(/at least 8/)
    expect(passwordProblem(42)).toMatch(/at least 8/)
    // 37 two-byte characters are 74 bytes: too long for bcrypt, though only 37 characters.
    expect(passwordProblem('é'.repeat(37))).toMatch(/at most 72/)
  })
})
