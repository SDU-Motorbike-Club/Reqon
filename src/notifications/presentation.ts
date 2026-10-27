import { ROLE_LABELS, type PrivilegedRole } from '../auth/permissions.ts'
import type { Database } from '../lib/database.types.ts'

export type Notification = Database['public']['Tables']['notifications']['Row']

// The kinds notify_from_activity() writes (20260139000000_notifications.sql).
// An unknown kind — a newer database than this client — still reads sensibly.
export type NotificationKind =
  | 'task_assigned'
  | 'task_blocked'
  | 'review_requested'
  | 'proposal_approved'
  | 'changes_requested'
  | 'proposal_rejected'
  | 'proposal_promoted'
  | 'proposal_comment'
  | 'role_granted'
  | 'meeting_called'

export type NotificationView = {
  // One sentence, said to the person reading it.
  text: string
  // Where acting on it happens.
  to: string
}

// "the task “X”" with a title, "a task" without one.
function named(noun: string, title: string | null, without = `a ${noun}`): string {
  return title ? `the ${noun} “${title}”` : without
}

export function describeNotification(n: Pick<Notification, 'kind' | 'title' | 'entity_id'>, actorName: string | null): NotificationView {
  const who = actorName ?? 'Someone'
  const yours = n.title ? `your proposal “${n.title}”` : 'your proposal'
  const task = `/board?task=${encodeURIComponent(n.entity_id)}`
  switch (n.kind as NotificationKind) {
    case 'task_assigned':
      return { text: `${who} gave you ${named('task', n.title)}.`, to: task }
    case 'task_blocked':
      return { text: `${n.title ? `“${n.title}”` : 'A task'} is blocked${actorName ? ` (marked by ${actorName})` : ''}.`, to: task }
    case 'review_requested':
      return { text: `${n.title ? `“${n.title}”` : 'A proposal'} waits for your review.`, to: '/proposals' }
    case 'proposal_approved':
      return { text: `${who} approved ${yours}.`, to: '/proposals?scope=mine' }
    case 'changes_requested':
      return { text: `${who} asked for changes to ${yours}.`, to: '/proposals?scope=mine' }
    case 'proposal_rejected':
      return { text: `${who} rejected ${yours}.`, to: '/proposals?scope=mine&view=history' }
    case 'proposal_promoted':
      return { text: `${yours.charAt(0).toUpperCase()}${yours.slice(1)} is now a task on the Board.`, to: '/proposals?scope=mine&view=history' }
    case 'proposal_comment':
      return { text: `${who} commented on ${named('proposal', n.title)}.`, to: '/proposals' }
    case 'role_granted': {
      const role = n.title && n.title in ROLE_LABELS ? ROLE_LABELS[n.title as PrivilegedRole] : n.title
      return { text: role ? `${who} gave you the ${role} role.` : `${who} gave you a new role.`, to: '/settings' }
    }
    case 'meeting_called':
      return { text: `${who} called a meeting for your department${n.title ? `: “${n.title}”` : ''}.`, to: '/meetings' }
    default:
      return { text: `${who}: ${n.kind.replaceAll('_', ' ')}${n.title ? ` — ${n.title}` : ''}.`, to: '/' }
  }
}
