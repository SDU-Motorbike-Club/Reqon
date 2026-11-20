import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import { useSeasonId } from '../season/context.ts'
import { groupAssignees } from '../tasks/assignees.ts'
import { fetchAllRows, unwrapMaybe } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// Who every task of the season is assigned to, read once and shared by the Board, the Gantt and Now.
export function useTaskAssignees(): UseQueryResult<Map<string, string[]>, Error> {
  const seasonId = useSeasonId()
  return useQuery({
    queryKey: queryKeys.taskAssignees(seasonId),
    enabled: Boolean(seasonId),
    queryFn: async () => {
      const rows = await fetchAllRows(
        'load who tasks are assigned to',
        (row: { task_id: string; member_id: string }) => `${row.task_id}|${row.member_id}`,
        (from, to) =>
          supabase
            .from('task_assignees')
            .select('task_id, member_id, tasks!inner(season_id)')
            .eq('tasks.season_id', seasonId as string)
            .order('task_id')
            .order('member_id')
            .range(from, to),
      )
      return groupAssignees(rows)
    },
  })
}

// Not optimistic: the database decides who may assign and who may be assigned. The first listed person
// becomes the lead when the current lead is not listed, so the task rows and the history change too.
export function useSetTaskAssignees() {
  const queryClient = useQueryClient()
  const seasonId = useSeasonId()
  return useMutation<void, Error, { taskId: string; memberIds: string[] }, { seasonId: string | undefined }>({
    onMutate: () => ({ seasonId }),
    mutationFn: async ({ taskId, memberIds }) => {
      // The function returns nothing (void), so an empty answer is success.
      unwrapMaybe('change who the task is assigned to', await supabase.rpc('set_task_assignees', { p_task_id: taskId, p_member_ids: memberIds }))
    },
    onSettled: (_data, _error, _vars, context) => {
      const forSeason = context?.seasonId ?? seasonId
      for (const key of [queryKeys.taskAssignees(forSeason), queryKeys.tasks(forSeason), queryKeys.activityAll(forSeason)]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}
