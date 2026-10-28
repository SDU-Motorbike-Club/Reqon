import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import type { Database } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import type { CleanBugReport } from '../bugs/bugReport.ts'
import { queryKeys } from './queryKeys.ts'

// Bug reports (20260150000000_bug_reports.sql). Any member adds one; only a Developer reads, resolves or deletes.
export type BugReport = Database['public']['Tables']['bug_reports']['Row']

// Plain function, not a hook: the crash screen sits above every provider and still has to be able to send one.
// No .select(): a member may add a report but not read one back, so asking for the row would be refused.
export async function sendBugReport(report: CleanBugReport): Promise<void> {
  const { error } = await supabase.from('bug_reports').insert(report)
  if (error) {
    if (error.code === '54000') throw new DataError('Too many reports in the last hour. Please wait a little.', null)
    throw new DataError('send that report', error)
  }
}

export function useSendBugReport() {
  return useMutation<void, Error, CleanBugReport>({ mutationFn: sendBugReport })
}

// Newest first. Only a Developer gets rows: for anyone else the database returns none.
export function useBugReports(enabled: boolean): UseQueryResult<BugReport[], Error> {
  return useQuery({
    queryKey: queryKeys.bugReports,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('bug_reports').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw new DataError('load the bug reports', error)
      return data ?? []
    },
  })
}

export function useSetBugStatus() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { id: string; status: 'open' | 'done' }>({
    mutationFn: async ({ id, status }) => {
      const { data, error } = await supabase.from('bug_reports').update({ status }).eq('id', id).select('id')
      if (error) throw new DataError('update that report', error)
      if (!data || data.length === 0) throw new DataError('update that report', null, { permission: true })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bugReports }),
  })
}

export function useDeleteBugReport() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await supabase.from('bug_reports').delete().eq('id', id).select('id')
      if (error) throw new DataError('delete that report', error)
      if (!data || data.length === 0) throw new DataError('delete that report', null, { permission: true })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bugReports }),
  })
}
