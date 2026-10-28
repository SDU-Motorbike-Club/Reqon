import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The bug-report reads and writes in isolation: what is sent, how a database refusal is worded, and that a
// triage action which changed no row (the database hid it) is reported as a permission problem, not as success.

type Result = { data: unknown; error: { message: string; code?: string } | null }
let calls: { table: string; ops: [string, ...unknown[]][] }[]
let result: Result

function builder(table: string) {
  const record = { table, ops: [] as [string, ...unknown[]][] }
  calls.push(record)
  const b: Record<string, unknown> = {}
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
    b[name] = (...args: unknown[]) => {
      record.ops.push([name, ...args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => void) => {
    resolve(result)
    return Promise.resolve()
  }
  return b
}
vi.mock('../lib/supabase.ts', () => ({ get supabase() { return { from: builder } } }))

const { sendBugReport, useBugReports, useSetBugStatus, useDeleteBugReport, useSendBugReport } = await import('./useBugReports.ts')

function hook<T>(use: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderHook(use, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
}

const report = { source: 'manual' as const, message: 'It froze', details: null, page: '/board', user_agent: 'Firefox' }

beforeEach(() => {
  calls = []
  result = { data: null, error: null }
})

describe('sendBugReport', () => {
  it('inserts the report and asks for nothing back (a member may not read rows)', async () => {
    await sendBugReport(report)
    expect(calls).toEqual([{ table: 'bug_reports', ops: [['insert', report]] }])
  })

  it('says to wait when the hourly limit is hit', async () => {
    result = { data: null, error: { message: 'Too many bug reports', code: '54000' } }
    await expect(sendBugReport(report)).rejects.toThrow('Too many reports in the last hour')
  })

  it('names any other refusal', async () => {
    result = { data: null, error: { message: 'boom', code: 'XX000' } }
    await expect(sendBugReport(report)).rejects.toThrow(/send that report/)
  })

  it('works through the mutation hook', async () => {
    const { result: mutation } = hook(useSendBugReport)
    await act(async () => {
      await mutation.current.mutateAsync(report)
    })
    expect(calls[0].ops[0][0]).toBe('insert')
  })
})

describe('useBugReports', () => {
  it('loads newest first, at most 200', async () => {
    result = { data: [{ id: 'a' }], error: null }
    const { result: query } = hook(() => useBugReports(true))
    await waitFor(() => expect(query.current.data).toEqual([{ id: 'a' }]))
    expect(calls[0].ops).toEqual([['select', '*'], ['order', 'created_at', { ascending: false }], ['limit', 200]])
  })

  it('does not ask while disabled', () => {
    hook(() => useBugReports(false))
    expect(calls).toEqual([])
  })

  it('treats a missing result as an empty list', async () => {
    result = { data: null, error: null }
    const { result: query } = hook(() => useBugReports(true))
    await waitFor(() => expect(query.current.data).toEqual([]))
  })

  it('reports a failed load', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: query } = hook(() => useBugReports(true))
    await waitFor(() => expect(query.current.error?.message).toMatch(/load the bug reports/))
  })
})

describe('triage', () => {
  it('sets the status of one report', async () => {
    result = { data: [{ id: 'a' }], error: null }
    const { result: mutation } = hook(useSetBugStatus)
    await act(async () => {
      await mutation.current.mutateAsync({ id: 'a', status: 'done' })
    })
    expect(calls[0].ops).toEqual([['update', { status: 'done' }], ['eq', 'id', 'a'], ['select', 'id']])
  })

  it('is a permission problem when no row changed', async () => {
    result = { data: [], error: null }
    const { result: mutation } = hook(useSetBugStatus)
    await act(async () => {
      await mutation.current.mutateAsync({ id: 'a', status: 'open' }).catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error).not.toBeNull())
    expect((mutation.current.error as { permission?: boolean }).permission).toBe(true)
  })

  it('names a failed update', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: mutation } = hook(useSetBugStatus)
    await act(async () => {
      await mutation.current.mutateAsync({ id: 'a', status: 'done' }).catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/update that report/))
  })

  it('deletes one report', async () => {
    result = { data: [{ id: 'a' }], error: null }
    const { result: mutation } = hook(useDeleteBugReport)
    await act(async () => {
      await mutation.current.mutateAsync('a')
    })
    expect(calls[0].ops).toEqual([['delete'], ['eq', 'id', 'a'], ['select', 'id']])
  })

  it('is a permission problem when nothing was deleted', async () => {
    result = { data: [], error: null }
    const { result: mutation } = hook(useDeleteBugReport)
    await act(async () => {
      await mutation.current.mutateAsync('a').catch(() => {})
    })
    await waitFor(() => expect((mutation.current.error as { permission?: boolean } | null)?.permission).toBe(true))
  })

  it('names a failed delete', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: mutation } = hook(useDeleteBugReport)
    await act(async () => {
      await mutation.current.mutateAsync('a').catch(() => {})
    })
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/delete that report/))
  })
})
