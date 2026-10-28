import type { ReactNode } from 'react'
import { placeDay, type Span } from './ganttModel.ts'

// Shared chart primitives: the label-column/timeline grid, the track shapes are
// drawn in, and the shapes themselves. Used by every row level and by the ruler
// in Gantt.tsx, so all of them share one left edge and one drawing rule.
//
// Two shapes and a line, so nothing depends on colour alone (the legend in GanttLegend.tsx explains each):
//   dashed line + "Today" on the ruler   today
//   flag ⚑ (red)                         a submission's deadline
//   dot ●                                a task's date (its deadline, or its start when it has no deadline)
//   "!" in red / "✓" in green            the dot of overdue / finished work
// There are no bars: a window or a period was a second shape for the same fact. Every mark is decorative to
// assistive technology (aria-hidden); the same fact is written out as text in the row's summary (`summary` on
// Track), and carries a short date caption ("Due 27 Nov") so it reads without hovering.

// On a phone the chart has no room: a row is just its label (the facts are in words under the name) and the bars
// are left to assistive technology only. From `sm` up it is the label column beside the timeline.
export const ROW = 'grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(17rem,24rem)_1fr]'

// The label column stays visible while the timeline scrolls under it — the whole
// point of the weekly scale is a chart wider than the screen.
export const STICKY_LABEL = 'sticky left-0 z-10 self-stretch'

// A mark's date caption: after the mark, or before it when the mark sits near
// the right edge so the text stays inside the track.
function Caption({ from, to, text }: { from: number; to: number; text: string }) {
  const style = to <= 75 ? { left: `calc(${to}% + 12px)` } : { right: `calc(${100 - from}% + 12px)` }
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 z-[1] -translate-y-1/2 whitespace-nowrap px-1 text-xs leading-4 text-slate-600"
      style={style}
    >
      {text}
    </span>
  )
}

export const selectSmall =
  'min-h-11 rounded-md border border-slate-300 bg-surface px-1.5 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'

// The track every mark is drawn in, with the "today" line on top of it. The line
// is repeated per row rather than laid over the whole chart, so it cannot drift
// out of alignment when a row changes height. `summary` is the row's facts in
// words, read by assistive technology.
export function Track({
  today,
  children,
  label,
  summary,
  onClick,
}: {
  today: number | null
  label?: string
  summary?: string
  // A mouse shortcut only (the row's own button does the same for keyboard and screen readers).
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={`relative h-8 max-sm:sr-only ${onClick ? 'cursor-pointer' : ''} [background-image:var(--gantt-grid-img)] [background-position:var(--gantt-grid-pos)] [background-size:var(--gantt-grid-size)] bg-no-repeat`}
    >
      {today !== null && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 border-l border-dashed border-accent-ring/80"
          style={{ left: `${today}%` }}
        />
      )}
      {label && (
        <span className="absolute inset-y-0 left-2 flex items-center text-xs text-slate-500">{label}</span>
      )}
      {children}
      {summary && <span className="sr-only">{summary}</span>}
    </div>
  )
}

export type MarkerKind = 'milestone-deadline' | 'task-deadline' | 'task-start'

const MARKER_GLYPH: Record<MarkerKind, string> = {
  'milestone-deadline': '⚑',
  'task-deadline': '●',
  'task-start': '●',
}

// A single-day mark: the hard deadline of a submission, or a task with only one
// date. `overdue` and `done` swap in "!" and "✓" and change the tone, so the
// state reads from the symbol, not only from red or grey.
export function Marker({
  day,
  range,
  kind,
  title,
  overdue,
  done,
  caption,
}: {
  day: string
  range: Span
  kind: MarkerKind
  title: string
  overdue?: boolean
  done?: boolean
  caption?: string
}) {
  const left = placeDay(day, range)
  if (left === null) return null
  const glyph = done ? '✓' : overdue ? '!' : MARKER_GLYPH[kind]
  // The deadline diamond is the one red mark on a calm chart: a deadline is the thing the chart is for.
  const tone = done ? 'text-ok' : overdue ? 'text-accent-ring' : kind === 'milestone-deadline' ? 'text-accent' : 'text-slate-700'
  return (
    <>
      <span
        aria-hidden="true"
        title={title}
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-base font-bold leading-none ${tone}`}
        style={{ left: `${left}%` }}
      >
        {glyph}
      </span>
      {caption && <Caption from={left} to={left} text={caption} />}
    </>
  )
}
