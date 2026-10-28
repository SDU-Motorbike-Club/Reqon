import { useId, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useSendBugReport } from '../data/useBugReports.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError } from '../ui/states.tsx'
import { cleanReport, MAX_MESSAGE } from './bugReport.ts'

// "Report a bug": say what went wrong, in a sentence. A report made from an error message also carries that error's
// text, shown here so nothing is sent that the person cannot see. The page and the browser's name go with it. Only
// a Developer can read the reports.
export function ReportBugDialog({ open, details, onClose }: { open: boolean; details: string | null; onClose: () => void }) {
  const titleId = useId()
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId}>
      <ReportBugForm titleId={titleId} details={details} onClose={onClose} />
    </Dialog>
  )
}

function ReportBugForm({ titleId, details, onClose }: { titleId: string; details: string | null; onClose: () => void }) {
  const fieldId = useId()
  const location = useLocation()
  const send = useSendBugReport()
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (send.isPending) return
    const report = cleanReport(
      { source: details ? 'error' : 'manual', message, details },
      { path: location.pathname, userAgent: navigator.userAgent },
    )
    if (!report) {
      setProblem('Say what went wrong.')
      document.getElementById(fieldId)?.focus()
      return
    }
    setProblem('')
    try {
      await send.mutateAsync(report)
      setSent(true)
    } catch {
      // Shown by ActionError; what was typed stays.
    }
  }

  if (sent) {
    return (
      <div data-testid="bug-sent">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          Thank you
        </h2>
        <p role="status" className="mt-2 text-sm text-slate-700">
          Your report was sent. A developer will see it.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonPrimary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Report a bug">
      <h2 id={titleId} className="text-base font-semibold text-slate-900">
        Report a bug
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        What did you do, and what happened instead? The page you are on and your browser are sent too.
      </p>
      <label htmlFor={fieldId} className="mt-3 block text-xs font-medium text-slate-700">
        What went wrong{details ? ' (optional, the error is attached)' : ''}
      </label>
      <textarea
        id={fieldId}
        rows={5}
        value={message}
        maxLength={MAX_MESSAGE}
        onChange={(e) => setMessage(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${fieldId}-problem` : undefined}
        className="mt-1 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      />
      {problem && (
        <p id={`${fieldId}-problem`} className="mt-1 text-xs text-red-700">
          {problem}
        </p>
      )}
      {details && (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer">Technical details that will be sent</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 whitespace-pre-wrap" data-testid="bug-details">
            {details}
          </pre>
        </details>
      )}
      <ActionError error={send.error} className="mt-3" />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonSecondary} disabled={send.isPending} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </form>
  )
}
