import { describe, expect, it } from 'vitest'
import { meetingSummary } from './meetingSummary.ts'

describe('meetingSummary', () => {
  it('prefers the written summary', () => {
    expect(meetingSummary({ summary: ' Agreed the budget. ', notes: '- other' })).toEqual({ text: 'Agreed the budget.', fromMinutes: false })
  })

  it('falls back to the opening lines of the minutes, without headings or bullets', () => {
    expect(meetingSummary({ summary: null, notes: '## Minutes\n\n- **Frame** ordered\n- Tyres next week' })).toEqual({
      text: 'Frame ordered Tyres next week',
      fromMinutes: true,
    })
  })

  it('shortens long minutes', () => {
    const got = meetingSummary({ summary: null, notes: 'word '.repeat(100) })
    expect(got?.text.endsWith('…')).toBe(true)
    expect(got?.text.length).toBeLessThanOrEqual(221)
  })

  it('ignores an old summary that is only a copy of the minutes', () => {
    expect(meetingSummary({ summary: 'Same text', notes: 'Same text\n' })).toEqual({ text: 'Same text', fromMinutes: true })
  })

  it('has nothing for an empty summary and no minutes', () => {
    expect(meetingSummary({ summary: '  ', notes: null })).toBeNull()
    expect(meetingSummary({ summary: null, notes: '## Only a heading' })).toBeNull()
  })
})
