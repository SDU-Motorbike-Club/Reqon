import { formatDay } from '../../lib/dates.ts'
import type { Milestone } from '../../milestones/types.ts'
import { taskProgress } from '../../tasks/progress.ts'
import type { Task } from '../../tasks/types.ts'

// The arithmetic behind the Gantt: where a bar sits and how far along it is.
// Kept out of the screen so both can be tested without rendering a chart, and
// so nobody has to read JSX to find out how a percentage was arrived at.
//
// Everything here is a plain YYYY-MM-DD string. Those sort correctly as text,
// so the minimum and maximum of a set of dates need no Date objects at all —
// and no time zone can shift a bar by a day on someone else's laptop.

const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/

export type Span = { from: string; to: string }
export type Box = { left: number; width: number }

export function isDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DAY.test(value)
}

// Whole days since the epoch. Only ever used for differences, never displayed.
function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS)
}

function isoOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

// Day 0 of the following month is the last day of this one, and Date.UTC rolls
// December over into January of the next year on its own.
function monthEnd(iso: string): string {
  const [year, month] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function nextMonth(iso: string): string {
  const [year, month] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
}

// The chart's horizontal extent, widened to whole months so the month ruler
// lines up with the bars underneath it. Today is always included: a chart whose
// "today" line sits off the edge tells you nothing about where you are.
export function timelineRange(dates: (string | null | undefined)[], today: string): Span {
  const days = [today, ...dates.filter(isDay)].map((d) => d.slice(0, 10))
  const first = days.reduce((a, b) => (b < a ? b : a))
  const last = days.reduce((a, b) => (b > a ? b : a))
  return { from: monthStart(first), to: monthEnd(last) }
}

// Where a span sits in the track, as CSS percentages. Both ends are inclusive,
// so a task due on one single day still gets a visible sliver instead of a bar
// of zero width. Returns null for a span entirely outside the chart.
export function placeBar(span: Span, range: Span): Box | null {
  const from = span.from <= span.to ? span.from : span.to
  const to = span.from <= span.to ? span.to : span.from
  if (to < range.from || from > range.to) return null

  const start = from < range.from ? range.from : from
  const end = to > range.to ? range.to : to
  const total = dayNumber(range.to) - dayNumber(range.from) + 1
  return {
    left: ((dayNumber(start) - dayNumber(range.from)) / total) * 100,
    width: ((dayNumber(end) - dayNumber(start) + 1) / total) * 100,
  }
}

// Whole days the chart spans, both ends inclusive — the unit a dragged bar's
// pixel distance is converted into.
export function rangeDays(range: Span): number {
  return dayNumber(range.to) - dayNumber(range.from) + 1
}

// A calendar day moved by whole days. Pure string arithmetic in UTC, so no
// time zone can shift a dragged deadline by one.
export function shiftDay(iso: string, days: number): string {
  return isoOfDay(dayNumber(iso) + days)
}

// Where a single date sits, as a percentage — for the "today" line.
export function placeDay(iso: string, range: Span): number | null {
  const box = placeBar({ from: iso, to: iso }, range)
  return box ? box.left : null
}

export type Tick = Box & { key: string; label: string }

// One label per month across the range. Capped so a nonsense range (a date
// typed as the year 9999) cannot spin here forever.
export function monthTicks(range: Span): Tick[] {
  const ticks: Tick[] = []
  let month = monthStart(range.from)
  for (let guard = 0; guard < 600 && month <= range.to; guard += 1) {
    const end = monthEnd(month)
    const box = placeBar({ from: month, to: end < range.to ? end : range.to }, range)
    if (box) {
      ticks.push({
        ...box,
        key: month.slice(0, 7),
        // "Nov ’26": the apostrophe stops it reading as the 26th of November (the app writes dates as DD/MM/YY), and it is short
        // enough for a month about 65px wide; "Nov 2026" was cut off ("Nov 20…") in a real browser.
        label: `${new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} ’${month.slice(2, 4)}`,
      })
    }
    month = nextMonth(month)
  }
  return ticks
}

// One label per week, from the Monday on or before the range's start. The first
// and last ticks are clipped by placeBar, so a range that does not begin on a
// Monday still gets a correctly sized partial column.
export function weekTicks(range: Span): Tick[] {
  const ticks: Tick[] = []
  const start = dayNumber(range.from)
  // Thursday 1970-01-01 is day 0, so Monday is day % 7 === 4.
  let day = start - ((start - 4) % 7 + 7) % 7
  const end = dayNumber(range.to)
  for (let guard = 0; guard < 600 && day <= end; guard += 1) {
    const from = isoOfDay(day)
    const box = placeBar({ from, to: isoOfDay(day + 6) }, range)
    if (box) {
      ticks.push({
        ...box,
        key: from,
        // The Monday the week starts on, as DD/MM/YY like every other date.
        label: formatDay(from),
      })
    }
    day += 7
  }
  return ticks
}

// The one progress rule (tasks/progress.ts, ADR-0006) — kept under this
// file's existing name so MilestoneRow.tsx/SectionRow.tsx (and the rest of
// this file) need no change. A cancelled task leaves the count entirely;
// percent is null, not 0, when there is nothing to count: "no subtasks yet"
// and "no subtask finished yet" are different facts and the screen says so.
export type { Progress } from '../../tasks/progress.ts'
export const progressOf = taskProgress

export function tasksInSection(tasks: Task[], sectionId: string): Task[] {
  return tasks.filter((t) => t.section_id === sectionId)
}

// A milestone's own bar: the published submission window. Null means TBC, which
// the screen prints as TBC rather than inventing a date to draw.
export function milestoneSpan(milestone: Milestone): Span | null {
  if (!isDay(milestone.due_on)) return null
  return {
    from: isDay(milestone.opens_on) ? milestone.opens_on : milestone.due_on,
    to: milestone.due_on,
  }
}

// The earliest and latest of a set of dates, ignoring the missing ones.
export function spanOfDates(dates: (string | null | undefined)[]): Span | null {
  const days = dates.filter(isDay).map((d) => d.slice(0, 10)).sort()
  return days.length === 0 ? null : { from: days[0], to: days[days.length - 1] }
}

// A section has no dates of its own. Its subtasks' due dates give it one; with
// none, it borrows the milestone's window, which is the honest answer —
// "somewhere inside this submission".
// Starts count as well as deadlines, so a section whose subtasks begin early is
// drawn from that start, not from the first deadline.
export function sectionSpan(tasks: Task[], sectionId: string, fallback: Span | null, subsectionIds: readonly string[] = []): Span | null {
  const ids = new Set([sectionId, ...subsectionIds])
  return spanOfDates(tasks.filter((t) => t.section_id !== null && ids.has(t.section_id)).flatMap((t) => [t.starts_on, t.due_date])) ?? fallback
}

// The order a group lists its tasks in: by when the work begins (its start, else its deadline), then its deadline,
// then its title. A task with no dates goes last. Dates are YYYY-MM-DD text, so they compare as text. A Gantt reads
// from the top left to the bottom right; creation order made the bars zig-zag.
export function compareByDate(
  a: Pick<Task, 'starts_on' | 'due_date' | 'title'>,
  b: Pick<Task, 'starts_on' | 'due_date' | 'title'>,
): number {
  const day = (value: string | null) => (isDay(value) ? value.slice(0, 10) : '9999-99-99')
  return (
    day(a.starts_on ?? a.due_date).localeCompare(day(b.starts_on ?? b.due_date)) ||
    day(a.due_date).localeCompare(day(b.due_date)) ||
    a.title.localeCompare(b.title)
  )
}

// "20/11/26": the same DD/MM/YY as everywhere else, to sit beside a mark.
export function shortDay(iso: string): string {
  return formatDay(iso.slice(0, 10))
}

export const spanCaption = (span: Span) =>
  span.from === span.to ? shortDay(span.from) : `${shortDay(span.from)} → ${shortDay(span.to)}`
