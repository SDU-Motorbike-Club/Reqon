import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import type { ContributionTask } from '../contributions/contributionModel.ts'
import { fetchAllRows } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// Every finished task one member owns, across all seasons, archived ones
// included: finishing a task does not stop it being their work. Read-only and
// no new table; the roster already reads every task (member_read), so this
// shows nothing the Board and the Archive do not.
export function useContributions(memberId: string | undefined): UseQueryResult<ContributionTask[], Error> {
  return useQuery({
    queryKey: queryKeys.contributions(memberId),
    enabled: Boolean(memberId),
    queryFn: () =>
      fetchAllRows<ContributionTask>(
        'load the contribution record',
        (row) => row.id,
        (from, to) =>
          supabase
            .from('tasks')
            .select('id, title, season_id, subteam_key, completed_at, archived_at')
            .eq('owner_id', memberId as string)
            .eq('state', 'done')
            .order('completed_at', { ascending: false, nullsFirst: false })
            .order('id')
            .range(from, to),
      ),
  })
}
