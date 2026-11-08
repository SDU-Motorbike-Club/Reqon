import { useMeetings } from '../data/useMeetings.ts'
import { useTasks } from '../data/useTasks.ts'
import { buttonSecondary } from '../ui/buttons.ts'
import { buildAgenda, mergeAgenda } from './buildAgenda.ts'

// Fills the agenda with the task sections for this meeting (a snapshot, written as text the user can still edit).
export function GenerateAgenda({
  heldOn,
  meetingId,
  agenda,
  onGenerate,
  disabled,
}: {
  heldOn: string
  meetingId: string | null
  agenda: string
  onGenerate: (agenda: string) => void
  disabled: boolean
}) {
  const tasks = useTasks()
  const meetings = useMeetings()
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(heldOn)

  function generate() {
    const earlier = (meetings.data ?? []).filter((m) => m.id !== meetingId && m.held_on < heldOn).map((m) => m.held_on).sort()
    const previousMeetingDate = earlier[earlier.length - 1] ?? null
    onGenerate(mergeAgenda(agenda, buildAgenda({ meetingDate: heldOn, previousMeetingDate, tasks: tasks.data ?? [] })))
  }

  return (
    <div>
      <button type="button" className={buttonSecondary} disabled={disabled || !validDate || tasks.data === undefined} onClick={generate}>
        Generate agenda from tasks
      </button>
      <p className="mt-1 text-xs text-slate-600">
        {validDate
          ? 'Adds due, upcoming and blocked tasks. Pressing it again replaces them.'
          : 'Pick the meeting date first.'}
      </p>
    </div>
  )
}
