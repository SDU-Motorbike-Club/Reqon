import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The meeting reads and writes in isolation: what is sent, and above all what is said when a write that the
// database refused changed no row (RLS reports no error), so the person gets the real reason, not a success.

type Result = { data: unknown; error: { message: string; code?: string } | null }
let calls: { table: string; ops: [string, ...unknown[]][] }[]
let results: (table: string, ops: [string, ...unknown[]][]) => Result
let rpcs: Record<string, Result>
let signedIn = true

function builder(table: string) {
  const record = { table, ops: [] as [string, ...unknown[]][] }
  calls.push(record)
  const b: Record<string, unknown> = {}
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'range', 'single', 'returns']) {
    b[name] = (...args: unknown[]) => {
      record.ops.push([name, ...args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => void) => {
    resolve(results(table, record.ops))
    return Promise.resolve()
  }
  return b
}
vi.mock('../lib/supabase.ts', () => ({
  get supabase() {
    return { from: builder, rpc: (fn: string) => Promise.resolve(rpcs[fn] ?? { data: null, error: null }) }
  },
}))
vi.mock('../auth/context.ts', () => ({
  useAuth: () => (signedIn ? { status: 'member', member: { id: 'm1' } } : { status: 'signed-out' }),
}))
let season: string | undefined = 'season-a'
vi.mock('../season/context.ts', () => ({ useSeasonId: () => season }))

const {
  useMeetings, useCreateMeeting, useUpdateMeeting, useDeleteMeeting, useMeetingTemplate, useSaveMeetingTemplate,
  useMeetingAttendance, useSetMeetingAttendees,
} = await import('./useMeetings.ts')

function hook<T>(use: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderHook(use, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
}
const firstPageOnly = (rows: unknown[]) => (_t: string, ops: [string, ...unknown[]][]): Result => {
  const from = (ops.find((o) => o[0] === 'range')?.[1] as number | undefined) ?? 0
  return { data: from === 0 ? rows : [], error: null }
}
async function failure<T>(run: () => Promise<T>) {
  try {
    await run()
  } catch (e) {
    return e as Error & { permission?: boolean }
  }
  throw new Error('expected a failure')
}

const draft = {
  title: 'Weekly', heldOn: '2026-11-03', startsAt: '16:30', endsAt: null, location: 'Workshop', subteamKey: null,
  agenda: '## Agenda', notes: null, attendees: null,
}

beforeEach(() => {
  calls = []
  rpcs = {}
  signedIn = true
  season = 'season-a'
  results = () => ({ data: [], error: null })
})

describe('reading', () => {
  it('lists this season\'s meetings, newest first', async () => {
    results = firstPageOnly([{ id: 'a' }])
    const { result } = hook(useMeetings)
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'a' }]))
    expect(calls[0].ops).toContainEqual(['eq', 'season_id', 'season-a'])
    expect(calls[0].ops).toContainEqual(['order', 'held_on', { ascending: false }])
  })

  it('reads the default agenda, empty when there is none', async () => {
    results = () => ({ data: [{ body: '## Agenda' }], error: null })
    const first = hook(useMeetingTemplate)
    await waitFor(() => expect(first.result.current.data).toBe('## Agenda'))
    results = () => ({ data: [], error: null })
    const second = hook(useMeetingTemplate)
    await waitFor(() => expect(second.result.current.data).toBe(''))
  })

  it('maps each meeting to the members who came', async () => {
    results = firstPageOnly([
      { meeting_id: 'x', member_id: 'a' }, { meeting_id: 'x', member_id: 'b' }, { meeting_id: 'y', member_id: 'a' },
    ])
    const { result } = hook(useMeetingAttendance)
    await waitFor(() => expect(result.current.data?.get('x')).toEqual(['a', 'b']))
    expect(result.current.data?.get('y')).toEqual(['a'])
  })
})

describe('creating', () => {
  it('stores the meeting in the current season, under the signed-in member', async () => {
    results = () => ({ data: { id: 'new' }, error: null })
    const { result } = hook(useCreateMeeting)
    await act(async () => {
      await result.current.mutateAsync(draft)
    })
    const insert = calls[0].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>
    expect(insert).toMatchObject({ season_id: 'season-a', created_by: 'm1', title: 'Weekly', held_on: '2026-11-03', starts_at: '16:30' })
  })

  it('refuses when signed out', async () => {
    signedIn = false
    const { result } = hook(useCreateMeeting)
    expect((await failure(() => result.current.mutateAsync(draft))).message).toMatch(/not signed in/)
  })

  it('refuses when there is no season', async () => {
    season = undefined
    const { result } = hook(useCreateMeeting)
    expect((await failure(() => result.current.mutateAsync(draft))).message).toMatch(/no current season/)
  })
})

