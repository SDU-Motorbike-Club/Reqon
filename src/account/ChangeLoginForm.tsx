import { useId, useState, type FormEvent } from 'react'
import { changeLogin } from '../auth/changeLogin.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'

// 16px on a phone, so iOS does not zoom the page when a field is tapped.
const input =
  'mt-1 block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-invalid:border-red-600 sm:min-h-9 sm:text-sm'

// The body of the Email row in Your account: two fields (the new e-mail, and your password to confirm it is you) and
// Save / Cancel. The row shows the current address and the confirmation, so none of that is repeated here. The change is
// immediate: no mail to wait for (see auth/changeLogin.ts).
export function ChangeLoginForm({
  currentEmail,
  onDone,
  onCancel,
}: {
  currentEmail: string
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const id = useId()
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ field: 'email' | 'password' | null; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setProblem(null)
    const next = newEmail.trim()
    if (next.toLowerCase() === currentEmail.toLowerCase()) return setProblem({ field: 'email', text: 'That is already your email.' })
    setBusy(true)
    try {
      await changeLogin({ currentPassword: password, newEmail: next })
      onDone(`Email changed. Sign in with ${next} from now on; your password is the same.`)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not change your email.'
      setProblem({ field: /password/i.test(text) ? 'password' : /e-?mail/i.test(text) ? 'email' : null, text })
      setBusy(false)
    }
  }

  const fieldError = (field: 'email' | 'password') => (problem?.field === field ? problem.text : null)

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 sm:max-w-sm" data-testid="change-login">
      <fieldset className="grid gap-3" disabled={busy}>
        <div>
          <label htmlFor={`${id}-email`} className="block text-sm font-medium text-slate-900">
            New email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            autoFocus
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-invalid={fieldError('email') ? true : undefined}
            aria-describedby={`${id}-email-hint`}
            className={input}
          />
          <p id={`${id}-email-hint`} className={`mt-1 text-xs ${fieldError('email') ? 'text-red-700' : 'text-slate-600'}`}>
            {fieldError('email') ?? 'You will sign in with this from now on. It takes effect straight away.'}
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-password`} className="block text-sm font-medium text-slate-900">
            Your password
          </label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldError('password') ? true : undefined}
            aria-describedby={`${id}-password-hint`}
            className={input}
          />
          <p id={`${id}-password-hint`} className={`mt-1 text-xs ${fieldError('password') ? 'text-red-700' : 'text-slate-600'}`}>
            {fieldError('password') ?? 'To confirm it is you. The password itself does not change.'}
          </p>
        </div>
      </fieldset>
      {problem && !problem.field && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {problem.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !newEmail.trim() || !password} className={buttonPrimary}>
          {busy ? 'Saving…' : 'Save new email'}
        </button>
        <button type="button" disabled={busy} className={buttonSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
