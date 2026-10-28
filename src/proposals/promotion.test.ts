import { describe, expect, it } from 'vitest'
import { describeBlockers, draftFrom, promotionBlockers } from './promotion.ts'

const complete = { subteam_key: 'AERO', due_date: '2026-12-01', milestone_key: 'MS1' }

describe('promotionBlockers', () => {
  it('has none for a complete proposal with a requirement', () => {
    expect(promotionBlockers(draftFrom(complete, 1))).toEqual([])
  })
  it('names every missing field, in a stable order', () => {
    // Only a deadline blocks a promotion; a department, a milestone and requirements are optional.
    expect(promotionBlockers(draftFrom({ subteam_key: null, due_date: null, milestone_key: null }, 0))).toEqual(['deadline'])
    expect(promotionBlockers(draftFrom({ subteam_key: null, due_date: '2026-12-01', milestone_key: null }, 0))).toEqual([])
  })
  it('names just the one thing that is missing', () => {
    // A milestone and requirements are optional: their absence blocks nothing.
    expect(promotionBlockers(draftFrom(complete, 0))).toEqual([])
    expect(promotionBlockers(draftFrom({ ...complete, milestone_key: null }, 0))).toEqual([])
    expect(promotionBlockers(draftFrom({ ...complete, due_date: null }, 2))).toEqual(['deadline'])
  })
})

describe('describeBlockers', () => {
  it('reads as a sentence fragment', () => {
    expect(describeBlockers([])).toBe('')
    expect(describeBlockers(['deadline'])).toBe('a deadline')
  })
})
