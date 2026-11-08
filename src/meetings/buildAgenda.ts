import { formatDay } from '../lib/dates.ts'
import { TASK_STATES } from '../tasks/taskState.ts'
import type { Task } from '../tasks/types.ts'

// The generated block always starts with this heading, so pressing the button again replaces its own block.
export const AGENDA_MARK = '## Tasks to review'
const NEXT_DAYS = 10
const FALLBACK_DAYS = 7

type AgendaTask = Pick<Task, 'id' | 'title' | 'due_date' | 'state' | 'updated_at' | 'blocked_reason' | 'parent_id'>

const isOpen = (t: AgendaTask) => t.state !== 'done' && t.state !== 'cancelled'
const stateLabel = (state: Task['state']) => TASK_STATES.find((s) => s.state === state)?.label ?? state

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Dates are calendar-day strings (YYYY-MM-DD), compared as strings like isOverdue does.
// shortcut: "cancelled since the last meeting" uses updated_at, as there is no cancelled_at; upgrade if a cancellation date is ever stored.
export function buildAgenda(input: { meetingDate: string; previousMeetingDate: string | null; tasks: readonly AgendaTask[] }): string {
  const { meetingDate, previousMeetingDate } = input
  // A parent task is represented by its subtasks, the same rule progress uses; each subtask names its parent.
  const parentIds = new Set(input.tasks.map((t) => t.parent_id).filter((id): id is string => id != null))
  const titles = new Map(input.tasks.map((t) => [t.id, t.title]))
  const tasks = input.tasks.filter((t) => !parentIds.has(t.id))
  const since = previousMeetingDate ?? addDays(meetingDate, -FALLBACK_DAYS)
  const until = addDays(meetingDate, NEXT_DAYS)
  const byDue = (a: AgendaTask, b: AgendaTask) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.title.localeCompare(b.title)

  // Due in the window ending on the meeting day, plus anything older that is still open (overdue).
  const due = tasks.filter((t) => t.due_date !== null && t.due_date <= meetingDate && (t.due_date > since || isOpen(t))).sort(byDue)
  const next = tasks.filter((t) => t.due_date !== null && t.due_date > meetingDate && t.due_date <= until && isOpen(t)).sort(byDue)
  const stuck = tasks.filter((t) => t.state === 'blocked' || (t.state === 'cancelled' && t.updated_at.slice(0, 10) > since)).sort(byDue)

  const line = (t: AgendaTask, reason: boolean) =>
    `- ${t.title}${t.parent_id && titles.has(t.parent_id) ? ` (part of ${titles.get(t.parent_id)})` : ''}${t.due_date ? ` (due ${formatDay(t.due_date)})` : ''} —${stateLabel(t.state)}${reason && t.blocked_reason ? `: ${t.blocked_reason}` : ''}`
  const section = (title: string, list: AgendaTask[], reason = false) =>
    [`### ${title}`, ...(list.length ? list.map((t) => line(t, reason)) : ['- Nothing.'])].join('\n')

  return [
    AGENDA_MARK,
    section('Due since the last meeting', due),
    section(`Next ${NEXT_DAYS} days`, next),
    section('Blocked and cancelled', stuck, true),
  ].join('\n\n') + '\n'
}

// Adds the generated block under what is already written, or swaps out a block generated earlier.
export function mergeAgenda(existing: string, generated: string): string {
  const at = existing.indexOf(AGENDA_MARK)
  const base = (at === -1 ? existing : existing.slice(0, at)).trimEnd()
  return base ? `${base}\n\n${generated}` : generated
}
