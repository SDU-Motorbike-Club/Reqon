import { describe, expect, it } from 'vitest'
import { decayedScore, orderSections, type SectionMeta, type UsageEntry } from './sectionOrder.ts'

const NOW = new Date('2026-11-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const use = (score: number, days = 0): UsageEntry => ({ score, scoredAt: daysAgo(days) })

// A cut of the real page: three for everyone, four for the people who run the club.
const SECTIONS: SectionMeta[] = [
  { id: 'account', group: 'personal', rank: 0 },
  { id: 'roster', group: 'personal', rank: 1 },
  { id: 'access', group: 'personal', rank: 2 },
  { id: 'handover', group: 'personal', rank: 3 },
  { id: 'departments', group: 'admin', rank: 4 },
  { id: 'milestones', group: 'admin', rank: 5 },
  { id: 'meeting', group: 'admin', rank: 6 },
  { id: 'backups', group: 'admin', rank: 7 },
]
const ids = (list: SectionMeta[]) => list.map((s) => s.id)

describe('decayedScore', () => {
  it('is the score now, half after 30 days, a quarter after 60, and 0 for a section never used', () => {
    expect(decayedScore(use(4), NOW)).toBeCloseTo(4)
    expect(decayedScore(use(4, 30), NOW)).toBeCloseTo(2)
    expect(decayedScore(use(4, 60), NOW)).toBeCloseTo(1)
    expect(decayedScore(undefined, NOW)).toBe(0)
  })
  it('does not grow for a time in the future, and treats garbage as 0', () => {
    expect(decayedScore(use(4, -10), NOW)).toBeCloseTo(4)
    expect(decayedScore({ score: Number.NaN, scoredAt: daysAgo(1) }, NOW)).toBe(0)
    expect(decayedScore({ score: 3, scoredAt: 'not a date' }, NOW)).toBe(0)
  })
})

describe('orderSections', () => {
  it('cold start: with nothing known, the fixed order', () => {
    const out = orderSections(SECTIONS, null, NOW, new Set(), 'account')
    expect(ids(out.personal)).toEqual(['account', 'roster', 'access', 'handover'])
    expect(ids(out.admin)).toEqual(['departments', 'milestones', 'meeting', 'backups'])
    expect(ids(orderSections(SECTIONS, new Map(), NOW, new Set(), 'account').admin)).toEqual(ids(out.admin))
  })

  it('puts the most used first in each group, and never moves a section to the other group', () => {
    const usage = new Map([
      ['handover', use(5)],
      ['roster', use(2)],
      ['backups', use(9)],
      ['meeting', use(3)],
    ])
    const out = orderSections(SECTIONS, usage, NOW, new Set(), 'account')
    expect(ids(out.personal)).toEqual(['account', 'handover', 'roster', 'access'])
    expect(ids(out.admin)).toEqual(['backups', 'meeting', 'departments', 'milestones'])
  })

  it('keeps the pinned section first however little or much it is used', () => {
    const usage = new Map([['account', use(0.1)], ['roster', use(50)]])
    expect(ids(orderSections(SECTIONS, usage, NOW, new Set(), 'account').personal)[0]).toBe('account')
  })

  it('lets an old habit fade: a recent few beat a long-ago many', () => {
    const usage = new Map([['roster', use(20, 120)], ['access', use(3, 1)]])
    // 20 left for 120 days is 20/16 = 1.25; 3 yesterday is about 2.9.
    expect(ids(orderSections(SECTIONS, usage, NOW, new Set(), 'account').personal)).toEqual(['account', 'access', 'roster', 'handover'])
  })

  it('ties fall back to the fixed order', () => {
    const usage = new Map([['milestones', use(2)], ['departments', use(2)]])
    expect(ids(orderSections(SECTIONS, usage, NOW, new Set(), null).admin).slice(0, 2)).toEqual(['departments', 'milestones'])
  })

  it('lifts a section that needs attention above the most used, inside its own group only', () => {
    const usage = new Map([['departments', use(30)], ['roster', use(30)]])
    const out = orderSections(SECTIONS, usage, NOW, new Set(['backups']), 'account')
    expect(ids(out.admin)).toEqual(['backups', 'departments', 'milestones', 'meeting'])
    expect(ids(out.personal)).toEqual(['account', 'roster', 'access', 'handover'])
  })

  it('does not let attention outrank the pinned section', () => {
    const out = orderSections(SECTIONS, null, NOW, new Set(['roster']), 'account')
    expect(ids(out.personal)).toEqual(['account', 'roster', 'access', 'handover'])
  })

  it('leaves out what the person cannot see, and ignores usage for it', () => {
    const visible = SECTIONS.filter((s) => s.group === 'personal')
    const usage = new Map([['backups', use(99)], ['roster', use(1)]])
    const out = orderSections(visible, usage, NOW, new Set(['backups']), 'account')
    expect(out.admin).toEqual([])
    expect(ids(out.personal)).toEqual(['account', 'roster', 'access', 'handover'])
  })

  it('does not change its input', () => {
    const copy = JSON.stringify(SECTIONS)
    orderSections(SECTIONS, new Map([['backups', use(9)]]), NOW, new Set(['backups']), 'account')
    expect(JSON.stringify(SECTIONS)).toBe(copy)
  })
})
