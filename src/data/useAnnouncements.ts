import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'
import type { Database } from '../lib/database.types.ts'
import { unwrap } from './errors.ts'

export type Announcement = Database['public']['Tables']['announcements']['Row']

export const ANNOUNCEMENT_TITLE_MAX = 100
// The description.
export const ANNOUNCEMENT_MAX = 1000
// How many past announcements the history shows. Older ones stay in the table.
export const HISTORY_SIZE = 100

const KEY = ['announcements'] as const

// Every past announcement, newest first (20260155000000). Read from its own table, not from the inbox: inbox rows are
// purged 90 days after they are read. Not season-scoped: an announcement is for the whole club.
export function useAnnouncements(enabled: boolean): UseQueryResult<Announcement[], Error> {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async () =>
      unwrap(
        'load the announcements',
        await supabase.from('announcements').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_SIZE),
      ),
  })
}

// Sends one to every active and trial member (send_announcement(): the database checks who may, the length and a
// per-hour limit). Resolves with how many people it reached. Not optimistic: the history is only refreshed from the
// server's answer.
export function useSendAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation<number, Error, { title: string; body: string }>({
    mutationFn: async ({ title, body }) => {
      const { data, error } = await supabase.rpc('send_announcement', { p_title: title, p_body: body })
      if (error) throw new DataError('send the announcement', error)
      return data ?? 0
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
