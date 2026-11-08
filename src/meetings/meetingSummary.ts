import type { Meeting } from '../data/useMeetings.ts'

export const SUMMARY_PLACEHOLDER = 'Summary will appear after the meeting.'
const DERIVED_MAX = 220

// What a card shows as the meeting's summary: the one an administrator wrote or saved, else (for a meeting that
// has happened) the opening lines of its minutes, labelled as such, else nothing. An agenda is never turned into a
// summary: it says what was planned, not what happened.
export function meetingSummary(meeting: Pick<Meeting, 'summary' | 'notes'>): { text: string; fromMinutes: boolean } | null {
  const written = meeting.summary?.trim()
  // The column is older than the minutes: migration 20260108 copied its text into `notes`, so a summary that is
  // just the minutes again is the old copy, not a summary.
  if (written && written !== meeting.notes?.trim()) return { text: written, fromMinutes: false }
  const lines = (meeting.notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}(\s|$)/.test(line))
    .map((line) => line.replace(/^([-*+]|\d+[.)])(\s+|$)/, '').replace(/[*_`\\]/g, '').trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  const joined = lines.join(' ')
  return { text: joined.length > DERIVED_MAX ? `${joined.slice(0, DERIVED_MAX).trimEnd()}…` : joined, fromMinutes: true }
}
