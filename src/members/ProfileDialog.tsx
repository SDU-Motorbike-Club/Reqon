import { useId, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { useAvatars } from '../data/useAvatars.ts'
import { useMembers, type Member } from '../data/useMembers.ts'
import { MESSAGE_MAX, useMemberEmail, useSendMessage } from '../data/useProfile.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError } from '../ui/states.tsx'

// Who someone is and how to reach them: name, job title, login email, and a box to send them a message that lands
// in their inbox. Opened by ?profile=<member id> (see ProfileLink), so it can open from any screen. Every active or
// trial member may open any profile; the database decides who may read an email and send a message.
export function ProfileDialog() {
  const [params, setParams] = useUrlParams()
  const id = params.get('profile')
  const close = () => setParams((current) => mergeSearchParams(current, { profile: null }), { replace: true })
  return (
    <Dialog open={id !== null} onClose={close} labelledBy="profile-dialog-title">
      {id !== null && <Profile memberId={id} onClose={close} />}
    </Dialog>
  )
}

const link = 'rounded text-accent underline underline-offset-2 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'

function Profile({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const auth = useAuth()
  const members = useMembers()
  const avatars = useAvatars()
  const email = useMemberEmail(memberId)
  const member = members.data?.find((m) => m.id === memberId)

  if (!member) {
    return (
      <div data-testid="profile-dialog">
        <h2 id="profile-dialog-title" className="text-base font-semibold text-slate-900">
          Profile
        </h2>
        <p className="mt-2 text-sm text-slate-700">{members.isPending ? 'Loading…' : 'This person is not on the roster.'}</p>
        <CloseRow onClose={onClose} />
      </div>
    )
  }

  const me = auth.status === 'member' ? auth.member : null
  const canMessage = me !== null && me.status !== 'alumni' && me.id !== member.id && member.status !== 'alumni'

  return (
    <div data-testid="profile-dialog">
      <div className="flex flex-col items-center text-center">
        <Avatar name={member.full_name} image={avatars.data?.get(member.id)} size="lg" />
        <h2 id="profile-dialog-title" className="mt-3 max-w-full text-lg font-semibold break-words text-slate-900">
          {member.full_name}
        </h2>
        <p className="text-sm text-slate-600">
          {member.role}
          {member.status === 'trial' && ' · on trial'}
          {member.status === 'alumni' && ' · retired'}
        </p>
        {/* The address they sign in with. */}
        <p className="mt-1 max-w-full text-sm break-all text-slate-900" data-testid="profile-email">
          {email.isPending ? (
            'Loading…'
          ) : email.error ? (
            <span className="text-red-800">Could not load the email.</span>
          ) : email.data ? (
            <a href={`mailto:${email.data}`} className={link}>
              {email.data}
            </a>
          ) : (
            <span className="text-slate-500">No email on file</span>
          )}
        </p>
      </div>

      {canMessage ? (
        <MessageForm member={member} />
      ) : (
        <p className="mt-4 text-sm text-slate-600" data-testid="profile-no-message">
          {me?.id === member.id
            ? 'This is you.'
            : member.status === 'alumni'
              ? 'Retired members cannot receive messages.'
              : 'Retired members cannot send messages.'}
        </p>
      )}
      <CloseRow onClose={onClose} />
    </div>
  )
}

function MessageForm({ member }: { member: Member }) {
  const id = useId()
  const send = useSendMessage()
  const [body, setBody] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const first = member.full_name.split(' ')[0]

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return
    setSentTo(null)
    send.mutate({ to: member.id, body: text }, { onSuccess: () => { setBody(''); setSentTo(first) } })
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-slate-200 pt-4">
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        Message to {first}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={MESSAGE_MAX}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setSentTo(null)
        }}
        placeholder="It lands in their inbox."
        disabled={send.isPending}
        // 16px on a phone, so iOS does not zoom the page when the box is tapped.
        className="mt-1 block w-full rounded border border-slate-300 bg-surface px-2.5 py-1.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {body.length}/{MESSAGE_MAX}
        </span>
        <button type="submit" className={buttonPrimary} disabled={send.isPending || !body.trim()}>
          {send.isPending ? 'Sending…' : 'Send message'}
        </button>
      </div>
      {sentTo && (
        <p role="status" className="mt-2 text-sm text-green-800">
          Message sent. {sentTo} will see it in their inbox.
        </p>
      )}
      <ActionError error={send.error} className="mt-2" />
    </form>
  )
}

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-4 flex justify-end">
      <button type="button" className={buttonSecondary} onClick={onClose}>
        Close
      </button>
    </div>
  )
}
