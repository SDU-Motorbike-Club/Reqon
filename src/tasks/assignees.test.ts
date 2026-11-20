import { describe, expect, it } from 'vitest'
import { assigneeIds, groupAssignees, isAssignee, sameAssignees } from './assignees.ts'
import { tasksInScope } from './scope.ts'

const byTask = groupAssignees([
  { task_id: 't1', member_id: 'ana' },
  { task_id: 't1', member_id: 'ben' },
  { task_id: 't2', member_id: 'cat' },
])

describe('assignees', () => {
  it('lists the lead first, then the others, without repeating the lead', () => {
    expect(assigneeIds({ id: 't1', owner_id: 'ben' }, byTask)).toEqual(['ben', 'ana'])
  })

  it('still shows the owner before the assignees have loaded, and nobody for an unowned task', () => {
    expect(assigneeIds({ id: 't1', owner_id: 'ana' }, undefined)).toEqual(['ana'])
    expect(assigneeIds({ id: 't9', owner_id: null }, byTask)).toEqual([])
  })

  it('knows who is assigned', () => {
    expect(isAssignee({ id: 't1', owner_id: 'ana' }, 'ben', byTask)).toBe(true)
    expect(isAssignee({ id: 't1', owner_id: 'ana' }, 'cat', byTask)).toBe(false)
    expect(isAssignee({ id: 't1', owner_id: 'ana' }, null, byTask)).toBe(false)
  })

  it('compares sets regardless of order', () => {
    expect(sameAssignees(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameAssignees(['a'], ['a', 'b'])).toBe(false)
  })

  it('puts a co-assigned task in "My tasks", and leaves it out for a stranger', () => {
    const tasks = [{ id: 't1', owner_id: 'ana' }, { id: 't2', owner_id: 'ana' }]
    expect(tasksInScope(tasks, 'mine', 'ben', byTask)).toEqual([tasks[0]])
    expect(tasksInScope(tasks, 'mine', 'ana')).toEqual(tasks)
  })
})
