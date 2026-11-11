import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '../auth/context.ts'
import { ONLINE_KEY, resumePresence, touchPresence, useOnlineIds } from '../data/usePresence.ts'
import { OnlineContext } from './context.ts'

// A ping at most this often while the person is using the app. The database counts 30 minutes from the last one, so
// two minutes is far inside it and still only a handful of tiny requests an hour.
const PING_EVERY_MS = 2 * 60 * 1000
const ACTIVITY = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

// Two jobs, for the signed-in app only. It tells the database the person is here whenever they do something (a click,
// a key, a scroll, coming back to the tab), and it shares who is online so any avatar can show the green dot. When
// someone stops doing things the pings stop and the dot goes out on its own after 30 minutes; no one is signed out.
export function PresenceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const memberId = auth.status === 'member' ? auth.member.id : null
  const online = useOnlineIds(memberId !== null)

  useEffect(() => {
    if (!memberId) return
    resumePresence()
    let last = 0
    let first = true
    const ping = () => {
      const now = Date.now()
      if (document.visibilityState !== 'visible' || now - last < PING_EVERY_MS) return
      last = now
      // The first ping also refreshes the list, so your own dot lights up without waiting for the next refresh.
      void touchPresence().then(() => {
        if (!first) return
        first = false
        void queryClient.invalidateQueries({ queryKey: ONLINE_KEY })
      })
    }
    ping()
    for (const name of ACTIVITY) window.addEventListener(name, ping, { passive: true })
    document.addEventListener('visibilitychange', ping)
    return () => {
      for (const name of ACTIVITY) window.removeEventListener(name, ping)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [memberId, queryClient])

  const ids = useMemo(() => new Set(online.data ?? []), [online.data])
  return <OnlineContext.Provider value={ids}>{children}</OnlineContext.Provider>
}
