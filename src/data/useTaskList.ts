import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import type { Database } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import { useSeasonId } from '../season/context.ts'
import { NO_DEPARTMENT_FILTER, searchWords, SORT_FIELD, TASK_LIST_PAGE_SIZE, type TaskListParams } from '../tasks/taskList.ts'
import { queryKeys } from './queryKeys.ts'

export type TaskListRow = Database['public']['Views']['v_task_list']['Row']
export type TaskListPage = { rows: TaskListRow[]; total: number }

// PostgREST answers a page past the end of a filtered result with 416; that is "no rows here", not a failure.
const PAST_THE_END = 'PGRST103'

// One page of the Tasks list. The DATABASE sorts and filters every row (v_task_list, 20260142000000), so
// page 2 continues the order of page 1 and the search covers all tasks, not the ones on screen. Under the
// season's tasks key, so a task change (here or by someone else) refreshes it.
export function useTaskList(list: TaskListParams, myId: string | null): UseQueryResult<TaskListPage, Error> {
  const seasonId = useSeasonId()
  return useQuery({
    queryKey: [...queryKeys.tasks(seasonId), 'list', list, myId],
    enabled: Boolean(seasonId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from('v_task_list').select('*', { count: 'exact' }).eq('season_id', seasonId as string).is('archived_at', null)
      if (list.state === 'open') query = query.not('state', 'in', '(done,cancelled)')
      else if (list.state !== 'all') query = query.eq('state', list.state)
      if (list.department === NO_DEPARTMENT_FILTER) query = query.is('subteam_key', null)
      else if (list.department !== 'all') query = query.eq('subteam_key', list.department)
      if (list.scope === 'mine') query = query.eq('owner_id', myId ?? '00000000-0000-0000-0000-000000000000')
      // Every word must be found in the title, the owner, the department or the milestone.
      for (const word of searchWords(list.q)) {
        query = query.or(`title.ilike.%${word}%,owner_name.ilike.%${word}%,department_name.ilike.%${word}%,milestone_name.ilike.%${word}%`)
      }
      const from = (list.page - 1) * TASK_LIST_PAGE_SIZE
      const { data, error, count } = await query
        // The chosen column (from a closed list, never typed text), empty values last, then a stable tie-break.
        .order(SORT_FIELD[list.sort], { ascending: list.dir === 'asc', nullsFirst: false })
        .order('title')
        .order('id')
        .range(from, from + TASK_LIST_PAGE_SIZE - 1)
      if (error?.code === PAST_THE_END) return { rows: [], total: count ?? 0 }
      if (error) throw new DataError('load the task list', error)
      return { rows: data ?? [], total: count ?? 0 }
    },
  })
}
