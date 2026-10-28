import { describe, expect, it } from 'vitest'
import { submissionProblems, type NewProposal } from './submission.ts'

const complete: NewProposal = {
  title: 'Mount the rear wing',
  departmentKey: 'AERO',
  dueDate: '2026-12-01',
  milestoneKey: 'MS1-1',
  requirementKeys: ['A.1.1.1'],
}

describe('submissionProblems', () => {
  it('accepts a complete proposal', () => {
    expect(submissionProblems(complete)).toEqual([])
  })

  it.each<[string, Partial<NewProposal>]>([
    ['title', { title: '   ' }],
    ['title', { title: 'x'.repeat(201) }],
    ['dueDate', { dueDate: '' }],
    ['dueDate', { dueDate: '2026-13-45' }],
    ['dueDate', { dueDate: '2026-12-01T10:00:00Z' }],
  ])('names the missing %s', (problem, override) => {
    expect(submissionProblems({ ...complete, ...override })).toEqual([problem])
  })

  it('needs only a title and a deadline: a department, a milestone and requirements are optional', () => {
    expect(submissionProblems({ title: 'Mount the rear wing', dueDate: '2026-12-01' })).toEqual([])
    expect(submissionProblems({ ...complete, departmentKey: '', milestoneKey: '', requirementKeys: [] })).toEqual([])
  })

  it('reports every missing field at once', () => {
    expect(submissionProblems({})).toEqual(['title', 'dueDate'])
  })
})
