import { describe, expect, it } from 'vitest'
import { groupBoardTasks, nestUnderParents, topLevelId } from './hierarchy.ts'

const t = (id: string, parent_id: string | null = null) => ({ id, parent_id })
const ids = (list: { id: string }[]) => list.map((x) => x.id)

describe('groupBoardTasks', () => {
  const all = [t('shirts'), t('design', 'shirts'), t('funds', 'shirts'), t('order', 'shirts'), t('website'), t('orphan', 'gone')]

  it('shows parents only, with every subtask underneath', () => {
    const { tops, childrenOf } = groupBoardTasks(all, all, false)
    expect(ids(tops)).toEqual(['shirts', 'website', 'orphan'])
    expect(ids(childrenOf.get('shirts') ?? [])).toEqual(['design', 'funds', 'order'])
  })

  it('pulls the parent in when only a subtask matches the filters, once', () => {
    const { tops } = groupBoardTasks([all[1], all[2]], all, false)
    expect(ids(tops)).toEqual(['shirts'])
  })

  it('keeps a subtask whose parent is not loaded as a card of its own', () => {
    expect(ids(groupBoardTasks([all[5]], all, false).tops)).toEqual(['orphan'])
  })

  it('is flat for My tasks: matching subtasks are plain cards and nothing nests', () => {
    const { tops, childrenOf } = groupBoardTasks([all[1]], all, true)
    expect(ids(tops)).toEqual(['design'])
    expect(childrenOf.size).toBe(0)
  })
})

describe('nestUnderParents', () => {
  const task = (id: string, parent_id: string | null = null) => ({ id, title: `Task ${id}`, parent_id })
  const all = [task('p'), task('a', 'p'), task('b', 'p'), task('x'), task('far', 'p')]

  it('puts a subtask right under its parent when both are in the group', () => {
    const group = [all[1], all[3], all[0], all[2]] // a, x, p, b
    expect(nestUnderParents(group, all).map((i) => `${i.task.id}${i.nested ? '*' : ''}`)).toEqual(['x', 'p', 'a*', 'b*'])
  })

  it('keeps a subtask whose parent is elsewhere in place and names the parent', () => {
    const items = nestUnderParents([all[4], all[3]], all) // far (its parent p is not in the group), x
    expect(items.map((i) => [i.task.id, i.nested, i.partOf])).toEqual([['far', false, 'Task p'], ['x', false, null]])
  })
})

describe('topLevelId', () => {
  const all = [t('p'), t('c', 'p'), t('o', 'gone')]
  it('maps a subtask to its parent card, and leaves everything else alone', () => {
    expect(topLevelId('c', all, false)).toBe('p')
    expect(topLevelId('p', all, false)).toBe('p')
    expect(topLevelId('o', all, false)).toBe('o')
    expect(topLevelId('c', all, true)).toBe('c')
    expect(topLevelId(null, all, false)).toBeNull()
  })
})