describe('editing', () => {
  const edit = { ...draft, id: 'a', expectedUpdatedAt: 't1' }

  it('saves when a row changed', async () => {
    results = () => ({ data: [{ id: 'a' }], error: null })
    const { result } = hook(useUpdateMeeting)
    await act(async () => {
      await result.current.mutateAsync(edit)
    })
    expect(calls[0].ops).toContainEqual(['eq', 'updated_at', 't1'])
  })

  it('says someone else saved first when the stamp moved on', async () => {
    results = (_t, ops) => (ops.some((o) => o[0] === 'update') ? { data: [], error: null } : { data: [{ updated_at: 't2' }], error: null })
    const { result } = hook(useUpdateMeeting)
    expect((await failure(() => result.current.mutateAsync(edit))).message).toMatch(/someone else saved it/)
  })

  it('says it no longer exists when an administrator finds it gone', async () => {
    results = (_t, ops) => (ops.some((o) => o[0] === 'update') ? { data: [], error: null } : { data: [], error: null })
    rpcs.is_admin = { data: true, error: null }
    const { result } = hook(useUpdateMeeting)
    expect((await failure(() => result.current.mutateAsync(edit))).message).toMatch(/no longer exists/)
  })

  it('is a permission problem for anyone else', async () => {
    rpcs.is_admin = { data: false, error: null }
    const { result } = hook(useUpdateMeeting)
    expect((await failure(() => result.current.mutateAsync({ ...edit, expectedUpdatedAt: undefined }))).permission).toBe(true)
  })

  it('names a failed write and a failed permission check', async () => {
    results = () => ({ data: null, error: { message: 'down' } })
    const first = hook(useUpdateMeeting)
    expect((await failure(() => first.result.current.mutateAsync(edit))).message).toMatch(/edit meetings/)
    results = () => ({ data: [], error: null })
    rpcs.is_admin = { data: null, error: { message: 'down' } }
    const second = hook(useUpdateMeeting)
    expect((await failure(() => second.result.current.mutateAsync({ ...edit, expectedUpdatedAt: undefined }))).message).toMatch(/check whether the meeting was saved/)
  })
})

describe('deleting', () => {
  it('deletes one meeting', async () => {
    results = () => ({ data: [{ id: 'a' }], error: null })
    const { result } = hook(useDeleteMeeting)
    await act(async () => {
      await result.current.mutateAsync('a')
    })
    expect(calls[0].ops).toContainEqual(['eq', 'id', 'a'])
  })

  it('treats a meeting already gone as done, for someone allowed to delete', async () => {
    rpcs.can_delete_records = { data: true, error: null }
    const { result } = hook(useDeleteMeeting)
    await act(async () => {
      await result.current.mutateAsync('a')
    })
  })

  it('is a permission problem for someone not allowed, and names a failed delete', async () => {
    rpcs.can_delete_records = { data: false, error: null }
    const first = hook(useDeleteMeeting)
    expect((await failure(() => first.result.current.mutateAsync('a'))).permission).toBe(true)
    results = () => ({ data: null, error: { message: 'down' } })
    const second = hook(useDeleteMeeting)
    expect((await failure(() => second.result.current.mutateAsync('a'))).message).toMatch(/delete meetings/)
  })
})

describe('the default agenda and attendance', () => {
  it('saves the default agenda under the signed-in member', async () => {
    results = () => ({ data: [{ id: true }], error: null })
    const { result } = hook(useSaveMeetingTemplate)
    await act(async () => {
      await result.current.mutateAsync('## New')
    })
    expect(calls[0].ops).toContainEqual(['update', { body: '## New', updated_by: 'm1' }])
  })

  it('refuses a default agenda save when signed out, when no row changed, and when it fails', async () => {
    signedIn = false
    const out = hook(useSaveMeetingTemplate)
    expect((await failure(() => out.result.current.mutateAsync('x'))).message).toMatch(/not signed in/)
    signedIn = true
    results = () => ({ data: [], error: null })
    const none = hook(useSaveMeetingTemplate)
    expect((await failure(() => none.result.current.mutateAsync('x'))).permission).toBe(true)
    results = () => ({ data: null, error: { message: 'down' } })
    const down = hook(useSaveMeetingTemplate)
    expect((await failure(() => down.result.current.mutateAsync('x'))).message).toMatch(/change the meeting template/)
  })

  it('replaces who came in one call, and names a failure', async () => {
    const { result } = hook(useSetMeetingAttendees)
    await act(async () => {
      await result.current.mutateAsync({ meetingId: 'a', memberIds: ['m1'] })
    })
    rpcs.set_meeting_attendees = { data: null, error: { message: 'down' } }
    const failing = hook(useSetMeetingAttendees)
    expect((await failure(() => failing.result.current.mutateAsync({ meetingId: 'a', memberIds: [] }))).message).toMatch(/record who came/)
  })
})
