import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

export const MIN_TERM = 2
const PER_SOURCE = 5

export type SearchHit = {
  key: string
  title: string
  // The field the term was found in (what the snippet is cut from).
  text: string
  // The screen it is found on, and where opening it goes.
  page: string
  to: string
}

type Row = Record<string, string | null>
type Source = { table: string; page: string; fields: string[]; select: string; hit: (r: Row) => Omit<SearchHit, 'text' | 'page'> }

// Where to look. RLS decides what this person may read, so a source they cannot read simply yields nothing.
const SOURCES: Source[] = [
  { table: 'tasks', page: 'Board', fields: ['title', 'detail'], select: 'id,title,detail', hit: (r) => ({ key: `task-${r.id}`, title: r.title ?? '', to: `/board?task=${r.id}` }) },
  { table: 'announcements', page: 'Announcements', fields: ['title', 'body'], select: 'id,title,body', hit: (r) => ({ key: `announcement-${r.id}`, title: r.title ?? 'Announcement', to: `/inbox?announcements=1&announcement=${r.id}` }) },
  { table: 'meetings', page: 'Meetings', fields: ['agenda', 'notes'], select: 'id,held_on,agenda,notes', hit: (r) => ({ key: `meeting-${r.id}`, title: `Meeting ${r.held_on}`, to: '/meetings' }) },
  { table: 'contacts', page: 'Contacts', fields: ['name', 'help', 'title'], select: 'id,name,help,title', hit: (r) => ({ key: `contact-${r.id}`, title: r.name ?? '', to: '/contacts' }) },
  { table: 'members', page: 'Roster', fields: ['full_name', 'skills', 'notes'], select: 'id,full_name,skills,notes', hit: (r) => ({ key: `member-${r.id}`, title: r.full_name ?? '', to: `/inbox?profile=${r.id}` }) },
  { table: 'clauses', page: 'Register', fields: ['printed_ref', 'body'], select: 'clause_key,printed_ref,body', hit: (r) => ({ key: `clause-${r.clause_key}`, title: r.printed_ref ?? '', to: '/register' }) },
]

// Characters that mean something in a PostgREST filter or in LIKE; they are not searched for, only spaces.
const clean = (term: string) => term.replace(/[%,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim()

export async function searchEverywhere(term: string): Promise<SearchHit[]> {
  const needle = clean(term)
  if (needle.length < MIN_TERM) return []
  const lower = needle.toLowerCase()
  const settled = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const filter = source.fields.map((f) => `${f}.ilike.%${needle}%`).join(',')
      // Typed loosely on purpose: the table and columns come from the SOURCES list above.
      const { data, error } = await (supabase.from(source.table as 'tasks').select(source.select).or(filter).limit(PER_SOURCE) as unknown as Promise<{ data: Row[] | null; error: Error | null }>)
      if (error) throw error
      return (data ?? []).map((row): SearchHit => {
        const field = source.fields.find((f) => row[f]?.toLowerCase().includes(lower)) ?? source.fields[0]
        return { ...source.hit(row), page: source.page, text: row[field] ?? '' }
      })
    }),
  )
  // Every source failing is an error to show; one failing (a table this person cannot read) is just fewer results.
  if (settled.every((r) => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// What the search box asks for, a moment after typing stops.
export function useGlobalSearch(term: string): { term: string; result: UseQueryResult<SearchHit[], Error> } {
  const [settledTerm, setSettledTerm] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSettledTerm(clean(term)), 250)
    return () => clearTimeout(id)
  }, [term])
  const result = useQuery({ queryKey: ['global-search', settledTerm], enabled: settledTerm.length >= MIN_TERM, queryFn: () => searchEverywhere(settledTerm), staleTime: 30_000 })
  return { term: settledTerm, result }
}
