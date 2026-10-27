import { describe, expect, it } from 'vitest'
import { groupBySeason, taskCount, type ContributionTask } from './contributionModel.ts'

const task = (id: string, season_id: string, completed_at: string | null, subteam_key: string | null = 'chassis'): ContributionTask => ({
  id, title: `Task ${id}`, season_id, subteam_key, completed_at, archived_at: null,
})
const seasons = [
  { id: 's1', label: '2025-26', is_current: false },
  { id: 's2', label: '2026-27', is_current: true },
  { id: 's0', label: '2024-25', is_current: false },
]

describe('groupBySeason', () => {
  it('puts the current season first, then the others newest first', () => {
    const groups = groupBySeason([task('a', 's0', '2025-01-01T00:00:00Z'), task('b', 's2', '2026-10-01T00:00:00Z'), task('c', 's1', '2025-12-01T00:00:00Z')], seasons)
    expect(groups.map((g) => g.label)).toEqual(['2026-27', '2025-26', '2024-25'])
    expect(groups[0].isCurrent).toBe(true)
  })

  it('lists the most recently finished first and an unknown finish time last', () => {
    const [group] = groupBySeason([task('a', 's2', null), task('b', 's2', '2026-09-01T00:00:00Z'), task('c', 's2', '2026-10-01T00:00:00Z')], seasons)
    expect(group.tasks.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('counts by department, most first, with "no department" last among equals', () => {
    const [group] = groupBySeason([
      task('a', 's2', null, 'chassis'), task('b', 's2', null, 'electronics'), task('c', 's2', null, 'chassis'), task('d', 's2', null, null),
    ], seasons)
    expect(group.byDepartment).toEqual([{ key: 'chassis', count: 2 }, { key: 'electronics', count: 1 }, { key: null, count: 1 }])
  })

  it('keeps a task of a season it does not know, under a plain label', () => {
    const groups = groupBySeason([task('a', 'gone', '2020-01-01T00:00:00Z')], seasons)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('An earlier season')
  })

  it('gives nothing for no tasks', () => {
    expect(groupBySeason([], seasons)).toEqual([])
  })
})

describe('taskCount', () => {
  it('uses the singular for one', () => {
    expect(taskCount(1)).toBe('1 task')
    expect(taskCount(0)).toBe('0 tasks')
    expect(taskCount(12)).toBe('12 tasks')
  })
})
