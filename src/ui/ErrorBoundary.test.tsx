import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.tsx'

function Boom({ fail }: { fail: boolean }): React.ReactElement {
  if (fail) throw new Error('subteam list is not iterable')
  return <p>screen content</p>
}

// React re-throws a render error through a window "error" event in development;
// jsdom prints every uncancelled one as an uncaught stack trace. These throws are
// the point of the test, so the event is cancelled here (and only here).
const swallowRenderError = (event: ErrorEvent) => event.preventDefault()

beforeEach(() => {
  // React logs the caught error itself; silence it so the run stays readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.addEventListener('error', swallowRenderError)
})
afterEach(() => {
  window.removeEventListener('error', swallowRenderError)
  vi.restoreAllMocks()
})

describe('a render crash', () => {
  it('shows a real message instead of a blank page', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>)
    expect(screen.getByText('Something broke on this screen')).toBeInTheDocument()
    // The specific failure is visible — "it went blank" is unreportable.
    expect(screen.getByRole('alert')).toHaveTextContent('subteam list is not iterable')
    // And the page is not empty.
    expect(document.body.textContent?.trim().length).toBeGreaterThan(20)
  })

  it('offers a way out: retry and a link home', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Now' })).toHaveAttribute('href', '/')
  })

  it('reassures the reader that saved work is safe', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>)
    expect(screen.getByText(/Nothing you had saved is lost/)).toBeInTheDocument()
  })

  it('recovers when the underlying problem is gone', async () => {
    const user = userEvent.setup()
    function App({ fail }: { fail: boolean }) {
      return <ErrorBoundary><Boom fail={fail} /></ErrorBoundary>
    }
    const { rerender } = render(<App fail />)
    expect(screen.getByText('Something broke on this screen')).toBeInTheDocument()
    rerender(<App fail={false} />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('screen content')).toBeInTheDocument()
  })

  it('stays out of the way when nothing throws', () => {
    render(<ErrorBoundary><Boom fail={false} /></ErrorBoundary>)
    expect(screen.getByText('screen content')).toBeInTheDocument()
    expect(screen.queryByText('Something broke on this screen')).not.toBeInTheDocument()
  })

  it('logs the crash so a bug report has something to go on', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>)
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(logged.some((c) => String(c[0]).includes('crashed while rendering'))).toBe(true)
  })
})

describe('a screen file that a newer deploy replaced', () => {
  function Stale(): React.ReactElement {
    throw new Error('error loading dynamically imported module: https://x.app/assets/AttachmentsPanel-abc.js')
  }
  const reload = vi.fn()
  beforeEach(() => {
    reload.mockClear()
    sessionStorage.clear()
    vi.stubGlobal('location', { ...window.location, reload })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reloads once on its own, and not again right after (no reload loop)', () => {
    render(<ErrorBoundary><Stale /></ErrorBoundary>)
    expect(reload).toHaveBeenCalledTimes(1)
    render(<ErrorBoundary><Stale /></ErrorBoundary>)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers a reload, since trying the same import again cannot work', async () => {
    sessionStorage.setItem('reqon:chunk-reload', String(Date.now())) // the automatic reload already happened
    render(<ErrorBoundary><Stale /></ErrorBoundary>)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload the app' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload for an ordinary crash', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>)
    expect(reload).not.toHaveBeenCalled()
  })
})
