import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import { unwrap } from './errors.ts'

// Who is online (20260161000000_presence.sql). The database keeps the time of each member's last activity and decides
// who counts as online: seen in the last 30 minutes, and not signed out since. Nobody is signed out by it.
export const ONLINE_KEY = ['online_members'] as const
// How often the list is re-read. A colleague who has just arrived shows within this time.
const REFRESH_MS = 60_000

export function useOnlineIds(enabled: boolean): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: ONLINE_KEY,
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => unwrap('load who is online', await supabase.rpc('online_member_ids')),
  })
}

// Telling the database "I am here". Best effort and silent: presence is a nicety, so a failed ping is never shown.
// The last ping is remembered so that signing out can wait for it: otherwise a ping that is still on its way could
// land after the sign-out and leave a person looking online for half an hour.
let inflight: Promise<unknown> = Promise.resolve()
let ended = false

export function touchPresence(): Promise<unknown> {
  if (ended) return Promise.resolve()
  // Started inside a promise so that even a call that throws at once (no client, no network) is swallowed here.
  inflight = Promise.resolve()
    .then(() => supabase.rpc('touch_presence'))
    .then(
      () => undefined,
      () => undefined,
    )
  return inflight
}

// Called at sign-out, before the session ends (the database needs it to know who is leaving). From here no more
// pings are sent until resumePresence().
export async function endPresence(): Promise<void> {
  ended = true
  await inflight
  await supabase.rpc('end_presence')
}

export function resumePresence(): void {
  ended = false
}
