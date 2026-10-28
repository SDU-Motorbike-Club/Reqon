import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import { fetchAllRows } from './errors.ts'

// Which Settings sections this person uses (20260145000000). The page sorts its sections by it.
//
// The order must hold still while someone works, so this is read once per visit and never refetched or
// invalidated: recording a use changes the NEXT visit's order, not this one's.
export type SettingsUsage = ReadonlyMap<string, { score: number; scoredAt: string }>

export function useSettingsUsage(): UseQueryResult<SettingsUsage, Error> {
  return useQuery({
    queryKey: ['settings_usage'],
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => {
      const rows = await fetchAllRows<{ section: string; score: number; scored_at: string }>(
        'load your Settings habits',
        (row) => row.section,
        (from, to) => supabase.from('settings_usage').select('section, score, scored_at').order('section').range(from, to),
      )
      return new Map(rows.map((row) => [row.section, { score: row.score, scoredAt: row.scored_at }]))
    },
  })
}

// Fire and forget: a failure costs a little accuracy in a convenience, so it is neither shown nor retried.
export function useRecordSettingsOpen() {
  const record = useMutation<void, Error, string>({
    retry: false,
    mutationFn: async (section) => {
      await supabase.rpc('record_settings_open', { p_section: section })
    },
  })
  return record.mutate
}
