import { useId, useRef, useState } from 'react'
import { buttonSecondary } from '../ui/buttons.ts'
import { emailText, whatsappText, type ShareableMeeting } from './meetingText.ts'

// Announcement texts for one meeting, ready to paste into WhatsApp or an email.
// Read-only text boxes: the wording comes from the meeting, so a correction
// belongs in the meeting (Edit), not in a copy that goes stale.
type Which = 'whatsapp' | 'email'

async function copyText(text: string, box: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard permission (an older browser, an insecure page): select the
    // text so Ctrl+C works, and say so.
    box?.focus()
    box?.select()
    return false
  }
}

export function MeetingShare({ meeting, department }: { meeting: ShareableMeeting; department: string | null }) {
  const id = useId()
  const whatsapp = whatsappText(meeting, department)
  const email = emailText(meeting, department)
  const emailAll = `Subject: ${email.subject}\n\n${email.body}`
  const boxes = useRef<Record<Which, HTMLTextAreaElement | null>>({ whatsapp: null, email: null })
  const [status, setStatus] = useState('')

  async function copy(which: Which) {
    const ok = await copyText(which === 'whatsapp' ? whatsapp : emailAll, boxes.current[which])
    const name = which === 'whatsapp' ? 'WhatsApp' : 'email'
    setStatus(ok ? `${name} text copied.` : `Could not copy on its own. The ${name} text is selected: press Ctrl+C.`)
  }

  const box =
    'mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500'
  return (
    <details className="mt-3 border-t border-slate-100 pt-2">
      <summary className="cursor-pointer py-3 text-xs font-medium text-slate-700 underline-offset-2 hover:underline sm:py-0">
        Share this meeting
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {(['whatsapp', 'email'] as const).map((which) => (
          <div key={which}>
            <label className="block text-xs font-medium text-slate-600" htmlFor={`${id}-${which}`}>
              {which === 'whatsapp' ? 'WhatsApp message' : 'Email (subject, then message)'}
            </label>
            <textarea
              id={`${id}-${which}`}
              ref={(el) => {
                boxes.current[which] = el
              }}
              readOnly
              rows={9}
              value={which === 'whatsapp' ? whatsapp : emailAll}
              className={box}
            />
            <button type="button" className={`${buttonSecondary} mt-1`} onClick={() => void copy(which)}>
              {which === 'whatsapp' ? 'Copy WhatsApp text' : 'Copy email text'}
            </button>
          </div>
        ))}
      </div>
      <p role="status" className="mt-1 min-h-5 text-xs text-emerald-800">
        {status}
      </p>
    </details>
  )
}
