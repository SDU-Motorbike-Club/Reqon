import type { ReactNode } from 'react'

// Every screen opens the same way: its name, one line telling a new team member what the screen is for, and, at
// the right on a wide screen, the one thing you most likely came to do (`actions`). A hairline closes the block,
// so the title area reads as a heading and not as another card. The main navigation lives in AppHeader.
export function PageHeader({
  title,
  description,
  tutorialId,
  actions,
  children,
}: {
  title: string
  description: string
  tutorialId?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-200 pb-4" data-tutorial={tutorialId}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        {/* About 65 characters a line: a sentence this long is read, not scanned. */}
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-slate-600">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children && <div className="basis-full">{children}</div>}
    </header>
  )
}
