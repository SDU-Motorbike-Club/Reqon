import { describe, expect, it } from 'vitest'
import { usernameProblem } from './username.ts'

describe('usernameProblem', () => {
  it('accepts a good name, whatever its case or padding, and an empty one (which clears it)', () => {
    for (const ok of ['ada', 'Ada.Rider', '  pit_crew-7 ', 'a1b', 'x'.repeat(30), '', '   ']) expect(usernameProblem(ok), ok).toBeNull()
  })

  it('says what is wrong, in words', () => {
    expect(usernameProblem('ab')).toBe('Use at least 3 characters.')
    expect(usernameProblem('x'.repeat(31))).toBe('Use at most 30 characters.')
    expect(usernameProblem('-ada')).toBe('Start with a letter or a digit.')
    expect(usernameProblem('ada rider')).toBe('Use only letters, digits, dot, dash and underscore.')
    expect(usernameProblem('ada!')).toBe('Use only letters, digits, dot, dash and underscore.')
  })

  it('keeps an e-mail out, since the login form tells the two apart by the @', () => {
    expect(usernameProblem('ada@club.test')).toMatch(/can’t contain @/)
  })
})
