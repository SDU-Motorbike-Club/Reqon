import type { TaskPriority } from '../tasks/types.ts'

// What a NEW proposal must carry (ADR-0005, mirrored from submit_proposal()): a title and a deadline. A
// department, a milestone and requirements are optional.
// The database refuses an incomplete one on every path; this module only lets
// a form say WHAT is missing before a round trip, and lets the data layer
// refuse to send a request it already knows is invalid. Pure and dependency
// free so a form, a hook and a test can all use it.
export type NewProposal = {
  title: string
  description?: string | null
  // Optional (20260149000000): a proposal with no department is reviewed by the President, Vice President or a Developer.
  departmentKey?: string
  // YYYY-MM-DD — a calendar date, never an instant.
  dueDate: string
  // Optional (20260149000000): it can be added later, on the task. Empty means none.
  milestoneKey?: string
  // clauses.clause_key values, never printed references (not unique). Optional, like the milestone.
  requirementKeys?: string[]
  priority?: TaskPriority
  ownerId?: string | null
}

export type SubmissionProblem = 'title' | 'dueDate'

export const MAX_TITLE_LENGTH = 200
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function submissionProblems(input: Partial<NewProposal>): SubmissionProblem[] {
  const problems: SubmissionProblem[] = []
  const title = (input.title ?? '').trim()
  if (title.length < 1 || title.length > MAX_TITLE_LENGTH) problems.push('title')
  if (!input.dueDate || !DATE_ONLY.test(input.dueDate) || Number.isNaN(Date.parse(input.dueDate))) {
    problems.push('dueDate')
  }
  return problems
}

export const PROBLEM_LABEL: Record<SubmissionProblem, string> = {
  title: 'a title',
  dueDate: 'a deadline',
}

// The sentence shown next to a field that is missing or invalid.
export const PROBLEM_MESSAGE: Record<SubmissionProblem, string> = {
  title: `Enter a title of 1 to ${MAX_TITLE_LENGTH} characters.`,
  dueDate: 'Choose a deadline.',
}
