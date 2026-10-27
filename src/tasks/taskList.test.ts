import { describe, expect, it } from 'vitest'
import { clickColumn, DEFAULT_LIST, pageCountFor, parseTaskListParams, searchWords, taskListToParams, withFilter } from './taskList.ts'

const parse = (s: string) => parseTaskListParams(new URLSearchParams(s))

describe('parseTaskListParams', () => {
  it('is the default order for a plain address: soonest deadline first, open tasks, page 1', () => {
    expect(parse('')).toEqual(DEFAULT_LIST)
    expect(DEFAULT_LIST).toMatchObject({ sort: 'due', dir: 'asc', state: 'open', page: 1 })
  })
  it('reads a known column and direction', () => {
    expect(parse('sort=owner&dir=desc')).toMatchObject({ sort: 'owner', dir: 'desc' })
  })
  it('falls back to the default order for an unknown column, and to ascending for an unknown direction', () => {
    expect(parse('sort=owner_id;drop&dir=desc')).toMatchObject({ sort: 'due', dir: 'asc' })
    expect(parse('sort=title&dir=sideways')).toMatchObject({ sort: 'title', dir: 'asc' })
  })
  it('keeps filters apart from the sort, and ignores what it does not know', () => {
    expect(parse('q=brake&dept=BODY&scope=mine&state=blocked&page=3')).toMatchObject({ q: 'brake', department: 'BODY', scope: 'mine', state: 'blocked', page: 3 })
    expect(parse('state=nonsense&scope=everyone&page=-4')).toMatchObject({ state: 'open', scope: 'all', page: 1 })
  })
})

describe('taskListToParams', () => {
  it('writes only what differs from the default', () => {
    expect(taskListToParams(DEFAULT_LIST).toString()).toBe('')
    expect(taskListToParams({ ...DEFAULT_LIST, sort: 'title', dir: 'desc', q: 'x', page: 2 }).toString()).toBe('sort=title&dir=desc&q=x&page=2')
  })
  it('round-trips', () => {
    const list = { ...DEFAULT_LIST, sort: 'milestone' as const, dir: 'desc' as const, department: 'none', scope: 'mine' as const, state: 'all' as const, page: 4 }
    expect(parseTaskListParams(taskListToParams(list))).toEqual(list)
  })
})

describe('clicking a heading', () => {
  it('starts a new column ascending, flips the same one, and returns to page 1', () => {
    const a = clickColumn({ ...DEFAULT_LIST, page: 3 }, 'title')
    expect(a).toMatchObject({ sort: 'title', dir: 'asc', page: 1 })
    expect(clickColumn(a, 'title')).toMatchObject({ sort: 'title', dir: 'desc' })
    expect(clickColumn(clickColumn(a, 'title'), 'title')).toMatchObject({ dir: 'asc' })
    expect(clickColumn(DEFAULT_LIST, 'due')).toMatchObject({ sort: 'due', dir: 'desc' }) // due is already ascending
  })
})

describe('changing a filter', () => {
  it('keeps the sort and goes back to page 1', () => {
    const list = { ...DEFAULT_LIST, sort: 'owner' as const, dir: 'desc' as const, page: 5 }
    expect(withFilter(list, { state: 'done' })).toMatchObject({ sort: 'owner', dir: 'desc', state: 'done', page: 1 })
  })
})

describe('searchWords and pageCountFor', () => {
  it('removes characters that would change a filter, and limits the words', () => {
    expect(searchWords('brake,duct (front) 50% a_b "x"')).toEqual(['brake', 'duct', 'front', '50', 'a', 'b', 'x'].slice(0, 6))
    expect(searchWords('   ')).toEqual([])
  })
  it('counts at least one page', () => {
    expect(pageCountFor(0)).toBe(1)
    expect(pageCountFor(25)).toBe(1)
    expect(pageCountFor(26)).toBe(2)
    expect(pageCountFor(66)).toBe(3)
  })
})
