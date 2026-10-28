// What the weekly-meeting form refuses before anything is sent. The database checks the same things
// (meeting_schedule's check constraints); this is so the person is told which field, in words.
export type ScheduleProblems = { title?: string; startsAt?: string; endsAt?: string; leadDays?: string }

// What is checked; the form's draft has these and more.
export type ScheduleInput = { title: string; startsAt: string; endsAt: string | null; leadDays: number }

export function scheduleProblems(draft: ScheduleInput): ScheduleProblems {
  const found: ScheduleProblems = {}
  if (draft.title.trim() === '') found.title = 'Give the meeting a name.'
  if (draft.startsAt === '') found.startsAt = 'Choose when it starts.'
  if (draft.endsAt && draft.startsAt && draft.endsAt <= draft.startsAt) found.endsAt = 'The end must be after the start.'
  if (!Number.isInteger(draft.leadDays) || draft.leadDays < 1 || draft.leadDays > 21) found.leadDays = 'Between 1 and 21 days.'
  return found
}
