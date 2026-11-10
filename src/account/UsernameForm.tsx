import { useId, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { useSetMyUsername } from '../data/useUsername.ts'
import { buttonPrimary, buttonQuiet, buttonSecondary } from '../ui/buttons.ts'
import { USERNAME_MAX, usernameProblem } from './username.ts'

// 16px on a phone, so iOS does not zoom the page when a field is tapped.
const input =
  'mt-1 block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-invalid:border-red-600 sm:min-h-9 sm:text-sm'

// The body of the Username row in Your account. A username is a shorter way to sign in; the e-mail keeps working.
// Saving refreshes the signed-in member so the row shows the new name.
export function UsernameForm({
  current,
  onDone,
  onCancel,
}: {
  current: string | null
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const id = useId()
  const auth = useAuth()
  const save = useSetMyUsername()
  const [value, setValue] = useState(current ?? '')
  const problem = usernameProblem(value)
  const unchanged = value.trim().toLowerCase() === (current ?? '')
  const shownProblem = problem ?? (save.error ? save.error.message : null)

  function run(name: string, message: string) {
    save.mutate(name, {
      onSuccess: () => {
        if (auth.status === 'member') auth.retry()
        onDone(message)
      },
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (problem || unchanged || save.isPending) return
    const name = value.trim().toLowerCase()
    run(name, name ? 'Username saved. You can sign in with it now.' : 'Username removed.')
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 sm:max-w-sm" data-testid="username-form">
      <div>
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-slate-900">
          Username
        </label>
        <input
          id={`${id}-name`}
          type="text"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          maxLength={USERNAME_MAX + 5}
          value={value}
          disabled={save.isPending}
          onChange={(e) => {
            save.reset()
            setValue(e.target.value)
          }}
          aria-invalid={shownProblem ? true : undefined}
          aria-describedby={`${id}-hint`}
          className={input}
        />
        <p id={`${id}-hint`} className={`mt-1 text-xs ${shownProblem ? 'text-red-700' : 'text-slate-600'}`}>
          {shownProblem ?? 'Use it instead of your email to sign in. Letters, digits, dot, dash and underscore; 3 to 30 characters.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={save.isPending || Boolean(problem) || unchanged || !value.trim()} className={buttonPrimary}>
          {save.isPending ? 'Saving…' : 'Save username'}
        </button>
        <button type="button" disabled={save.isPending} className={buttonSecondary} onClick={onCancel}>
          Cancel
        </button>
        {current && (
          <button type="button" disabled={save.isPending} className={buttonQuiet} onClick={() => run('', 'Username removed.')}>
            Remove username
          </button>
        )}
      </div>
    </form>
  )
}
