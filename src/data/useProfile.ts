import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'
import { unwrapMaybe } from './errors.ts'

export const MESSAGE_MAX = 1000

// A colleague's email. It lives only in the login system, so the database hands it out through member_email()
// (20260154000000) to active and trial members. Name, job title and phone are already on the roster (useMembers).
export function useMemberEmail(memberId: string | null): UseQueryResult<string | null, Error> {
  return useQuery({
    queryKey: ['member_email', memberId ?? 'nobody'],
    enabled: memberId !== null,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => unwrapMaybe('load their email', await supabase.rpc('member_email', { p_member_id: memberId as string })),
  })
}

// Sends a message to another member's inbox (send_message(): the database checks both people, the length and a
// per-hour limit, and records who sent it). Nothing to refresh here: the sender does not see sent messages.
export function useSendMessage() {
  return useMutation<void, Error, { to: string; body: string }>({
    mutationFn: async ({ to, body }) => {
      const { error } = await supabase.rpc('send_message', { p_to: to, p_body: body })
      if (error) throw new DataError('send the message', error)
    },
  })
}
