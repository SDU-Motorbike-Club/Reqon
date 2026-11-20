import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './queryKeys.ts'
import { type RealtimeState, useSeasonRealtimeChannel } from './realtime.ts'

// Assignments, live. task_assignees has no season_id to filter on and DELETE events do not reliably reach a
// filtered subscription, so, like the prerequisite links, any event refreshes the season's (small) list.
export function useRealtimeTaskAssignees(): RealtimeState {
  const queryClient = useQueryClient()
  const refresh = (seasonId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignees(seasonId) })
  }
  return useSeasonRealtimeChannel<Record<string, unknown>>('task_assignees', (_payload, seasonId) => refresh(seasonId), {
    filterBySeasonId: false,
    onSubscribed: refresh,
  })
}
