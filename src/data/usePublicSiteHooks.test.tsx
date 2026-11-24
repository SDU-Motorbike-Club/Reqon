import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Public page's reads and writes in isolation: what is sent to which table, how the two form-level
// database refusals are worded, and that a write which changed no row (RLS hid it) is reported as a
// permission problem rather than as success. The pure helpers are covered in usePublicSite.test.ts.

type Result = { data: unknown; error: { message: string; code?: string } | null }
let calls: { table: string; ops: [string, ...unknown[]][] }[]
let result: Result
let uploads: { bucket: string; path: string; file: File; options: unknown }[]
let uploadError: { message: string } | null

function builder(table: string) {
  const record = { table, ops: [] as [string, ...unknown[]][] }
  calls.push(record)
  const b: Record<string, unknown> = {}
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
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

const storage = {
  from: (bucket: string) => ({
    upload: async (path: string, file: File, options: unknown) => {
      uploads.push({ bucket, path, file, options })
      return { data: uploadError ? null : { path }, error: uploadError }
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
  }),
}
vi.mock('../lib/supabase.ts', () => ({ get supabase() { return { from: builder, storage } } }))

const {
  uploadBlogCover,
  useApplications,
  useBlogPosts,
  useDeleteApplication,
  useDeleteBlogPost,
  useDeleteEvent,
  useEvents,
  useSaveBlogPost,
  useSaveEvent,
  useSetApplicationStatus,
} = await import('./usePublicSite.ts')

function hook<T>(use: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderHook(use, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
}

type Mutation<T> = { current: { mutateAsync: (input: T) => Promise<void>; error: Error | null } }
async function run<T>(mutation: Mutation<T>, input: T) {
  await act(async () => {
    await mutation.current.mutateAsync(input).catch(() => {})
  })
}

beforeEach(() => {
  calls = []
  result = { data: null, error: null }
  uploads = []
  uploadError = null
})

describe('reads', () => {
  it('loads applications newest first and reads their answers either way they were stored', async () => {
    result = {
      data: [
        { id: 'a', answers: [{ question: 'Why?', answer: 'Bikes' }] },
        { id: 'b', answers: { 'Why?': 'Speed' } },
      ],
      error: null,
    }
    const { result: query } = hook(useApplications)
    await waitFor(() => expect(query.current.isSuccess).toBe(true))
    expect(calls).toEqual([{ table: 'membership_applications', ops: [['select', '*'], ['order', 'created_at', { ascending: false }]] }])
    expect(query.current.data?.map((a) => a.answers)).toEqual([[{ question: 'Why?', answer: 'Bikes' }], [{ question: 'Why?', answer: 'Speed' }]])
  })

  it('reports a failed applications load', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: query } = hook(useApplications)
    await waitFor(() => expect(query.current.error?.message).toMatch(/load the applications/))
  })

  it('loads blog posts drafts first, then newest published', async () => {
    result = { data: [{ id: 'p' }], error: null }
    const { result: query } = hook(useBlogPosts)
    await waitFor(() => expect(query.current.data).toEqual([{ id: 'p' }]))
    expect(calls[0]).toEqual({
      table: 'blog_posts',
      ops: [['select', '*'], ['order', 'published_at', { ascending: false, nullsFirst: true }], ['order', 'updated_at', { ascending: false }]],
    })
  })

  it('loads events soonest first', async () => {
    result = { data: [{ id: 'e' }], error: null }
    const { result: query } = hook(useEvents)
    await waitFor(() => expect(query.current.data).toEqual([{ id: 'e' }]))
    expect(calls[0]).toEqual({ table: 'events', ops: [['select', '*'], ['order', 'starts_at']] })
  })

  it('reports a failed events load', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: query } = hook(useEvents)
    await waitFor(() => expect(query.current.error?.message).toMatch(/load the events/))
  })
})

describe('applications', () => {
  it('changes the status of one application', async () => {
    result = { data: [{ id: 'a' }], error: null }
    const { result: mutation } = hook(useSetApplicationStatus)
    await run(mutation, { id: 'a', status: 'contacted' })
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'membership_applications', ops: [['update', { status: 'contacted' }], ['eq', 'id', 'a'], ['select', 'id']] })
  })

  it('is a permission problem when no application changed', async () => {
    result = { data: [], error: null }
    const { result: mutation } = hook(useSetApplicationStatus)
    await run(mutation, { id: 'a', status: 'accepted' })
    await waitFor(() => expect((mutation.current.error as { permission?: boolean } | null)?.permission).toBe(true))
    expect(mutation.current.error?.message).toMatch(/change that application/)
  })

  it('deletes one application', async () => {
    result = { data: [{ id: 'a' }], error: null }
    const { result: mutation } = hook(useDeleteApplication)
    await run(mutation, 'a')
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'membership_applications', ops: [['delete'], ['eq', 'id', 'a'], ['select', 'id']] })
  })

  it('names a failed delete', async () => {
    result = { data: null, error: { message: 'down' } }
    const { result: mutation } = hook(useDeleteApplication)
    await run(mutation, 'a')
    await waitFor(() => expect(mutation.current.error?.message).toBe('delete that application: down'))
  })
})

