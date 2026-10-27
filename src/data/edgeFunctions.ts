import { DataError } from '../core/errors.ts'
import { supabase } from '../lib/supabase.ts'

// Calls one of the project's Edge Functions (supabase/functions/*) with the
// signed-in person's own session and turns a refusal into a DataError. Every
// function answers a problem as JSON { error } worded for a club member, so
// that wording is shown as written.
//
// `what` completes "You don't have permission to …" for a 403, and prefixes
// failures the function did not explain.
export async function invokeEdgeFunction<T>(name: string, body: Record<string, unknown>, what: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) {
    const response = (error as { context?: unknown }).context
    let status = 0
    let message: string | null = null
    if (response instanceof Response) {
      status = response.status
      try {
        const answer: unknown = await response.json()
        if (answer && typeof answer === 'object' && typeof (answer as { error?: unknown }).error === 'string') {
          message = (answer as { error: string }).error
        }
      } catch {
        // Not JSON (a gateway error page): fall back to the generic wording.
      }
    }
    // 401 is an expired or missing session, not a refusal: say so instead
    // of "you don't have permission".
    if (status === 401) throw new DataError(message ?? 'Your session has expired. Sign in again.', null)
    if (status === 403) throw new DataError(what, null, { permission: true })
    throw new DataError(message ?? `${what}: ${error.message}`, null)
  }
  if (data === null || data === undefined) throw new DataError(`${what}: the server sent no answer`, null)
  return data
}
