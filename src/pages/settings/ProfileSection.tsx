import { useRef, useState } from 'react'
import { useAuth } from '../../auth/context.ts'
import { usePermissions } from '../../auth/usePermissions.ts'
import { pictureToAvatar } from '../../account/avatarImage.ts'
import { AccountRow } from '../../account/AccountRow.tsx'
import { ChangeLoginForm } from '../../account/ChangeLoginForm.tsx'
import { ChangePasswordForm } from '../../account/ChangePasswordForm.tsx'
import { UsernameForm } from '../../account/UsernameForm.tsx'
import { useMyAvatar, useRemoveMyAvatar, useSetMyAvatar } from '../../data/useAvatars.ts'
import { RoleBadges } from '../../roles/RoleBadges.tsx'
import { Avatar } from '../../ui/Avatar.tsx'
import { buttonQuiet } from '../../ui/buttons.ts'
import { ActionError } from '../../ui/states.tsx'

type Row = 'username' | 'email' | 'password'

// "Your account", laid out the way account pages are: who you are at the top (your picture, with the camera on it),
// then one list called “Sign-in and security” where every line shows what it is now and opens its own form in place.
// Name and job title are read-only here: the President or Vice President sets them in the roster. A retired member has
// no picture to change.
export function ProfileSection() {
  const auth = useAuth()
  const { roles } = usePermissions()
  const avatar = useMyAvatar()
  const save = useSetMyAvatar()
  const remove = useRemoveMyAvatar()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Only one row is open at a time; a row that has just been saved says so until another is opened.
  const [openRow, setOpenRow] = useState<Row | null>(null)
  const [note, setNote] = useState<{ row: Row; text: string } | null>(null)

  if (auth.status !== 'member') return <ChangePasswordForm />
  const { member } = auth
  const email = auth.user.email ?? ''
  const canChangePhoto = member.status !== 'alumni'
  const image = avatar.data ?? null

  const toggle = (row: Row) => {
    setNote(null)
    setOpenRow((current) => (current === row ? null : row))
  }
  const finished = (row: Row) => (text: string) => {
    setOpenRow(null)
    setNote({ row, text })
  }
  const close = () => setOpenRow(null)

  async function pick(file: File | undefined) {
    if (input.current) input.current.value = ''
    if (!file) return
    setProblem(null)
    setDone(null)
    setBusy(true)
    try {
      await save.mutateAsync(await pictureToAvatar(file))
      setDone('Photo saved.')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The photo could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const photoLabel = busy ? 'Saving…' : image ? 'Change photo' : 'Add a photo'

  return (
    <div className="space-y-6" data-testid="profile-section">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative shrink-0">
          <Avatar name={member.full_name} image={image} size="lg" />
          {canChangePhoto && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose a photo"
                data-testid="profile-photo-input"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
              {/* The camera sits on the picture, as on every account page; its hit area is larger than the 32px dot. */}
              <button
                type="button"
                aria-label={photoLabel}
                title={photoLabel}
                disabled={busy || remove.isPending}
                onClick={() => input.current?.click()}
                className="absolute -right-1 -bottom-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-700 shadow-sm transition-colors duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H7l1.2-1.8a1 1 0 0 1 .8-.4h6a1 1 0 0 1 .8.4L17 7h1.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
                  <circle cx="12" cy="13" r="3.25" />
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-balance break-words text-slate-900" data-testid="profile-name">
            {member.full_name}
          </p>
          <p className="text-sm text-slate-600" data-testid="profile-title">
            <span className="sr-only">Job title: </span>
            {member.role}
            {member.status === 'trial' && ' · on trial'}
            {member.status === 'alumni' && ' · retired'}
          </p>
          {roles.length > 0 && (
            <div className="mt-1">
              <RoleBadges roles={roles} />
            </div>
          )}
          {canChangePhoto && image && (
            <button
              type="button"
              className={`${buttonQuiet} mt-1 !min-h-0 !px-0 !py-0 text-xs`}
              disabled={busy || remove.isPending}
              onClick={() => {
                setProblem(null)
                setDone(null)
                remove.mutate(undefined, { onSuccess: () => setDone('Photo removed.') })
              }}
            >
              Remove photo
            </button>
          )}
          {problem && (
            <p role="alert" className="mt-2 text-sm text-red-700" data-testid="profile-photo-problem">
              {problem}
            </p>
          )}
          {done && (
            <p role="status" className="mt-2 text-sm text-emerald-800" data-testid="profile-photo-done">
              {done}
            </p>
          )}
          <ActionError error={save.error && !problem ? save.error : remove.error} className="mt-2" />
        </div>
      </div>
      <p className="-mt-3 text-xs text-slate-600">Your name and job title are kept in the roster by the President or Vice President.</p>

      <section aria-labelledby="account-signin-title">
        <h3 id="account-signin-title" className="text-sm font-semibold text-slate-900">
          Sign-in and security
        </h3>
        <p className="mt-0.5 mb-2 text-xs text-slate-600">You can sign in with your email or your username.</p>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-surface">
          <AccountRow
            label="Username"
            action={member.username ? 'Change' : 'Add'}
            value={member.username ? <span className="font-medium">{member.username}</span> : <span className="text-slate-600">Not set</span>}
            open={openRow === 'username'}
            onToggle={() => toggle('username')}
            note={note?.row === 'username' ? note.text : undefined}
          >
            <UsernameForm current={member.username} onDone={finished('username')} onCancel={close} />
          </AccountRow>
          <AccountRow
            label="Email"
            value={<span className="font-medium">{email}</span>}
            open={openRow === 'email'}
            onToggle={() => toggle('email')}
            note={note?.row === 'email' ? note.text : undefined}
          >
            <ChangeLoginForm currentEmail={email} onDone={finished('email')} onCancel={close} />
          </AccountRow>
          <AccountRow
            label="Password"
            value={
              <>
                <span aria-hidden="true" className="tracking-widest text-slate-700">
                  ••••••••
                </span>
                <span className="sr-only">Hidden</span>
              </>
            }
            open={openRow === 'password'}
            onToggle={() => toggle('password')}
            note={note?.row === 'password' ? note.text : undefined}
          >
            <ChangePasswordForm embedded onChanged={finished('password')} onCancel={close} />
          </AccountRow>
        </ul>
      </section>
    </div>
  )
}
