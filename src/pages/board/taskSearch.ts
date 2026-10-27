import type { TaskRef } from '../../tasks/dependencies.ts'

export const TASK_SEARCH_LIMIT = 8

// Tasks that match what was typed, best first, at most `limit`. Every word typed
// must appear in the title or the department's name, in any order and any case,
// so "elec harness" finds "Wiring harness — Electronics". A title that starts
// with the first word comes before one that only contains it. Nothing typed
// lists the first few by title, so the list is never empty on opening.
export function searchTasks<T extends Pick<TaskRef, 'title' | 'subteam_key'>>(
  tasks: readonly T[],
  query: string,
  departmentName: (key: string | null) => string,
  limit: number = TASK_SEARCH_LIMIT,
): { matches: T[]; total: number } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title)
  const hits = tasks.filter((t) => {
    const haystack = `${t.title} ${departmentName(t.subteam_key)}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
  const rank = (t: T) => (terms.length > 0 && t.title.toLowerCase().startsWith(terms[0]) ? 0 : 1)
  hits.sort((a, b) => rank(a) - rank(b) || byTitle(a, b))
  return { matches: hits.slice(0, limit), total: hits.length }
}
