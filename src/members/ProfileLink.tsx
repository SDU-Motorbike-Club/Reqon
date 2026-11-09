import type { ReactNode } from 'react'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'

// A member's name that opens their profile (ProfileDialog, mounted once in the app shell and driven by ?profile=).
// Only the address changes, so it works from any screen, keeps the screen's own filters, and Back closes it.
export function ProfileLink({ memberId, children, className = '' }: { memberId: string; children: ReactNode; className?: string }) {
  const [, setParams] = useUrlParams()
  return (
    <button
      type="button"
      onClick={() => setParams((current) => mergeSearchParams(current, { profile: memberId }))}
      className={`rounded text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${className}`}
    >
      {children}
    </button>
  )
}
