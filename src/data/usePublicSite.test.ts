import { describe, expect, it } from 'vitest'
import { readAnswers, readingMinutes, slugify } from './usePublicSite.ts'

describe('public site helpers', () => {
  it('reads answers stored by submit_application() and by a plain {question: answer} form', () => {
    expect(readAnswers([{ question: 'Why join?', answer: 'Bikes' }, { question: 'Year?', answer: null }, 'junk'])).toEqual([
      { question: 'Why join?', answer: 'Bikes' },
      { question: 'Year?', answer: null },
    ])
    expect(readAnswers({ 'Why join?': 'Bikes', Age: 21 })).toEqual([
      { question: 'Why join?', answer: 'Bikes' },
      { question: 'Age', answer: '21' },
    ])
    expect(readAnswers(null)).toEqual([])
  })

  it('makes a web address from a title', () => {
    expect(slugify('  Our first Track Day!  ')).toBe('our-first-track-day')
    expect(slugify('Ősz a pályán')).toBe('osz-a-palyan')
  })

  it('never says zero minutes to read', () => {
    expect(readingMinutes('')).toBe(1)
    expect(readingMinutes('word '.repeat(600))).toBe(3)
  })
})
