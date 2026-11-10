import { describe, expect, it } from 'vitest'
import { loginEmailProblem, MAX_EMAIL } from './emails.ts'

describe('loginEmailProblem', () => {
  it('accepts an ordinary address, even on a domain that has no mailbox', () => {
    expect(loginEmailProblem('ada@club.test', 'old@club.test')).toBeNull()
    expect(loginEmailProblem('  ada.rider+pit@sdumotorbike.dk  ', null)).toBeNull()
  })

  it('asks for an address when there is none', () => {
    for (const value of [undefined, null, 42, '', '   ']) expect(loginEmailProblem(value, null)).toBe('Enter the new login e-mail.')
  })

  it('refuses text that is not an address', () => {
    for (const value of ['ada', 'ada@', '@club.test', 'ada@club', 'a da@club.test', 'a@@club.test']) {
      expect(loginEmailProblem(value, null), value).toBe('That doesn’t look like an e-mail address.')
    }
  })

  it('refuses the address you already have, whatever its case', () => {
    expect(loginEmailProblem('Cla@SDUmotorbike.test', 'cla@sdumotorbike.test')).toBe('That is already your login.')
  })

  it('refuses an address longer than the limit', () => {
    expect(loginEmailProblem(`${'a'.repeat(MAX_EMAIL)}@club.test`, null)).toBe(`Use at most ${MAX_EMAIL} characters.`)
  })
})
