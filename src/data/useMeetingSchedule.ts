import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import type { Database } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import { unwrap } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// The weekly meeting that creates itself (20260144000000_meeting_schedule_and_attendance.sql).
// Everyone on the roster reads the schedule; only the President, Vice President and Developer change it
// (is_admin()). A change applies to meetings not created yet: one that already exists keeps its own day,
// time and place. The club's time zone is fixed in the database, so it is not part of the form.
export type MeetingSchedule = Database['public']['Tables']['meeting_schedule']['Row']

export type MeetingScheduleDraft = {
  enabled: boolean
  // ISO weekday: 1 = Monday ... 7 = Sunday.
  weekday: number
  // HH:MM.
  startsAt: string
  endsAt: string | null
  title: string
  location: string | null
  leadDays: number
}

// What became of one coming occurrence, as the same database function that makes the meetings sees it.
export type Occurrence = {
  occurrence_date: string
  status: 'created' | 'skipped' | 'pending'
  meeting_id: string | null
  held_on: string | null
}

export function useMeetingSchedule(): UseQueryResult<MeetingSchedule | null, Error> {
  return useQuery({
    queryKey: queryKeys.meetingSchedule,
    queryFn: async () => {
      const rows = unwrap('load the meeting schedule', await supabase.from('meeting_schedule').select('*').eq('id', true).limit(1))
      return rows[0] ?? null
    },
  })
}

export function useUpcomingOccurrences(count = 6): UseQueryResult<Occurrence[], Error> {
  return useQuery({
    queryKey: [...queryKeys.meetingOccurrences, count],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('upcoming_meeting_occurrences', { p_count: count })
      if (error) throw new DataError('load the coming meetings', error)
      return (data ?? []) as Occurrence[]
    },
  })
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.meetingSchedule })
    void queryClient.invalidateQueries({ queryKey: queryKeys.meetingOccurrences })
  }
}

export function useSaveMeetingSchedule(updatedBy: string | null) {
  const refresh = useRefresh()
  return useMutation<void, Error, MeetingScheduleDraft>({
    mutationFn: async (draft) => {
      const { data, error } = await supabase
        .from('meeting_schedule')
        .update({
          enabled: draft.enabled,
          weekday: draft.weekday,
          starts_at: draft.startsAt,
          ends_at: draft.endsAt,
          title: draft.title,
          location: draft.location,
          lead_days: draft.leadDays,
          updated_by: updatedBy,
        })
        .eq('id', true)
        .select('id')
      if (error) throw new DataError('change the meeting schedule', error)
      // An UPDATE that RLS refuses touches no rows and reports no error.
      if (!data || data.length === 0) throw new DataError('change the meeting schedule', null, { permission: true })
    },
    onSettled: refresh,
  })
}

export function useSkipOccurrence() {
  const refresh = useRefresh()
  return useMutation<void, Error, { occurrenceDate: string; reason?: string }>({
    mutationFn: async ({ occurrenceDate, reason }) => {
      const { error } = await supabase.from('meeting_skips').insert({ occurrence_date: occurrenceDate, reason: reason ?? null })
      // Already skipped is the outcome that was wanted.
      if (error && error.code !== '23505') throw new DataError('skip that meeting', error)
    },
    onSettled: refresh,
  })
}

export function useRestoreOccurrence() {
  const refresh = useRefresh()
  return useMutation<void, Error, string>({
    mutationFn: async (occurrenceDate) => {
      const { error } = await supabase.from('meeting_skips').delete().eq('occurrence_date', occurrenceDate)
      if (error) throw new DataError('bring that meeting back', error)
    },
    onSettled: refresh,
  })
}
