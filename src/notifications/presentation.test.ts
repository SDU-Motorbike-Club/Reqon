import { describe, expect, it } from 'vitest'
import { describeNotification } from './presentation.ts'

const n = (kind: string, title: string | null = 'Lighter subframe', entity_id = 't1') => ({ kind, title, entity_id })

describe('describeNotification', () => {
  it('says what needs the reader, by name, and where to act', () => {
    expect(describeNotification(n('task_assigned'), 'Ada Rider')).toEqual({
      text: 'Ada Rider gave you the task “Lighter subframe”.',
      to: '/board?task=t1',
    })
    expect(describeNotification(n('review_requested'), 'Bo Wrench')).toEqual({
      text: '“Lighter subframe” waits for your review.',
      to: '/board?proposals=1',
    })
    expect(describeNotification(n('changes_requested'), 'Cy Head').text).toBe('Cy Head asked for changes to your proposal “Lighter subframe”.')
    expect(describeNotification(n('proposal_approved'), 'Cy Head').to).toBe('/board?proposals=1&pscope=mine')
    expect(describeNotification(n('proposal_promoted'), 'Cy Head').text).toBe('Your proposal “Lighter subframe” is now a task on the Board.')
    expect(describeNotification(n('task_blocked'), 'Di Coder').text).toBe('“Lighter subframe” is blocked (marked by Di Coder).')
    expect(describeNotification(n('proposal_comment'), 'Ada Rider').text).toBe('Ada Rider commented on the proposal “Lighter subframe”.')
  })

  it('names a role in words, not its database value', () => {
    expect(describeNotification(n('role_granted', 'vicepresident', 'm1'), 'Ada Rider')).toEqual({
      text: 'Ada Rider gave you the Vice President role.',
      to: '/settings',
    })
  })

  it('reads sensibly without an actor or a title', () => {
    expect(describeNotification(n('task_assigned', null), null).text).toBe('Someone gave you a task.')
    expect(describeNotification(n('proposal_rejected', null), null).text).toBe('Someone rejected your proposal.')
    expect(describeNotification(n('proposal_promoted', null), null).text).toBe('Your proposal is now a task on the Board.')
    expect(describeNotification(n('role_granted', null, 'm1'), null).text).toBe('Someone gave you a new role.')
  })

  it('tells about a meeting without claiming whom it is for, since it may be a department or the whole club', () => {
    expect(describeNotification(n('meeting_called', 'Chassis sync', 'mt1'), 'Ada Rider')).toEqual({
      text: 'Ada Rider called a meeting: “Chassis sync”.', to: '/meetings',
    })
  })

  it('reads sensibly for the weekly meeting the system makes, which no person called', () => {
    expect(describeNotification(n('meeting_called', 'Club meeting', 'mt1'), null).text).toBe('A meeting was called: “Club meeting”.')
    expect(describeNotification(n('meeting_called', null, 'mt1'), null).text).toBe('A meeting was called.')
    expect(describeNotification(n('tasks_unassigned', '57 open tasks are not assigned to anyone yet', 'unassigned'), null)).toEqual({
      text: '57 open tasks are not assigned to anyone yet.',
      to: '/tasks',
    })
  })

  it('does not break on a kind this client does not know yet', () => {
    expect(describeNotification(n('meeting_requested', 'Weekly'), 'Ada Rider')).toEqual({ text: 'Ada Rider: meeting requested — Weekly.', to: '/' })
  })

  it('keeps a hostile id inside the query string', () => {
    expect(describeNotification(n('task_assigned', 'x', 'a&scope=all'), null).to).toBe('/board?task=a%26scope%3Dall')
  })
})
