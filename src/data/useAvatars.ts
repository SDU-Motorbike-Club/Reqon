import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../auth/context.ts'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { fetchAllRows, unwrap } from './errors.ts'

// Profile pictures (20260145000000_profile_photo_and_settings_usage.sql). Each is a small data: URL in its own
// table, so the roster query that loads on every screen never carries image data.
//
// Two reads, for two needs. The header shows only YOUR picture, one row, on every screen. A page that shows many
// people (the roster) loads all of them once. Neither refetches by itself: a picture changes when its owner
// changes it, and that invalidates both.
const MY_KEY = (memberId: string | null) => ['member_avatar', memberId ?? 'nobody'] as const
const ALL_KEY = ['member_avatars'] as const
const LONG = 60 * 60 * 1000

export type AvatarMap = ReadonlyMap<string, string>

export function useMyAvatar(): UseQueryResult<string | null, Error> {
  const auth = useAuth()
  const memberId = auth.status === 'member' ? auth.member.id : null
  return useQuery({
    queryKey: MY_KEY(memberId),
    enabled: memberId !== null,
    staleTime: LONG,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const rows = unwrap('load your picture', await supabase.from('member_avatars').select('image').eq('member_id', memberId as string).limit(1))
      return rows[0]?.image ?? null
    },
  })
}

// Everyone's pictures, by member id. Only for a screen that shows several people.
export function useAvatars(): UseQueryResult<AvatarMap, Error> {
  return useQuery({
    queryKey: ALL_KEY,
    staleTime: LONG,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const rows = await fetchAllRows<{ member_id: string; image: string }>(
        'load the pictures',
        (row) => row.member_id,
        (from, to) => supabase.from('member_avatars').select('member_id, image').order('member_id').range(from, to),
      )
      return new Map(rows.map((row) => [row.member_id, row.image]))
    },
  })
}

function useRefresh(memberId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: MY_KEY(memberId) })
    void queryClient.invalidateQueries({ queryKey: ALL_KEY })
  }
}

export function useSetMyAvatar() {
  const auth = useAuth()
  const memberId = auth.status === 'member' ? auth.member.id : null
  const refresh = useRefresh(memberId)
  return useMutation<void, Error, string>({
    mutationFn: async (image) => {
      if (!memberId) throw new DataError('save your picture: not signed in', null)
      const { error } = await supabase.from('member_avatars').upsert({ member_id: memberId, image }, { onConflict: 'member_id' })
      if (error) throw new DataError('save your picture', error)
    },
    onSettled: refresh,
  })
}

export function useRemoveMyAvatar() {
  const auth = useAuth()
  const memberId = auth.status === 'member' ? auth.member.id : null
  const refresh = useRefresh(memberId)
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!memberId) throw new DataError('remove your picture: not signed in', null)
      const { error } = await supabase.from('member_avatars').delete().eq('member_id', memberId)
      if (error) throw new DataError('remove your picture', error)
    },
    onSettled: refresh,
  })
}
