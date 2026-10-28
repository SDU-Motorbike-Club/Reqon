import { useEffect, useRef, type ReactNode } from 'react'

const NORMAL = 'sm:w-[min(40rem,calc(100%-2rem))] lg:w-[min(54rem,calc(100%-3rem))]'
const WIDE = 'sm:w-[min(48rem,calc(100%-2rem))] lg:w-[min(76rem,calc(100%-3rem))]'
const SIDE = 'sm:my-0 sm:ml-auto sm:mr-0 sm:h-dvh sm:max-h-dvh sm:w-[min(30rem,100%)] sm:rounded-none sm:rounded-l-xl'

// A modal on the native <dialog>. The browser does the hard parts: the rest of
// the page becomes inert, Tab stays inside, Escape closes it, and focus goes
// back to whatever opened it (see below). Centred on wider screens; a bottom sheet on a
// phone, where it is easy to reach with a thumb.
//
// Content is only mounted while open, so every opening starts fresh.
export function Dialog({
  open,
  onClose,
  labelledBy,
  dismissible = true,
  size = 'default',
  children,
}: {
  open: boolean
  onClose: () => void
  labelledBy: string
  // False while a save is in flight: closing then would hide its outcome.
  dismissible?: boolean
  // 'wide' for a dialog people WRITE in (an agenda, minutes): more room per line and per screen.
  // 'side' for details beside a page you are still reading: a sheet on the right edge (a bottom sheet on a phone).
  size?: 'default' | 'wide' | 'side'
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Whatever had focus when the dialog opened — usually the button that opened it.
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
      // The browser only restores focus if it is still inside the dialog, and
      // by now React has removed the control that had it. Hand it back to the
      // opener ourselves, so a keyboard user lands where they started.
      const opener = returnTo.current
      returnTo.current = null
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        // Escape. A dialog inside this one (the review dialog in the proposals overlay) has its own cancel, and
        // React would otherwise hand it to us too and close both — even while the inner one is saving.
        if (event.target !== event.currentTarget) return
        // Keep React in charge of whether the dialog is open.
        event.preventDefault()
        if (dismissible) onClose()
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
      className={`pc-slide-up mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-xl border border-slate-200 bg-surface p-0 text-slate-900 shadow-xl backdrop:bg-black/60 sm:m-auto sm:max-h-[85dvh] sm:rounded-xl ${size === 'wide' ? WIDE : size === 'side' ? SIDE : NORMAL}`}
    >
      {open && (
        <div className="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
      )}
    </dialog>
  )
}
