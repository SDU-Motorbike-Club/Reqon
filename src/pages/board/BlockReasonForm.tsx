import { useMemo, useState } from 'react'
import { isSatisfied, type TaskRef } from '../../tasks/dependencies.ts'
import { buttonPrimary, buttonSecondary } from '../../ui/buttons.ts'
import { MAX_BLOCKER_REASON } from './taskEditPlan.ts'
import { TaskPicker } from './TaskPicker.tsx'

// The question asked before a task is moved to Blocked with no prerequisite
// task to explain it: why? Shared by the Board card and the Gantt row so both
// ask the same way and send the same thing. It writes nothing itself: Block
// hands the trimmed reason to the caller, which sends it together with the
// state in the one task edit (the database refuses Blocked without either).
// Not a way to make a task: the text is a blocker reason on an existing one.
export function BlockReasonForm({
  taskTitle,
  fieldId,
  testId,
  returnFocusId,
  busy = false,
  blockers,
  error,
  onBlock,
  onCancel,
}: {
  taskTitle: string
  fieldId: string
  testId: string
  // The control that opened this form; it gets focus back when the form closes, so
  // a keyboard or screen-reader user is not dropped at the top of the page.
  returnFocusId: string
  busy?: boolean
  // When given, the form also offers a search for the task that is blocking this one; choosing it stands in
  // for a written reason (the caller links it as a prerequisite). Only unfinished tasks are offered.
  blockers?: { candidates: readonly TaskRef[]; departmentName: (key: string | null) => string }
  // A failure from the caller's save, shown under the buttons (the form stays open).
  error?: string | null
  onBlock: (reason: string, blockedBy?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [blockedBy, setBlockedBy] = useState('')
  const open = useMemo(() => (blockers?.candidates ?? []).filter((t) => !isSatisfied(t)), [blockers])
  // Focus goes back to the control that opened the form when the person closes it. Done in the
  // handlers, not on unmount, so an unrelated unmount (a filter change) never moves focus.
  // After a Block the control is disabled while the move saves, and the card re-renders in another lane, so
  // focus waits (up to about two seconds) until the control exists again and accepts it.
  const close = (then: () => void) => {
    then()
    let frames = 0
    const restore = () => {
      const target = document.getElementById(returnFocusId) as (HTMLElement & { disabled?: boolean }) | null
      if (target && !target.disabled) {
        target.focus()
        return
      }
      if (++frames < 120) requestAnimationFrame(restore)
    }
    requestAnimationFrame(restore)
  }
  return (
    <form
      className="mt-2 space-y-1 rounded border border-amber-300 bg-amber-50 p-2"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = reason.trim()
        if (trimmed === '' && blockedBy === '') return
        close(() => onBlock(trimmed, blockedBy || undefined))
      }}
    >
      <label htmlFor={fieldId} className="block text-xs font-medium text-amber-950">
        Why is “{taskTitle}” blocked?
      </label>
      <textarea
        id={fieldId}
        rows={2}
        value={reason}
        maxLength={MAX_BLOCKER_REASON}
        autoFocus
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded border border-slate-300 bg-surface px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
      />
      {blockers ? (
        <TaskPicker
          id={`${fieldId}-by`}
          label="Or search the task that blocks it"
          candidates={open}
          departmentName={blockers.departmentName}
          value={blockedBy}
          onChange={setBlockedBy}
          disabled={busy}
        />
      ) : (
        <p className="text-[11px] text-amber-900">
          Name what is being waited for. To block on another task instead, link it under Details → Waits for.
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimary} disabled={(reason.trim() === '' && blockedBy === '') || busy}>
          Block task
        </button>
        <button type="button" className={buttonSecondary} onClick={() => close(onCancel)}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-800">
          {error}
        </p>
      )}
    </form>
  )
}
