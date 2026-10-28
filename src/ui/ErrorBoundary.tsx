import { Component, type ErrorInfo, type ReactNode } from 'react'
import { cleanReport, errorDetails } from '../bugs/bugReport.ts'
import { sendBugReport } from '../data/useBugReports.ts'

// React unmounts the ENTIRE tree when a render throws. Without a boundary the
// club sees a blank white page and has no idea what happened — the worst
// possible failure for a tool people rely on in a workshop.
//
// This is still a class component: catching render errors has no hook API.
type Props = { children: ReactNode }
type State = { error: Error | null; report: 'idle' | 'sending' | 'sent' | 'failed' }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, report: 'idle' }

  static getDerivedStateFromError(error: Error): State {
    return { error, report: 'idle' }
  }

  // The crash screen sits above every provider, so it sends the report itself, with the error's text attached.
  sendReport = async () => {
    const { error } = this.state
    if (!error) return
    const report = cleanReport(
      { source: 'error', message: '', details: errorDetails(error) },
      { path: window.location.pathname, userAgent: navigator.userAgent },
    )
    if (!report) return
    this.setState({ report: 'sending' })
    try {
      await sendBugReport(report)
      this.setState({ report: 'sent' })
    } catch {
      this.setState({ report: 'failed' })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Left in on purpose: when a student reports "it went blank", the console
    // is the only evidence anyone will have.
    console.error('Reqon crashed while rendering:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-surface p-6">
          <h1 className="text-lg font-semibold text-slate-900">Something broke on this screen</h1>
          <p className="mt-2 text-sm text-slate-700">
            The rest of the app still works. Nothing you had saved is lost — Reqon
            writes straight to the database as you go.
          </p>
          <p role="alert" className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-700">
            {this.state.error.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null, report: 'idle' })}
              className="min-h-11 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:min-h-0"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void this.sendReport()}
              disabled={this.state.report === 'sending' || this.state.report === 'sent'}
              className="min-h-11 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60 sm:min-h-0"
              data-testid="crash-report"
            >
              {this.state.report === 'sent' ? 'Report sent' : this.state.report === 'sending' ? 'Sending…' : 'Report this bug'}
            </button>
            <a
              href="/"
              className="min-h-11 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:min-h-0"
            >
              Back to Now
            </a>
          </div>
          {this.state.report === 'failed' && (
            <p role="status" className="mt-3 text-sm text-red-800">
              The report could not be sent. Tell a developer what you were doing instead.
            </p>
          )}
        </div>
      </main>
    )
  }
}
