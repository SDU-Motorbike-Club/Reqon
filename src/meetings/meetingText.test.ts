import { describe, expect, it } from 'vitest'
import { emailText, isPastDay, meetingWhen, whatsappText, type ShareableMeeting } from './meetingText.ts'

const meeting = (over: Partial<ShareableMeeting> = {}): ShareableMeeting => ({
  title: 'Chassis sync', held_on: '2026-09-10', starts_at: '18:00:00', ends_at: '19:30:00',
  location: 'Workshop', agenda: '## Agenda\n\n- Frame weld\n- **Budget** check\n\n\n\n- AOB', ...over,
})

describe('meetingWhen', () => {
  it('says the weekday, the day and the time range', () => {
    expect(meetingWhen(meeting())).toBe('Thu, 10 Sept 2026, 18:00–19:30')
  })
  it('leaves the time out when none is fixed, and the end when only a start is', () => {
    expect(meetingWhen(meeting({ starts_at: null, ends_at: null }))).toBe('Thu, 10 Sept 2026')
    expect(meetingWhen(meeting({ ends_at: null }))).toBe('Thu, 10 Sept 2026, 18:00')
  })
  it('never invents a day from a bad date', () => {
    expect(meetingWhen(meeting({ held_on: 'soon' }))).toBe('soon')
  })
})

describe('isPastDay', () => {
  it('is true only for a day before today', () => {
    expect(isPastDay('2026-09-09', '2026-09-10')).toBe(true)
    expect(isPastDay('2026-09-10', '2026-09-10')).toBe(false)
    expect(isPastDay('2026-09-11', '2026-09-10')).toBe(false)
  })
  it('says nothing about an empty or unfinished date', () => {
    expect(isPastDay('', '2026-09-10')).toBe(false)
    expect(isPastDay('2026-09', '2026-09-10')).toBe(false)
  })
})

describe('whatsappText', () => {
  it('bolds the title, lists the facts and turns Markdown into chat formatting', () => {
    expect(whatsappText(meeting(), 'Chassis')).toBe(
      [
        '*Chassis sync*',
        'When: Thu, 10 Sept 2026, 18:00–19:30',
        'Where: Workshop',
        'For: Chassis',
        '',
        '*Agenda*',
        '',
        '- Frame weld',
        '- *Budget* check',
        '',
        '- AOB',
      ].join('\n'),
    )
  })
  it('skips the lines it has nothing for', () => {
    expect(whatsappText(meeting({ location: null, agenda: null }), null)).toBe(
      '*Chassis sync*\nWhen: Thu, 10 Sept 2026, 18:00–19:30',
    )
  })
})

describe('emailText', () => {
  it('gives a subject with the date and a plain body', () => {
    const { subject, body } = emailText(meeting(), null)
    expect(subject).toBe('Chassis sync, Thu, 10 Sept 2026, 18:00–19:30')
    expect(body).toContain('When: Thu, 10 Sept 2026, 18:00–19:30')
    expect(body).toContain('Agenda:\nAgenda\n')
    expect(body).toContain('- Budget check')
    expect(body).not.toMatch(/[*#]/)
    expect(body.startsWith('Hi all,')).toBe(true)
    expect(body.endsWith('See you there.')).toBe(true)
  })
})
