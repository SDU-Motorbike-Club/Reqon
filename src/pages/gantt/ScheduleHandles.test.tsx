import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ScheduleHandles } from './ScheduleHandles.tsx'

// October 2026 on a 310 px track: one day is 10 px.
const RANGE = { from: '2026-10-01', to: '2026-10-31' }

beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => {}
})

function renderHandles(dates: { start: string | null; due: string | null }) {
  const onPreview = vi.fn()
  const onCommit = vi.fn()
  const view = render(
    <div data-testid="track">
      <ScheduleHandles dates={dates} range={RANGE} title="Weld" onPreview={onPreview} onCommit={onCommit} />
    </div>,
  )
  const track = view.container.firstElementChild as HTMLElement
  track.getBoundingClientRect = () => ({ width: 310, left: 0, right: 310, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) })
  const part = (name: string) => view.container.querySelector(`[data-schedule-part="${name}"]`) as HTMLElement
  const drag = (el: HTMLElement, dx: number) => {
    fireEvent.pointerDown(el, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 100 + dx, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 100 + dx, pointerId: 1 })
  }
  return { onPreview, onCommit, part, drag }
}

describe('ScheduleHandles', () => {
  it('moves the deadline of a task with both dates and leaves the start alone, committing once on release', () => {
    const { part, drag, onCommit, onPreview } = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    drag(part('end'), 30)
    expect(onPreview).toHaveBeenCalledWith({ start: '2026-10-05', due: '2026-10-13' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ start: '2026-10-05', due: '2026-10-13' })
  })

  it('moves both dates together when the body of a bar is dragged', () => {
    const { part, drag, onCommit } = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    drag(part('move'), -30)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ start: '2026-10-02', due: '2026-10-07' })
  })

  it('changes only the start from the left end, and never past the deadline', () => {
    const early = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    early.drag(early.part('start'), -20)
    expect(early.onCommit).toHaveBeenCalledWith({ start: '2026-10-03', due: '2026-10-10' })
    const past = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    past.drag(past.part('start'), 200)
    expect(past.onCommit).toHaveBeenCalledWith({ start: '2026-10-10', due: '2026-10-10' })
  })

  it('draws three handles for a bar (body and both ends), and one for a dot', () => {
    const bar = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    expect([bar.part('move'), bar.part('start'), bar.part('end')].every(Boolean)).toBe(true)
    const dot = renderHandles({ start: null, due: '2026-10-20' })
    expect(dot.part('end')).toBeTruthy()
    expect(dot.part('start')).toBeNull()
  })

  it('never lets the deadline pass before the start', () => {
    const { part, drag, onCommit } = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    drag(part('end'), -100)
    expect(onCommit).toHaveBeenCalledWith({ start: '2026-10-05', due: '2026-10-05' })
  })

  it('moves a deadline-only task, and a tiny wobble commits nothing', () => {
    const marker = renderHandles({ start: null, due: '2026-10-20' })
    marker.drag(marker.part('end'), -10)
    expect(marker.onCommit).toHaveBeenCalledWith({ start: null, due: '2026-10-19' })
    const wobble = renderHandles({ start: null, due: '2026-10-20' })
    wobble.drag(wobble.part('end'), 2)
    expect(wobble.onCommit).not.toHaveBeenCalled()
    expect(wobble.onPreview).toHaveBeenLastCalledWith(null)
  })

  it('moves the start of a task that has only a start', () => {
    const { part, drag, onCommit } = renderHandles({ start: '2026-10-05', due: null })
    drag(part('move'), 20)
    expect(onCommit).toHaveBeenCalledWith({ start: '2026-10-07', due: null })
  })

  it('a cancelled drag (the pointer was taken away) commits nothing and clears the preview', () => {
    const { part, onCommit, onPreview } = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    const el = part('end')
    fireEvent.pointerDown(el, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 150, pointerId: 1 })
    fireEvent.pointerCancel(el, { pointerId: 1 })
    expect(onCommit).not.toHaveBeenCalled()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('ignores a right-click, and draws nothing for undated work', () => {
    const { part, onCommit } = renderHandles({ start: '2026-10-05', due: '2026-10-10' })
    fireEvent.pointerDown(part('end'), { button: 2, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(part('end'), { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(part('end'), { clientX: 200, pointerId: 1 })
    expect(onCommit).not.toHaveBeenCalled()
    const none = renderHandles({ start: null, due: null })
    expect(none.part('end')).toBeNull()
    expect(none.part('move')).toBeNull()
  })
})
