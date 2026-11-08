import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { useSeasonId } from '../season/context.ts'
import { unwrap } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// Makes a task part of another task (or takes it out again). An ordinary task edit, so RLS decides who may;
// the database refuses a second nesting level. The parent can change state as a result (it completes when
// its last subtask does), so the task list is re-read rather than patched.
export function useSetTaskParent() {
  const queryClient = useQueryClient()
  const seasonId = useSeasonId()
  return useMutation({
    // sectionId: put a new subtask in its parent's section in the same write (omit it to leave the section alone).
    mutationFn: async ({ id, parentId, sectionId }: { id: string; parentId: string | null; sectionId?: string | null }) => {
      const patch = { parent_id: parentId, ...(sectionId ? { section_id: sectionId } : {}) }
      const rows = unwrap('set the parent task', await supabase.from('tasks').update(patch).eq('id', id).select('id'))
      // An update RLS hides matches no row and raises nothing.
      if (rows.length === 0) throw new DataError('set the parent task', null, { permission: true })
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(seasonId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.progressTasks(seasonId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attention(seasonId) }),
      ]),
  })
}
