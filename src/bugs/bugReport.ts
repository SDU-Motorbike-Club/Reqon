// What a bug report carries, and how it is cleaned before it is sent. Pure, so the form, the crash screen and the
// tests all use the same limits (the database enforces the same ones: bug_reports_message/details/page checks).
export const MAX_MESSAGE = 2000
export const MAX_DETAILS = 4000
const MAX_PAGE = 300
const MAX_AGENT = 300

export type BugSource = 'manual' | 'error'

export type BugReportInput = {
  source: BugSource
  // What the person says went wrong. May be empty when an error text is attached.
  message: string
  // The error text, for a report made from an error message or the crash screen.
  details?: string | null
}

export type CleanBugReport = {
  source: BugSource
  message: string
  details: string | null
  page: string | null
  user_agent: string | null
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// The report as it is stored: trimmed, within the limits, with the page path (no query string or hash, which may
// carry ids nobody needs) and the browser's name. Returns null when there is nothing to report: no text and no error.
export function cleanReport(input: BugReportInput, where: { path: string; userAgent: string }): CleanBugReport | null {
  const message = cut(input.message.trim(), MAX_MESSAGE)
  const details = input.details?.trim() ? cut(input.details.trim(), MAX_DETAILS) : null
  if (message === '' && details === null) return null
  return {
    source: input.source,
    message,
    details,
    page: where.path ? cut(where.path.split(/[?#]/)[0], MAX_PAGE) : null,
    user_agent: where.userAgent ? cut(where.userAgent, MAX_AGENT) : null,
  }
}

// An error as one short block of text: its name and message, and the first lines of where it came from.
export function errorDetails(error: Error): string {
  const head = `${error.name}: ${error.message}`
  const stack = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, 6)
    .join('\n')
  return cut(stack ? `${head}\n${stack}` : head, MAX_DETAILS)
}
