import { createContext, useContext } from 'react'

// Opens the "Report a bug" dialog. With `details` (an error's text) the report is an error report and carries that
// text; with none it is a manual report. Null outside the provider (the crash screen, tests), where the buttons that
// use it simply do not appear.
export type OpenBugReport = (details?: string) => void

export const BugReportContext = createContext<OpenBugReport | null>(null)

export function useBugReport(): OpenBugReport | null {
  return useContext(BugReportContext)
}
