import { useState } from 'react'
import { buttonPrimary, buttonSecondary } from '../../ui/buttons.ts'

// The temporary password an Edge Function just generated (create-member or
// reset-member-password), shown to the admin this once so they can hand it
// over. Nothing keeps it: "Done", leaving the page or a reload drops it, and
// the person must replace it at their first sign-in.
export function IssuedPassword({
  name,
  email,
  password,
  onDone,
}: {
  name: string
  email?: string
  password: string
  onDone: () => void
}) {
  const [copied, setCopied] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied('Copied.')
    } catch {
      setCopied('Could not copy — select the password and copy it by hand.')
    }
  }

  return (
    <div role="group" aria-label={`Temporary password for ${name}`} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-slate-900">Temporary password for {name}</p>
      <p className="mt-1 text-xs text-pretty text-slate-700">
        {email ? <>They sign in with <strong className="font-medium">{email}</strong> and this password. </> : null}
        Give it to them privately. It is shown only now, and they choose their own the first time they
        sign in.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code data-testid="issued-password" className="rounded border border-slate-300 bg-surface px-2 py-1 font-mono text-sm text-slate-900 select-all">
          {password}
        </code>
        <button type="button" onClick={() => void copy()} className={`${buttonSecondary} text-xs`}>
          Copy
        </button>
        <button type="button" onClick={onDone} className={`${buttonPrimary} text-xs`}>
          Done
        </button>
      </div>
      <p role="status" className="mt-1 min-h-4 text-xs text-slate-700">
        {copied}
      </p>
    </div>
  )
}
