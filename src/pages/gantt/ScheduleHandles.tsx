import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { placeDay, rangeDays, shiftDay, type Span } from './ganttModel.ts'

export type ScheduleDates = { start: string | null; due: string | null }
type Part = 'move' | 'start' | 'end'

// A pointer handle laid over one task's dot on the timeline: drag it to move the
// deadline (or the start, for a task that has only a start). Nothing is written while dragging — the row
// draws a preview; on release the change goes through the ordinary, authorized
// task date update (useUpdateTask → guard_task_edit), which rolls back and
// reports if the database refuses it.
//
// Pointer only, and hidden from assistive technology: the keyboard and touch
// alternative is the row's own Start date / Deadline fields, which make the same
// change. Offered only to someone who may edit the task.
export function ScheduleHandles({
  dates,
  range,
  title,
  onPreview,
  onCommit,
}: {
  dates: ScheduleDates
  range: Span
  title: string
  onPreview: (dates: ScheduleDates | null) => void
  onCommit: (dates: ScheduleDates) => void
}) {
  const drag = useRef<{ part: Part; x0: number; width: number; moved: ScheduleDates | null } | null>(null)

  const next = (part: Part, delta: number): ScheduleDates => {
    const { start, due } = dates
    if (part === 'move') {
      return { start: start ? shiftDay(start, delta) : null, due: due ? shiftDay(due, delta) : null }
    }
    if (part === 'start' && start) {
      const moved = shiftDay(start, delta)
      return { start: due && moved > due ? due : moved, due }
    }
    if (part === 'end' && due) {
      const moved = shiftDay(due, delta)
      return { start, due: start && moved < start ? start : moved }
    }
    return dates
  }

  const down = (part: Part) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    const track = event.currentTarget.parentElement
    if (!track) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { part, x0: event.clientX, width: track.getBoundingClientRect().width, moved: null }
  }
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d || d.width <= 0) return
    const delta = Math.round(((event.clientX - d.x0) / d.width) * rangeDays(range))
    d.moved = delta === 0 ? null : next(d.part, delta)
    onPreview(d.moved)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d?.moved) onCommit(d.moved)
    else onPreview(null)
  }
  const cancel = () => {
    drag.current = null
    onPreview(null)
  }
  const handlers = (part: Part) => ({
    onPointerDown: down(part),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: cancel,
    onLostPointerCapture: () => {
      if (drag.current) cancel()
    },
  })
  const handle = 'absolute inset-y-0 z-[2] touch-none'

  // A task is one dot on its deadline, so dragging it changes the deadline (the start never moves by this).
  const part: Part = dates.due ? 'end' : 'move'
  const day = dates.due ?? dates.start
  if (!day) return null
  const left = placeDay(day, range)
  if (left === null) return null
  return (
    <span
      aria-hidden="true"
      title={`Drag to move the ${dates.due ? 'deadline' : 'start'} of ${title}`}
      className={`${handle} w-4 -translate-x-1/2 cursor-ew-resize rounded hover:bg-slate-900/10`}
      style={{ left: `${left}%` }}
      {...handlers(part)}
      data-schedule-part={part}
    />
  )
}
