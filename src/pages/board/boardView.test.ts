import { describe, expect, it } from 'vitest'
import { laneWindow } from './boardView.ts'

describe('laneWindow', () => {
  const lane = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }))
  it('shows the first cards and counts the rest', () => {
    const { shown, hidden } = laneWindow(lane, 10, null)
    expect(shown).toHaveLength(10)
    expect(hidden).toBe(15)
  })
  it('keeps the card a link opened in view even beyond the limit', () => {
    const { shown, hidden } = laneWindow(lane, 10, 't20')
    expect(shown.map((x) => x.id)).toContain('t20')
    expect(hidden).toBe(14)
  })
  it('shows a short lane whole', () => {
    expect(laneWindow(lane.slice(0, 4), 10, null)).toMatchObject({ hidden: 0 })
  })
})
