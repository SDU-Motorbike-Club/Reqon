import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/context.ts'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'
import type { Notification } from '../notifications/presentation.ts'
import { queryKeys } from './queryKeys.ts'
import type { RealtimeState } from './realtime.ts'

// How many of the most recent notifications the inbox shows. Read ones older
// than 90 days are purged by the database (purge_read_notifications()).
export const INBOX_SIZE = 50

function useMemberId(): string | null {
  const auth = useAuth()
  return auth.status === 'member' ? auth.member.id : null
}

// The signed-in person's latest notifications, newest first. RLS returns only
// their own, so no member filter is needed for safety; it is added anyway so
// the query plan uses the (member_id, created_at) index.
export function useNotifications(): UseQueryResult<Notification[], Error> {
  const memberId = useMemberId()
  return useQuery({
    queryKey: [...queryKeys.notifications(memberId), 'list'],
    enabled: memberId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('member_id', memberId as string)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(INBOX_SIZE)
      if (error) throw new DataError('load your notifications', error)
      return data ?? []
    },
  })
}

// Counted on the server, so the bell is right even with more unread than the
// inbox shows.
export function useUnreadCount(): UseQueryResult<number, Error> {
  const memberId = useMemberId()
  return useQuery({
    queryKey: [...queryKeys.notifications(memberId), 'unread'],
    enabled: memberId !== null,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId as string)
        .is('read_at', null)
      if (error) throw new DataError('count your notifications', error)
      return count ?? 0
    },
  })
}

// Marks one notification, or all of them, read. Only read_at is writable, and
// the database stamps its own time (stamp_notification_read()), so any value
// will do here.
export function useMarkNotificationsRead() {
  const memberId = useMemberId()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { id: number } | 'all'>({
    mutationFn: async (which) => {
      let query = supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('member_id', memberId as string)
        .is('read_at', null)
      if (which !== 'all') query = query.eq('id', which.id)
      const { error } = await query
      if (error) throw new DataError('mark your notifications read', error)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(memberId) })
    },
  })
}

// Keeps the bell and the inbox current while the app is open. One channel per
// signed-in person, filtered server-side to their own rows (RLS would refuse
// anyone else's anyway). Same lifecycle as useRealtimeSubteams.
export function useRealtimeNotifications(): RealtimeState {
  const queryClient = useQueryClient()
  const memberId = useMemberId()
  const [channel, setChannel] = useState<{ memberId: string; status: RealtimeState } | null>(null)

  useEffect(() => {
    if (!memberId) return
    let active = true
    const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(memberId) })
    const realtimeChannel = supabase
      .channel(`notifications-${memberId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `member_id=eq.${memberId}` }, () => {
        if (active) refresh()
      })
      .subscribe((status: string) => {
        if (!active) return
        setChannel({ memberId, status: status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'off' : 'connecting' })
        // SUBSCRIBED also follows a reconnect: catch up on anything missed.
        if (status === 'SUBSCRIBED') refresh()
      })
    return () => {
      active = false
      void supabase.removeChannel(realtimeChannel)
    }
  }, [memberId, queryClient])

  if (!memberId) return 'off'
  return channel?.memberId === memberId ? channel.status : 'connecting'
}
