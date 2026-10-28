import { useId, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useAuth } from './context.ts'
import { setOwnPassword } from './setOwnPassword.ts'

// Supabase stores passwords with bcrypt, which only reads the first 72 bytes.
// Same limits as Settings -> Your account and the set-own-password function.
const MIN = 8
const MAX = 72

const input =
  'mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 focus-visible:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 aria-invalid:border-red-600 sm:text-sm'

type Field = 'next' | 'confirm'

function validate(next: string, confirm: string): Partial<Record<Field, string>> {
  if (next.length < MIN) return { next: `Use at least ${MIN} characters.` }
  if (new TextEncoder().encode(next).length > MAX) return { next: `Use at most ${MAX} characters.` }
  if (confirm !== next) return { confirm: 'The two passwords don’t match.' }
  return {}
}

// Shown INSTEAD of the app while members.must_change_password is set: the
// password they signed in with was issued by the app and seen by whoever added
// them (or reset it), so they choose their own before anything else. Like
// RequireAuth, this is a usability gate — the database still decides what
// they may read — but the flag itself can only be cleared by choosing.
export default function ChoosePassword() {
  const auth = useAuth()
  const email = auth.status === 'member' ? (auth.user.email ?? '') : ''
  const firstName = auth.status === 'member' ? auth.member.full_name.split(' ')[0] : ''
  const ids = useId()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  const idOf = (field: Field) => `${ids}-${field}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setFormError(null)
    const found = validate(next, confirm)
    // Commit the message before moving focus, so a screen reader announces
    // the field together with what is wrong with it.
    flushSync(() => setErrors(found))
    const first = (['next', 'confirm'] as const).find((field) => found[field])
    if (first) {
      document.getElementById(idOf(first))?.focus()
      return
    }
    setBusy(true)
    try {
      await setOwnPassword(email, next)
      // Re-read the roster row: the flag is now off, so the app renders.
      auth.retry()
    } catch (err) {
      // Re-enable the fields before pointing at the message.
      flushSync(() => {
        setBusy(false)
        setFormError(err instanceof Error ? err.message : 'Could not save your password.')
      })
      formErrorRef.current?.focus()
    }
  }

  const field = (name: Field, label: string) => (
    <div className="mb-4">
      <label htmlFor={idOf(name)} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={idOf(name)}
        name={name === 'next' ? 'new-password' : 'confirm-password'}
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        value={name === 'next' ? next : confirm}
        onChange={(e) => (name === 'next' ? setNext : setConfirm)(e.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${idOf(name)}-error` : name === 'next' ? `${ids}-rule` : undefined}
        className={input}
      />
      {errors[name] && (
        <p id={`${idOf(name)}-error`} className="mt-1 text-sm text-red-700">
          {errors[name]}
        </p>
      )}
    </div>
  )

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={submit}
        noValidate
        aria-labelledby={`${ids}-title`}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-surface p-6 shadow-sm"
      >
        <h1 id={`${ids}-title`} className="text-xl font-semibold text-slate-900">
          Choose your password
        </h1>
        <p className="mt-1 mb-6 text-sm text-pretty text-slate-600">
          {firstName ? `Welcome, ${firstName}. ` : ''}You signed in with a temporary password. Choose
          one only you know before you continue.
        </p>
        {/* Lets a password manager know which account the new password belongs to. */}
        <input hidden readOnly name="username" autoComplete="username" value={email} />

        <fieldset disabled={busy}>
          {field('next', 'New password')}
          <p id={`${ids}-rule`} className="-mt-3 mb-4 text-xs text-slate-600">
            At least {MIN} characters, and not your temporary password.
          </p>
          {field('confirm', 'Confirm new password')}
          <label className="mb-4 flex min-h-11 items-center gap-2 text-sm text-slate-800 sm:min-h-0">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              className="h-5 w-5 accent-slate-900"
            />
            Show passwords
          </label>
        </fieldset>

        {formError && (
          <p
            ref={formErrorRef}
            tabIndex={-1}
            role="alert"
            className="mb-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
          >
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button
          type="button"
          onClick={() => void auth.signOut()}
          className="mt-3 block w-full text-sm text-slate-500 underline"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}
