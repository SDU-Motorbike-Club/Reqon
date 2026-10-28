import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The picture reads and writes in isolation: your own row for the header, every row once for a roster, and
// the save / remove commands, including the signed-out refusal and a database refusal named in words.

type Result = { data: unknown; error: { message: string; code?: string } | null }
let calls: { table: string; ops: [string, ...unknown[]][] }[]
let result: (ops: [string, ...unknown[]][]) => Result
let signedIn = true

function builder(table: string) {
  const record = { table, ops: [] as [string, ...unknown[]][] }
  calls.push(record)
  const b: Record<string, unknown> = {}
  for (const name of ['select', 'upsert', 'delete', 'eq', 'order', 'limit', 'range']) {
    b[name] = (...args: unknown[]) => {
      record.ops.push([name, ...args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => void) => {
    resolve(result(record.ops))
    return Promise.resolve()
  }
  return b
}
vi.mock('../lib/supabase.ts', () => ({ get supabase() { return { from: builder } } }))
vi.mock('../auth/context.ts', () => ({
  useAuth: () => (signedIn ? { status: 'member', member: { id: 'm1' } } : { status: 'signed-out' }),
}))

const { useMyAvatar, useAvatars, useSetMyAvatar, useRemoveMyAvatar } = await import('./useAvatars.ts')

function hook<T>(use: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderHook(use, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
}

beforeEach(() => {
  calls = []
  signedIn = true
  result = () => ({ data: [], error: null })
})

describe('useMyAvatar', () => {
  it('loads only your own row', async () => {
    result = () => ({ data: [{ image: 'data:image/webp;base64,AA' }], error: null })
    const { result: query } = hook(useMyAvatar)
    await waitFor(() => expect(query.current.data).toBe('data:image/webp;base64,AA'))
    expect(calls[0].ops).toContainEqual(['eq', 'member_id', 'm1'])
  })

  it('is null when there is no picture', async () => {
    const { result: query } = hook(useMyAvatar)
    await waitFor(() => expect(query.current.data).toBeNull())
  })

  it('does not ask when signed out', () => {
    signedIn = false
    hook(useMyAvatar)
    expect(calls).toEqual([])
  })
})

describe('useAvatars', () => {
  it('maps every member id to a picture', async () => {
    result = (ops) => {
      const from = (ops.find((o) => o[0] === 'range')?.[1] as number | undefined) ?? 0
      return { data: from === 0 ? [{ member_id: 'a', image: 'x' }, { member_id: 'b', image: 'y' }] : [], error: null }
    }
    const { result: query } = hook(useAvatars)
    await waitFor(() => expect(query.current.data?.get('b')).toBe('y'))
    expect(query.current.data?.size).toBe(2)
  })
})

describe('useSetMyAvatar', () => {
  it('saves under your own id, replacing the old picture', async () => {
    const { result: mutation } = hook(useSetMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync('data:image/webp;base64,BB')
    })
    expect(calls[0].ops[0]).toEqual(['upsert', { member_id: 'm1', image: 'data:image/webp;base64,BB' }, { onConflict: 'member_id' }])
  })

  it('refuses when signed out', async () => {
    signedIn = false
    const { result: mutation } = hook(useSetMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync('x').catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/not signed in/))
    expect(calls).toEqual([])
  })

  it('names a database refusal', async () => {
    result = () => ({ data: null, error: { message: 'too big', code: '23514' } })
    const { result: mutation } = hook(useSetMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync('x').catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/save your picture/))
  })
})

describe('useRemoveMyAvatar', () => {
  it('deletes only your own row', async () => {
    const { result: mutation } = hook(useRemoveMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync()
    })
    expect(calls[0].ops).toEqual([['delete'], ['eq', 'member_id', 'm1']])
  })

  it('refuses when signed out', async () => {
    signedIn = false
    const { result: mutation } = hook(useRemoveMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync().catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/not signed in/))
  })

  it('names a database refusal', async () => {
    result = () => ({ data: null, error: { message: 'down' } })
    const { result: mutation } = hook(useRemoveMyAvatar)
    await act(async () => {
      await mutation.current.mutateAsync().catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/remove your picture/))
  })
})
