import type { TaskState } from './types.ts'

// The Tasks page: every active task in one list that can be sorted by any column.
//
//  * The header of a column is a button. Clicking it sorts the WHOLE list (the database sorts all
//    rows, so page 2 continues the order of page 1). A second click on the same column flips the
//    direction; a new column starts ascending; a new sort goes back to page 1.
//  * The choice lives in the address (?sort=<column>&dir=asc|desc), so a reload or a shared link keeps it.
//  * Filters (search, department, whose, state) are separate: changing one keeps the sort.
//  * Only known columns are accepted. An unknown one falls back to the default order.
export const SORT_COLUMNS = ['title', 'department', 'owner', 'state', 'priority', 'due', 'milestone'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDirection = 'asc' | 'desc'

// The column of v_task_list (20260142000000) each heading sorts by. A closed list: nothing a user types
// ever reaches the query as a column name.
export const SORT_FIELD: Record<SortColumn, string> = {
  title: 'title',
  department: 'department_name',
  owner: 'owner_name',
  state: 'state',
  priority: 'priority',
  due: 'due_date',
  milestone: 'milestone_name',
}

export const COLUMN_LABEL: Record<SortColumn, string> = {
  title: 'Task',
  department: 'Department',
  owner: 'Owner',
  state: 'State',
  priority: 'Priority',
  due: 'Deadline',
  milestone: 'Milestone',
}

// Soonest deadline first, so what is overdue sits on top.
export const DEFAULT_SORT: { sort: SortColumn; dir: SortDirection } = { sort: 'due', dir: 'asc' }
export const TASK_LIST_PAGE_SIZE = 25
export const NO_DEPARTMENT_FILTER = 'none'

export type TaskStateFilter = 'open' | 'all' | TaskState
export const STATE_FILTERS: readonly { value: TaskStateFilter; label: string }[] = [
  { value: 'open', label: 'Open (not done or cancelled)' },
  { value: 'all', label: 'Every state' },
  { value: 'todo', label: 'To do' },
  { value: 'wip', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export type TaskListParams = {
  sort: SortColumn
  dir: SortDirection
  q: string
  department: string // 'all', NO_DEPARTMENT_FILTER or a department key
  scope: 'all' | 'mine'
  state: TaskStateFilter
  page: number // 1-based
}

export const DEFAULT_LIST: TaskListParams = { ...DEFAULT_SORT, q: '', department: 'all', scope: 'all', state: 'open', page: 1 }

const isColumn = (v: string | null): v is SortColumn => v !== null && (SORT_COLUMNS as readonly string[]).includes(v)
const isState = (v: string | null): v is TaskStateFilter => v !== null && STATE_FILTERS.some((s) => s.value === v)

// Read the list's choices from an address. Anything unknown means the default, never an error.
export function parseTaskListParams(params: URLSearchParams): TaskListParams {
  const rawSort = params.get('sort')
  const sort = isColumn(rawSort) ? rawSort : DEFAULT_SORT.sort
  // A direction without a known column means nothing: an unknown column brings the default direction too.
  const dir: SortDirection = isColumn(rawSort) && (params.get('dir') === 'asc' || params.get('dir') === 'desc') ? (params.get('dir') as SortDirection) : isColumn(rawSort) ? 'asc' : DEFAULT_SORT.dir
  const rawState = params.get('state')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    sort,
    dir,
    q: (params.get('q') ?? '').slice(0, 100),
    department: (params.get('dept') ?? 'all').slice(0, 60) || 'all',
    scope: params.get('scope') === 'mine' ? 'mine' : 'all',
    state: isState(rawState) ? rawState : DEFAULT_LIST.state,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

// Only what differs from the default is written, so the plain list keeps a plain address.
export function taskListToParams(list: TaskListParams): URLSearchParams {
  const out = new URLSearchParams()
  if (list.sort !== DEFAULT_SORT.sort || list.dir !== DEFAULT_SORT.dir) {
    out.set('sort', list.sort)
    out.set('dir', list.dir)
  }
  if (list.q.trim()) out.set('q', list.q)
  if (list.department !== 'all') out.set('dept', list.department)
  if (list.scope === 'mine') out.set('scope', 'mine')
  if (list.state !== DEFAULT_LIST.state) out.set('state', list.state)
  if (list.page > 1) out.set('page', String(list.page))
  return out
}

// What a click on a column heading does: the same column flips, another starts ascending; page 1 either way.
export function clickColumn(list: TaskListParams, column: SortColumn): TaskListParams {
  const dir: SortDirection = list.sort === column ? (list.dir === 'asc' ? 'desc' : 'asc') : 'asc'
  return { ...list, sort: column, dir, page: 1 }
}

// A filter change keeps the sort and goes back to page 1.
export function withFilter(list: TaskListParams, change: Partial<Pick<TaskListParams, 'q' | 'department' | 'scope' | 'state'>>): TaskListParams {
  return { ...list, ...change, page: 1 }
}

export const pageCountFor = (total: number) => Math.max(1, Math.ceil(total / TASK_LIST_PAGE_SIZE))

// The words of a search, made safe to put inside a PostgREST filter: its separators and wildcards
// are removed, never passed on.
export function searchWords(q: string): string[] {
  return q
    .replace(/[,()*%_\\"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
}
