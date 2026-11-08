import { describe, expect, it } from 'vitest'
import { splitMeetings } from './splitMeetings'

const m = (id: string, held_on: string) => ({ id, held_on })

describe('splitMeetings', () => {
  it('puts upcoming soonest first, past newest first, and today in upcoming', () => {
    const rows = [m('c', '2026-11-20'), m('b', '2026-11-02'), m('a', '2026-10-01'), m('z', '2026-09-01')]
    const { upcoming, past } = splitMeetings(rows, '2026-11-02')
    expect(upcoming.map((x) => x.id)).toEqual(['b', 'c'])
    expect(past.map((x) => x.id)).toEqual(['a', 'z'])
  })

  it('returns empty groups for no meetings', () => {
    expect(splitMeetings([], '2026-11-02')).toEqual({ upcoming: [], past: [] })
  })
})
