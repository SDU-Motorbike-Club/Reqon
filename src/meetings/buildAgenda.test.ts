import { describe, expect, it } from 'vitest'
import { AGENDA_MARK, buildAgenda, mergeAgenda } from './buildAgenda.ts'
import type { Task } from '../tasks/types.ts'

const t = (title: string, due_date: string | null, state: Task['state'] = 'todo', over: Partial<Task> = {}) =>
  ({ id: title, title, due_date, state, updated_at: '2026-01-01T00:00:00Z', blocked_reason: null, parent_id: null, ...over }) as Task

const sections = (md: string) => {
  const [, due, next, stuck] = md.split(/^### /m)
  return { due, next, stuck }
}

describe('buildAgenda', () => {
  const tasks = [
    t('Inside window', '2026-11-05'),
    t('Before window, done', '2026-10-01', 'done'),
    t('Long overdue, open', '2026-09-01', 'wip'),
    t('Next week', '2026-11-14'),
    t('Too far', '2026-11-30'),
    t('Next week, done', '2026-11-14', 'done'),
    t('Stuck', '2026-12-31', 'blocked', { blocked_reason: 'Waiting for the quote' }),
    t('Dropped recently', null, 'cancelled', { updated_at: '2026-11-04T10:00:00Z' }),
    t('Dropped long ago', null, 'cancelled', { updated_at: '2026-08-04T10:00:00Z' }),
  ]
  const md = buildAgenda({ meetingDate: '2026-11-09', previousMeetingDate: '2026-11-02', tasks })
  const { due, next, stuck } = sections(md)

  it('lists tasks due since the last meeting plus open overdue ones, with status', () => {
    expect(due).toContain('Inside window')
    expect(due).toContain('Long overdue, open')
    expect(due).toContain('In progress')
    expect(due).not.toContain('Before window, done')
    expect(due.indexOf('Long overdue, open')).toBeLessThan(due.indexOf('Inside window'))
  })

  it('lists open tasks due within 10 days after the meeting only', () => {
    expect(next).toContain('Next week')
    expect(next).not.toContain('Too far')
    expect(next).not.toContain('done')
  })

  it('lists blocked tasks with their reason and recent cancellations', () => {
    expect(stuck).toContain('Stuck')
    expect(stuck).toContain('Waiting for the quote')
    expect(stuck).toContain('Dropped recently')
    expect(stuck).not.toContain('Dropped long ago')
  })

  it('falls back to 7 days when there is no previous meeting, and says Nothing for an empty section', () => {
    const only = buildAgenda({ meetingDate: '2026-11-09', previousMeetingDate: null, tasks: [t('Eight days back', '2026-11-01', 'done'), t('Six days back', '2026-11-03', 'done')] })
    const parts = sections(only)
    expect(parts.due).toContain('Six days back')
    expect(parts.due).not.toContain('Eight days back')
    expect(parts.next).toContain('Nothing.')
  })
})

describe('buildAgenda with parent tasks', () => {
  it('lists the subtasks instead of their parent, each naming the parent', () => {
    const md = buildAgenda({
      meetingDate: '2026-11-09',
      previousMeetingDate: '2026-11-02',
      tasks: [
        t('Get club t-shirts', '2026-11-08', 'wip'),
        t('Design shirts', '2026-11-05', 'done', { parent_id: 'Get club t-shirts' }),
        t('Secure funds', '2026-11-08', 'wip', { parent_id: 'Get club t-shirts' }),
      ],
    })
    expect(md).toContain('Design shirts (part of Get club t-shirts)')
    expect(md).toContain('Secure funds (part of Get club t-shirts)')
    expect(md).not.toMatch(/^- Get club t-shirts/m)
  })

  it('still lists a parent that has no subtasks, and a subtask whose parent is not loaded without a label', () => {
    const md = buildAgenda({
      meetingDate: '2026-11-09',
      previousMeetingDate: '2026-11-02',
      tasks: [t('Alone', '2026-11-08', 'wip'), t('Orphan', '2026-11-08', 'wip', { parent_id: 'gone' })],
    })
    expect(md).toMatch(/^- Alone /m)
    expect(md).toMatch(/^- Orphan \(due/m)
  })
})

describe('mergeAgenda', () => {
  const block = `${AGENDA_MARK}\n\n### A\n- one\n`
  it('appends under existing text and replaces its own earlier block', () => {
    const first = mergeAgenda('## Agenda\n\n- Welcome', block)
    expect(first).toBe(`## Agenda\n\n- Welcome\n\n${block}`)
    expect(mergeAgenda(first, `${AGENDA_MARK}\n\n### B\n`)).toBe(`## Agenda\n\n- Welcome\n\n${AGENDA_MARK}\n\n### B\n`)
  })

  it('is just the block when the agenda is empty', () => {
    expect(mergeAgenda('  \n', block)).toBe(block)
  })
})
