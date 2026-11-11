import { createContext, useContext } from 'react'

// The ids of the members who are online right now. Empty outside the provider (a test, the login screen), where
// nobody is shown as online.
export const OnlineContext = createContext<ReadonlySet<string>>(new Set())

export function useIsOnline(memberId: string | null | undefined): boolean {
  const online = useContext(OnlineContext)
  return memberId ? online.has(memberId) : false
}
