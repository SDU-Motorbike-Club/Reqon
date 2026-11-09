import type { ReactNode } from 'react'
import type { TaskState } from '../../tasks/types.ts'
import { placeBar, placeDay, type Span } from './ganttModel.ts'

// Shared chart primitives: the label-column/timeline grid, the track shapes are
// drawn in, and the shapes themselves. Used by every row level and by the ruler
// in Gantt.tsx, so all of them share one left edge and one drawing rule.
//
// A few shapes and a line, so nothing depends on colour alone (the legend in GanttLegend.tsx explains each):
//   dashed line + "Today" on the ruler   today
//   flag ⚑ (red)                         a submission's deadline
//   wide pale band                       a submission's window, from its opening to its deadline
//   thin bar with end ticks              a section: from its earliest start to its latest deadline
//   outlined bar                         a task with a start and a deadline; its fill and glyph say its state
//   dot ●                                a task with only one date (its deadline, or its start)
//   "!" / "✓" / "×"                      overdue / finished / cancelled work (inside the bar or in place of the dot)
// Bars are thin and outlined on purpose: an earlier version was a wall of boxed tracks. Every mark is decorative to
// assistive technology (aria-hidden); the same fact is written out as text in the row's summary (`summary` on
// Track), and carries a short date caption ("20/11/26 → 25/11/26") so it reads without hovering.

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
      className={`relative h-8 ${onClick ? 'cursor-pointer' : ''} [background-image:var(--gantt-grid-img)] [background-position:var(--gantt-grid-pos)] [background-size:var(--gantt-grid-size)] bg-no-repeat`}
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

// A task bar's outline and fill by state. The colour is the second cue: the glyph inside and the line style (a
// cancelled task is dashed and hollow) say the same thing, so nothing depends on colour alone.
const TASK_BAR: Record<TaskState, string> = {
  todo: 'border-slate-400 bg-slate-400/15',
  wip: 'border-blue-500 bg-blue-500/25',
  blocked: 'border-amber-500 bg-amber-500/25',
  done: 'border-ok bg-ok/40',
  cancelled: 'border-dashed border-slate-300 bg-transparent opacity-70',
}

export type BarVariant =
  // A task with a start and a deadline: an outlined bar, its state in the outline, fill and glyph.
  | { kind: 'task'; state: TaskState; overdue?: boolean; glyph?: string }
  // A submission's window: a wide, pale band behind its deadline flag. `percent` fills it from the left.
  | { kind: 'window'; percent?: number | null }
  // A section: a thin bar from its earliest start to its latest deadline. `percent` fills it from the left.
  | { kind: 'summary'; percent?: number | null }

// A span drawn to scale on the timeline, with its date caption beside it. Returns nothing for a span wholly outside
// the chart. A one-day span is still a visible sliver (min width), never a bar of zero width.
export function Bar({ span, range, variant, title, caption }: { span: Span; range: Span; variant: BarVariant; title: string; caption?: string }) {
  const box = placeBar(span, range)
  if (!box) return null
  const fill = variant.kind === 'task' ? null : variant.percent
  const shape =
    variant.kind === 'task'
        // Overdue replaces the state's outline (two border colours on one element would let the grey win).
      ? `inset-y-2 min-w-[6px] rounded border-2 ${variant.overdue ? 'border-accent-ring bg-accent/20' : TASK_BAR[variant.state]}`
      : variant.kind === 'window'
        ? 'inset-y-1 min-w-[6px] rounded border border-slate-300/40 bg-slate-300/15'
        : 'top-1/2 h-2 min-w-[6px] -translate-y-1/2 rounded-sm bg-slate-400/60'
  return (
    <>
      <span
        aria-hidden="true"
        title={title}
        data-gantt-bar={variant.kind}
        className={`absolute flex items-center justify-start overflow-hidden ${shape}`}
        style={{ left: `${box.left}%`, width: `${box.width}%` }}
      >
        {fill !== null && fill !== undefined && fill > 0 && (
          <span className="absolute inset-y-0 left-0 bg-ok/70" style={{ width: `${Math.min(100, fill)}%` }} />
        )}
        {variant.kind === 'task' && variant.glyph && (
          <span className="relative z-[1] px-0.5 text-[11px] leading-none font-bold text-slate-900">{variant.glyph}</span>
        )}
      </span>
      {caption && <Caption from={box.left} to={box.left + box.width} text={caption} />}
    </>
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
