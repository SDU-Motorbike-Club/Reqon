import { useRef, useState } from 'react'
import { useAuth } from '../../auth/context.ts'
import { usePermissions } from '../../auth/usePermissions.ts'
import { pictureToAvatar } from '../../account/avatarImage.ts'
import { ChangePasswordForm } from '../../account/ChangePasswordForm.tsx'
import { useMyAvatar, useRemoveMyAvatar, useSetMyAvatar } from '../../data/useAvatars.ts'
import { RoleBadges } from '../../roles/RoleBadges.tsx'
import { Avatar } from '../../ui/Avatar.tsx'
import { buttonSecondary } from '../../ui/buttons.ts'
import { ActionError } from '../../ui/states.tsx'

// "Your account": who you are on one card (picture, name, job title, roles) and, under it, your password.
// The job title is read-only here: the President or Vice President sets it in the roster. A retired member has
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

  if (auth.status !== 'member') return <ChangePasswordForm />
  const { member } = auth
  const canChangePhoto = member.status !== 'alumni'
  const image = avatar.data ?? null

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

  return (
    <div className="space-y-4" data-testid="profile-section">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-surface p-4">
        <Avatar name={member.full_name} image={image} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold break-words text-slate-900" data-testid="profile-name">
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
          {canChangePhoto && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <button type="button" className={buttonSecondary} disabled={busy || remove.isPending} onClick={() => input.current?.click()}>
                {busy ? 'Saving…' : image ? 'Change photo' : 'Add a photo'}
              </button>
              {image && (
                <button
                  type="button"
                  className={buttonSecondary}
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
            </div>
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

      <ChangePasswordForm />
    </div>
  )
}
