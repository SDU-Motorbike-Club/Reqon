import { describe, expect, it } from 'vitest'
import { cleanReport, errorDetails, MAX_DETAILS, MAX_MESSAGE } from './bugReport.ts'

const where = { path: '/board?task=abc#top', userAgent: 'Firefox/130' }

describe('cleanReport', () => {
  it('trims the text and keeps the page path without its query string or hash', () => {
    expect(cleanReport({ source: 'manual', message: '  The board froze  ' }, where)).toEqual({
      source: 'manual', message: 'The board froze', details: null, page: '/board', user_agent: 'Firefox/130',
    })
  })

  it('has nothing to report with no text and no error', () => {
    expect(cleanReport({ source: 'manual', message: '   ' }, where)).toBeNull()
    expect(cleanReport({ source: 'error', message: '', details: '  ' }, where)).toBeNull()
  })

  it('accepts an error text on its own, with no sentence from the person', () => {
    expect(cleanReport({ source: 'error', message: '', details: 'TypeError: x' }, where)).toMatchObject({ message: '', details: 'TypeError: x' })
  })

  it('cuts what is too long, to the limits the database enforces', () => {
    const out = cleanReport({ source: 'error', message: 'm'.repeat(MAX_MESSAGE + 50), details: 'd'.repeat(MAX_DETAILS + 50) }, where)
    expect(out?.message.length).toBe(MAX_MESSAGE)
    expect(out?.details?.length).toBe(MAX_DETAILS)
  })
})

describe('errorDetails', () => {
  it('gives the name and message and the first lines of the stack', () => {
    const error = new TypeError('x is undefined')
    error.stack = ['TypeError: x is undefined', ...Array.from({ length: 10 }, (_, i) => `    at fn${i} (file.ts:${i}:1)`)].join('\n')
    const text = errorDetails(error)
    expect(text.startsWith('TypeError: x is undefined\n    at fn0')).toBe(true)
    expect(text.split('\n')).toHaveLength(7)
  })

  it('works for an error with no stack', () => {
    const error = new Error('boom')
    error.stack = undefined
    expect(errorDetails(error)).toBe('Error: boom')
  })
})
