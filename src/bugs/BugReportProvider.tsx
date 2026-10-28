import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { BugReportContext } from './bugReportContext.ts'
import { ReportBugDialog } from './ReportBugDialog.tsx'

// One "Report a bug" dialog for the whole signed-in app. Anything that wants to offer it (the button next to
// Inbox, an error message) calls the function from useBugReport() instead of carrying its own dialog.
export function BugReportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; details: string | null }>({ open: false, details: null })
  const open = useCallback((details?: string) => setState({ open: true, details: details ?? null }), [])
  const value = useMemo(() => open, [open])
  return (
    <BugReportContext.Provider value={value}>
      {children}
      <ReportBugDialog open={state.open} details={state.details} onClose={() => setState((s) => ({ ...s, open: false }))} />
    </BugReportContext.Provider>
  )
}
