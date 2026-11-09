import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../auth/context.ts'
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

// ---------------------------------------------------------------- comments (20260158000000)
export type AnnouncementComment = Database['public']['Tables']['announcement_comments']['Row']

export const COMMENT_MAX = 500
const THREAD_LIMIT = 200
// An open thread re-reads itself, so it behaves like a chat without a realtime channel.
const THREAD_REFRESH_MS = 10_000
const THREAD_KEY = (announcementId: number) => ['announcement_comments', announcementId] as const
const COUNTS_KEY = ['announcement_comment_counts'] as const

// One announcement's thread, oldest first.
export function useAnnouncementComments(announcementId: number, enabled: boolean): UseQueryResult<AnnouncementComment[], Error> {
  return useQuery({
    queryKey: THREAD_KEY(announcementId),
    enabled,
    refetchInterval: THREAD_REFRESH_MS,
    queryFn: async () =>
      unwrap(
        'load the comments',
        await supabase
          .from('announcement_comments')
          .select('*')
          .eq('announcement_id', announcementId)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(THREAD_LIMIT),
      ),
  })
}

// How many comments each of these announcements has. Only the ids travel, counted here.
// shortcut: one row per comment, capped at 5000; switch to a count view if threads ever get that long.
export function useAnnouncementCommentCounts(ids: number[]): UseQueryResult<ReadonlyMap<number, number>, Error> {
  return useQuery({
    queryKey: [...COUNTS_KEY, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = unwrap('count the comments', await supabase.from('announcement_comments').select('announcement_id').in('announcement_id', ids).limit(5000))
      const counts = new Map<number, number>()
      for (const r of rows) counts.set(r.announcement_id, (counts.get(r.announcement_id) ?? 0) + 1)
      return counts
    },
  })
}

// Writes a comment as the signed-in member (the database refuses any other author).
export function usePostAnnouncementComment(announcementId: number) {
  const queryClient = useQueryClient()
  const auth = useAuth()
  return useMutation<void, Error, string>({
    mutationFn: async (body) => {
      if (auth.status !== 'member') throw new Error('Sign in to comment.')
      const { error } = await supabase.from('announcement_comments').insert({ announcement_id: announcementId, author_id: auth.member.id, body })
      if (error) throw new DataError('post the comment', error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: THREAD_KEY(announcementId) })
      void queryClient.invalidateQueries({ queryKey: COUNTS_KEY })
    },
  })
}

export function useDeleteAnnouncementComment(announcementId: number) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('announcement_comments').delete().eq('id', id)
      if (error) throw new DataError('delete the comment', error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: THREAD_KEY(announcementId) })
      void queryClient.invalidateQueries({ queryKey: COUNTS_KEY })
    },
  })
}
