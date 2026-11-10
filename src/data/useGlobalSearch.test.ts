import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[] | Error>,
  filters: [] as string[],
}))
vi.mock('../lib/supabase.ts', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        or: (filter: string) => ({
          limit: async () => {
            db.filters.push(`${table}: ${filter}`)
            const r = db.rows[table]
            return r instanceof Error ? { data: null, error: r } : { data: r ?? [], error: null }
          },
        }),
      }),
    }),
  },
}))

const { searchEverywhere } = await import('./useGlobalSearch.ts')

beforeEach(() => {
  db.rows = {}
  db.filters = []
})

describe('searchEverywhere', () => {
  it('ignores a term shorter than two letters without asking the database', async () => {
    expect(await searchEverywhere(' a ')).toEqual([])
    expect(db.filters).toEqual([])
  })

  it('finds a hit in any source, says where it opens, and cuts from the field that matched', async () => {
    db.rows.tasks = [{ id: 't1', title: 'Wheel', detail: 'Torque the BRAKE bolts' }]
    db.rows.announcements = [{ id: 7, title: 'Pit day', body: 'Bring a brake kit' }]
    const hits = await searchEverywhere('brake')
    expect(hits).toContainEqual({ key: 'task-t1', title: 'Wheel', text: 'Torque the BRAKE bolts', page: 'Board', to: '/board?task=t1' })
    expect(hits).toContainEqual({ key: 'announcement-7', title: 'Pit day', text: 'Bring a brake kit', page: 'Announcements', to: '/inbox?announcements=1&announcement=7' })
  })

  it('takes filter punctuation out of the term so it cannot change the query', async () => {
    await searchEverywhere('a,b)(*"%x')
    expect(db.filters[0]).toContain('title.ilike.%a b x%')
  })

  it('keeps the results of the sources that answer when one is refused, and fails only when all do', async () => {
    db.rows.tasks = [{ id: 't1', title: 'Wheel', detail: null }]
    db.rows.contacts = new Error('permission denied')
    expect((await searchEverywhere('wheel')).map((h) => h.key)).toEqual(['task-t1'])
    for (const t of ['tasks', 'announcements', 'meetings', 'contacts', 'members', 'clauses']) db.rows[t] = new Error('down')
    await expect(searchEverywhere('wheel')).rejects.toThrow('down')
  })
})
