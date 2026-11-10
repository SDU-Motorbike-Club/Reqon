import { describe, expect, it } from 'vitest'
import { snippet } from './snippet.ts'

describe('snippet', () => {
  it('keeps a short text whole and marks the match, keeping its original case', () => {
    expect(snippet('Fix the Brake lever', 'brake')).toEqual({ before: 'Fix the ', match: 'Brake', after: ' lever' })
  })

  it('cuts a long text with … on the sides where it goes on', () => {
    const text = `${'a '.repeat(40)}needle${' b'.repeat(40)}`
    const s = snippet(text, 'needle', 10)
    expect(s.match).toBe('needle')
    expect(s.before.startsWith('…')).toBe(true)
    expect(s.after.endsWith('…')).toBe(true)
    expect(s.before.length).toBeLessThanOrEqual(11)
  })

  it('has no … at the side where the text really starts or ends', () => {
    const s = snippet('needle then a long tail that keeps going and going and going on', 'needle', 10)
    expect(s.before).toBe('')
    expect(s.after.endsWith('…')).toBe(true)
  })

  it('collapses line breaks, and without a match shows the start', () => {
    expect(snippet('one\n\n two', 'two').before).toBe('one ')
    expect(snippet('x'.repeat(200), 'zzz', 10)).toEqual({ before: '', match: '', after: `${'x'.repeat(20)}…` })
  })
})