describe('blog posts', () => {
  const post = {
    title: 'Track day',
    slug: 'track-day',
    excerpt: null,
    content: 'We rode.',
    category: 'track' as const,
    cover_image_url: null,
    cover_image_alt: null,
    is_featured: false,
    status: 'draft' as const,
  }

  it('inserts a new post', async () => {
    result = { data: [{ id: 'p' }], error: null }
    const { result: mutation } = hook(useSaveBlogPost)
    await run(mutation, post)
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'blog_posts', ops: [['insert', post], ['select', 'id']] })
  })

  it('updates an existing post without sending its id as a column', async () => {
    result = { data: [{ id: 'p' }], error: null }
    const { result: mutation } = hook(useSaveBlogPost)
    await run(mutation, { id: 'p', status: 'published' as const })
    expect(calls[0]).toEqual({ table: 'blog_posts', ops: [['update', { status: 'published' }], ['eq', 'id', 'p'], ['select', 'id']] })
  })

  it('explains a web address another post already uses', async () => {
    result = { data: null, error: { message: 'duplicate key', code: '23505' } }
    const { result: mutation } = hook(useSaveBlogPost)
    await run(mutation, post)
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/Another post already uses that web address/))
  })

  it('explains a field the database check refused', async () => {
    result = { data: null, error: { message: 'violates check constraint', code: '23514' } }
    const { result: mutation } = hook(useSaveBlogPost)
    await run(mutation, post)
    await waitFor(() => expect(mutation.current.error?.message).toMatch(/too long or empty/))
  })

  it('deletes one post, and reports a delete that matched nothing', async () => {
    result = { data: [{ id: 'p' }], error: null }
    const { result: mutation } = hook(useDeleteBlogPost)
    await run(mutation, 'p')
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'blog_posts', ops: [['delete'], ['eq', 'id', 'p'], ['select', 'id']] })

    result = { data: [], error: null }
    await run(mutation, 'p')
    await waitFor(() => expect((mutation.current.error as { permission?: boolean } | null)?.permission).toBe(true))
  })
})

describe('events', () => {
  const event = {
    title: 'Spring ride',
    type: 'ride' as const,
    starts_at: '2026-04-01T09:00:00Z',
    location: 'Campus',
    signup_url: null,
    is_published: false,
  }

  it('inserts a new event', async () => {
    result = { data: [{ id: 'e' }], error: null }
    const { result: mutation } = hook(useSaveEvent)
    await run(mutation, event)
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'events', ops: [['insert', event], ['select', 'id']] })
  })

  it('shows or hides an existing event', async () => {
    result = { data: [{ id: 'e' }], error: null }
    const { result: mutation } = hook(useSaveEvent)
    await run(mutation, { id: 'e', is_published: true })
    expect(calls[0]).toEqual({ table: 'events', ops: [['update', { is_published: true }], ['eq', 'id', 'e'], ['select', 'id']] })
  })

  it('is a permission problem when the event did not change', async () => {
    result = { data: [], error: null }
    const { result: mutation } = hook(useSaveEvent)
    await run(mutation, { id: 'e', is_published: true })
    await waitFor(() => expect((mutation.current.error as { permission?: boolean } | null)?.permission).toBe(true))
  })

  it('deletes one event', async () => {
    result = { data: [{ id: 'e' }], error: null }
    const { result: mutation } = hook(useDeleteEvent)
    await run(mutation, 'e')
    expect(mutation.current.error).toBeNull()
    expect(calls[0]).toEqual({ table: 'events', ops: [['delete'], ['eq', 'id', 'e'], ['select', 'id']] })
  })
})

describe('uploadBlogCover', () => {
  it('uploads into the public bucket under a fresh name, keeps a clean extension, and returns the public URL', async () => {
    const file = new File(['x'], 'Cover.Final.JP-G', { type: 'image/jpeg' })
    const url = await uploadBlogCover(file)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].bucket).toBe('blog-images')
    expect(uploads[0].path).toMatch(/^covers\/[0-9a-f-]{36}\.jpg$/)
    expect(uploads[0].options).toEqual({ contentType: 'image/jpeg', cacheControl: '31536000' })
    expect(url).toBe(`https://cdn.example/blog-images/${uploads[0].path}`)
  })

  it('leaves the extension off a file name without one', async () => {
    await uploadBlogCover(new File(['x'], 'cover', { type: 'image/png' }))
    expect(uploads[0].path).toMatch(/^covers\/[0-9a-f-]{36}$/)
  })

  it('says why an upload failed', async () => {
    uploadError = { message: 'Payload too large' }
    await expect(uploadBlogCover(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow(
      'Could not upload the cover image: Payload too large',
    )
  })
})
