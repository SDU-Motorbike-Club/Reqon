import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { PostgrestError } from '@supabase/supabase-js'
import { DataError } from '../core/errors.ts'
import type { Database } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import type { ToolLocation } from '../team/toolModel.ts'
import { unwrap } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// The Team page: the club's tool list (20260141000000_team_tools.sql). Not season data.
export type Tool = Database['public']['Tables']['tools']['Row']

// ------------------------------------------------------------------ tools
export function useTools(): UseQueryResult<Tool[], Error> {
  return useQuery({
    queryKey: queryKeys.tools,
    queryFn: async () => unwrap('load the tool list', await supabase.from('tools').select('*').order('item')),
  })
}

// An UPDATE or DELETE that RLS refuses matches no row instead of failing, so
// "nothing changed" is reported rather than shown as success.
function refused(what: string, error: PostgrestError | null): never {
  if (error?.code === '23514' && error.message.includes('active member')) throw new DataError('Only an active member can have a tool.', null)
  if (error?.code === '23514') throw new DataError('Give the tool a name of 1 to 120 characters.', null)
  throw new DataError(what, error, error ? {} : { permission: true })
}

function useToolWrite<T>(what: string, write: (input: T) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, T>({
    mutationFn: async (input) => {
      const { data, error } = await write(input)
      if (error || !data || data.length === 0) refused(what, error)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tools }),
  })
}

// `ownerId` is only for an admin listing a tool for someone else; left out, the database makes it yours.
// `heldBy` is who has it (a member id), or null for nobody.
export function useAddTool() {
  return useToolWrite<{ item: string; location: ToolLocation; heldBy: string | null; ownerId?: string }>('add that tool', ({ item, location, heldBy, ownerId }) =>
    supabase.from('tools').insert({ item, location, held_by: heldBy, ...(ownerId ? { owner_id: ownerId } : {}) }).select('id'),
  )
}

// Where it is and who has it are changed separately or together; guard_tool_change() decides who may.
export function useUpdateTool() {
  return useToolWrite<{ id: string; item?: string; location?: ToolLocation; heldBy?: string | null }>('change that tool', ({ id, heldBy, ...rest }) =>
    supabase
      .from('tools')
      .update({ ...rest, ...(heldBy !== undefined ? { held_by: heldBy } : {}) })
      .eq('id', id)
      .select('id'),
  )
}

export function useRemoveTool() {
  return useToolWrite<string>('remove that tool', (id) => supabase.from('tools').delete().eq('id', id).select('id'))
}
