import { useMutation } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'

// Sets, or with an empty value clears, the signed-in member's own username (set_my_username, 20260160000000). The
// database checks the format and that nobody else has it; the two answers a person can act on are worded for them.
// Resolves with the name as stored (lower case), or null when it was cleared.
export function useSetMyUsername() {
  return useMutation<string | null, Error, string>({
    mutationFn: async (username) => {
      const { data, error } = await supabase.rpc('set_my_username', { p_username: username })
      if (error) {
        if (error.code === '23505') throw new Error('That username is taken.')
        if (error.code === '22023') throw new Error(error.message)
        throw new DataError('save your username', error)
      }
      return data ?? null
    },
  })
}
