import { useId, useMemo, useState } from 'react'
import { useBugReports, useDeleteBugReport, useSetBugStatus, type BugReport } from '../data/useBugReports.ts'
import { useMembers } from '../data/useMembers.ts'
import { formatInstant } from '../lib/dates.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

// For Developers, in Settings: one button, "Bug reports", with how many are open. It opens an overlay listing what
// members reported, open ones first. A Developer marks one done (and can reopen it) or deletes it. The database
// only returns reports to a Developer, so this panel is shown only to them and would be empty for anyone else.
export function BugReportsPanel() {
  const titleId = useId()
  const reports = useBugReports(true)
  const [open, setOpen] = useState(false)
  const openCount = (reports.data ?? []).filter((r) => r.status === 'open').length

  return (
    <div data-testid="bug-reports-panel">
      <p className="text-sm text-slate-600">Problems members reported with the “Report a bug” button, or from an error message.</p>
      <button type="button" className={`${buttonSecondary} mt-2`} onClick={() => setOpen(true)} data-testid="bug-reports-open">
        Bug reports{reports.data ? ` (${openCount} open)` : ''}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy={titleId} size="wide">
        <div data-testid="bug-reports-overlay">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Bug reports
            </h2>
            <button type="button" className={buttonPrimary} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="mt-3">
            {reports.error ? (
              <ErrorState title="Could not load the bug reports" error={reports.error} onRetry={() => void reports.refetch()} />
            ) : reports.isPending ? (
              <LoadingState label="Loading the bug reports…" />
            ) : (
              <BugList reports={reports.data ?? []} />
            )}
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function BugList({ reports }: { reports: BugReport[] }) {
  const members = useMembers()
  const setStatus = useSetBugStatus()
  const remove = useDeleteBugReport()
  const [deleting, setDeleting] = useState<string | null>(null)
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  // Open first, then done; newest first inside each (the query is already newest first).
  const ordered = [...reports.filter((r) => r.status === 'open'), ...reports.filter((r) => r.status === 'done')]

  if (ordered.length === 0) return <EmptyState title="No bug reports">When a member reports a problem it appears here.</EmptyState>

  return (
    <>
      <ActionError error={setStatus.error ?? remove.error} className="mb-3" />
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-surface" data-testid="bug-list">
        {ordered.map((r) => (
          <li key={r.id} className={`px-4 py-3 ${r.status === 'done' ? 'opacity-70' : ''}`} data-testid={`bug-${r.id}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${r.source === 'error' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-800'}`}
              >
                {r.source === 'error' ? 'Error' : 'Manual'}
              </span>
              <span>{names.get(r.reported_by) ?? 'Someone no longer on the roster'}</span>
              <time dateTime={r.created_at}>{formatInstant(r.created_at)}</time>
              {r.page && <span className="font-mono">{r.page}</span>}
              {r.status === 'done' && <span className="font-medium text-ok">Done</span>}
            </div>
            {r.message && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-900">{r.message}</p>}
            {r.details && (
              <details className="mt-1 text-xs text-slate-600">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 whitespace-pre-wrap">{r.details}</pre>
                {r.user_agent && <p className="mt-1 break-words">{r.user_agent}</p>}
              </details>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonSecondary}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: r.id, status: r.status === 'open' ? 'done' : 'open' })}
              >
                {r.status === 'open' ? 'Mark done' : 'Reopen'}
              </button>
              {deleting === r.id ? (
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id, { onSettled: () => setDeleting(null) })}
                >
                  Delete for good?
                </button>
              ) : (
                <button type="button" className={buttonSecondary} onClick={() => setDeleting(r.id)}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
