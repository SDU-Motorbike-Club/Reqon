import type { ReactNode } from 'react'

// The clickable line of a <details>: a chevron that turns when it opens, and a 44px tap target on a phone.
// The parent <details> needs the `group` class for the chevron to turn.
export function DisclosureSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-slate-700 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-8 [&::-webkit-details-marker]:hidden">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none">
        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </summary>
  )
}
