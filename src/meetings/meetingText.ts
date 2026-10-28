import { formatDay, todayIso } from '../lib/dates.ts'
import type { Meeting } from '../data/useMeetings.ts'
import { stripMarkdownEscapes } from './editorMarkdown.ts'

// Ready-made announcements for a meeting, to paste into WhatsApp or an email.
// The club announces meetings in chat first; typing the date, place and agenda
// out again is where the wrong time gets sent.
export type ShareableMeeting = Pick<Meeting, 'title' | 'held_on' | 'starts_at' | 'ends_at' | 'location' | 'agenda'>

const clock = (value: string | null) => (value ? value.slice(0, 5) : null)

// "Thu, 10 Sept 2026, 18:00–19:30"; the time part is left out when none is set.
export function meetingWhen(meeting: Pick<ShareableMeeting, 'held_on' | 'starts_at' | 'ends_at'>): string {
  const day = formatDay(meeting.held_on)
  if (!day) return meeting.held_on
  const weekday = new Date(`${meeting.held_on}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
  const start = clock(meeting.starts_at)
  const end = clock(meeting.ends_at)
  const time = start ? (end ? `${start}–${end}` : start) : null
  return time ? `${weekday}, ${day}, ${time}` : `${weekday}, ${day}`
}

// A date before today. Today itself is not past: a meeting this evening is
// still to come. Compared as YYYY-MM-DD text, so no time zone enters.
export function isPastDay(heldOn: string, today: string = todayIso()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(heldOn) && heldOn < today
}

// The agenda is stored as Markdown. WhatsApp has its own bold (*x*) and no
// headings; an email has neither. Lists are plain "- " lines and read the same.
function agendaFor(markdown: string | null, chat: boolean): string {
  if (!markdown) return ''
  // The editor keeps a backslash before a literal * or # so it is not read as emphasis or a heading; a chat or an
  // email has no Markdown to read, so the backslash would just show.
  return stripMarkdownEscapes(markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
      if (heading) return chat ? `*${heading[1]}*` : heading[1]
      const bold = line.replace(/\*\*(.+?)\*\*/g, chat ? '*$1*' : '$1')
      return bold.replace(/\s+$/, '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
}

function details(meeting: ShareableMeeting, department: string | null): string[] {
  return [
    `When: ${meetingWhen(meeting)}`,
    ...(meeting.location ? [`Where: ${meeting.location}`] : []),
    ...(department ? [`For: ${department}`] : []),
  ]
}

export function whatsappText(meeting: ShareableMeeting, department: string | null): string {
  const agenda = agendaFor(meeting.agenda, true)
  return [`*${meeting.title}*`, ...details(meeting, department), ...(agenda ? ['', agenda] : [])].join('\n')
}

export function emailText(
  meeting: ShareableMeeting,
  department: string | null,
): { subject: string; body: string } {
  const agenda = agendaFor(meeting.agenda, false)
  return {
    subject: `${meeting.title}, ${meetingWhen(meeting)}`,
    body: ['Hi all,', '', `We are meeting: ${meeting.title}.`, '', ...details(meeting, department),
      ...(agenda ? ['', 'Agenda:', agenda] : []), '', 'See you there.'].join('\n'),
  }
}
