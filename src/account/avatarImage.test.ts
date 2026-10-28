import { describe, expect, it } from 'vitest'
import { initialsOf } from '../ui/initials.ts'
import { squareCrop } from './avatarImage.ts'

// The canvas work itself needs a real browser; what can go wrong without one is which part of the photo is kept
// and what the fallback initials say.
describe('squareCrop', () => {
  it('takes the middle of a landscape photo', () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 })
  })
  it('takes the middle of a portrait photo', () => {
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 })
  })
  it('keeps a square as it is, and never returns a side below 1', () => {
    expect(squareCrop(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 })
    expect(squareCrop(0, 0).side).toBe(1)
  })
  it('stays on whole pixels for an odd difference', () => {
    const { sx, sy } = squareCrop(1001, 1000)
    expect(Number.isInteger(sx) && Number.isInteger(sy)).toBe(true)
  })
})

describe('initialsOf', () => {
  it('is the first letter of the first and last name, upper case', () => {
    expect(initialsOf('Ada Rider')).toBe('AR')
    expect(initialsOf('  ada   king  rider ')).toBe('AR')
  })
  it('is one letter for one name, ? for none, and keeps letters beyond ASCII whole', () => {
    expect(initialsOf('Madonna')).toBe('M')
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf('Åsa Öberg')).toBe('ÅÖ')
    expect(initialsOf('𠮷野 家')).toBe('𠮷家')
  })
})
