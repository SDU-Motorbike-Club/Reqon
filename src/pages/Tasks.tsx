import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { useTaskList, type TaskListRow } from '../data/useTaskList.ts'
import { useTasks } from '../data/useTasks.ts'
import { nestUnderParents } from '../tasks/hierarchy.ts'
import { formatDay, todayIso } from '../lib/dates.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import {
  clickColumn,
  COLUMN_LABEL,
  NO_DEPARTMENT_FILTER,
  pageCountFor,
  parseTaskListParams,
  SORT_COLUMNS,
  STATE_FILTERS,
  TASK_LIST_PAGE_SIZE,
  taskListToParams,
  withFilter,
  type SortColumn,
  type TaskListParams,
  type TaskStateFilter,
} from '../tasks/taskList.ts'
import { TASK_PRIORITY_LABEL } from '../tasks/priority.ts'
import { TASK_STATE_LABEL } from '../tasks/taskState.ts'
import type { TaskPriority, TaskState } from '../tasks/types.ts'
import { buttonSecondary } from '../ui/buttons.ts'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-600'

// A list row with what nestUnderParents needs (id, parent, title); `row` is absent on the season-wide entries used only for lookups.
type Entry = { id: string; parent_id: string | null; title: string; row?: TaskListRow }

// Every active task of the season in one list, sortable by any column. The sort, the filters and the
// page live in the address (?sort=&dir=&q=&dept=&scope=&state=&page=), so a reload or a shared link keeps
// them. The database sorts and filters every row, not only the page on screen. Column headings are
// buttons on a wide screen; on a phone the list is cards and has no headings to sort by.
export default function Tasks() {
  const auth = useAuth()
  const myId = auth.status === 'member' ? auth.member.id : null
  const [params, setParams] = useUrlParams()
  const list = useMemo(() => parseTaskListParams(params), [params])
  const departments = useSubteams()
  const result = useTaskList(list, myId)
  const today = todayIso()

  const go = (next: TaskListParams) => setParams(() => taskListToParams(next), { replace: true })
  const rows = result.data?.rows ?? []
  // The list view carries no parent, so parents come from the season's task list the Board already loads. A subtask
  // goes right under its parent when both are on this page; one whose parent is elsewhere keeps its place and says
  // "Part of …". A parent says how many subtasks it has (all of them, not only the ones on this page).
  const seasonTasks = useTasks().data
  const { nestedRows, subtaskCount } = useMemo(() => {
    const all: Entry[] = (seasonTasks ?? []).map((t) => ({ id: t.id, parent_id: t.parent_id, title: t.title }))
    const parentOf = new Map(all.map((t) => [t.id, t.parent_id]))
    const count = new Map<string, number>()
    for (const t of all) if (t.parent_id) count.set(t.parent_id, (count.get(t.parent_id) ?? 0) + 1)
    const entries: Entry[] = rows.map((row) => ({ id: row.id ?? '', parent_id: parentOf.get(row.id ?? '') ?? null, title: row.title ?? '', row }))
    return { nestedRows: nestUnderParents(entries, all), subtaskCount: count }
  }, [rows, seasonTasks])
  const total = result.data?.total ?? 0
  const pages = pageCountFor(total)
  const first = total === 0 ? 0 : (list.page - 1) * TASK_LIST_PAGE_SIZE + 1
  const last = Math.min(total, list.page * TASK_LIST_PAGE_SIZE)
  const filtered = list.q.trim() !== '' || list.department !== 'all' || list.scope !== 'all' || list.state !== 'open'
  const choices = (departments.data ?? []).filter((d) => d.archived_at === null || d.key === list.department)

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader
        title="Tasks"
        description="Every active task in one list. Click a column heading to sort the whole list by it; the search and filters keep the sort."
        tutorialId="tasks-overview"
      />

      <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]" data-testid="tasks-filters">
        <div>
          <label htmlFor="tasks-search" className={LABEL}>
            Search tasks
          </label>
          <input
            id="tasks-search"
            type="search"
            value={list.q}
            onChange={(e) => go(withFilter(list, { q: e.target.value }))}
            placeholder="Title, owner, department or milestone"
            autoComplete="off"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="tasks-department" className={LABEL}>
            Department
          </label>
          <select id="tasks-department" value={list.department} onChange={(e) => go(withFilter(list, { department: e.target.value }))} className={FIELD}>
            <option value="all">All departments</option>
            <option value={NO_DEPARTMENT_FILTER}>No department</option>
            {choices.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tasks-scope" className={LABEL}>
            Whose
          </label>
          <select id="tasks-scope" value={list.scope} onChange={(e) => go(withFilter(list, { scope: e.target.value === 'mine' ? 'mine' : 'all' }))} className={FIELD}>
            <option value="all">Everyone&apos;s</option>
            {myId && <option value="mine">Mine</option>}
          </select>
        </div>
        <div>
          <label htmlFor="tasks-state" className={LABEL}>
            State
          </label>
          <select id="tasks-state" value={list.state} onChange={(e) => go(withFilter(list, { state: e.target.value as TaskStateFilter }))} className={FIELD}>
            {STATE_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="tasks-summary">
        <span>{total === 0 ? 'No tasks' : `Showing ${first}–${last} of ${total} tasks`}</span>
        {filtered && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded font-medium text-slate-900 underline underline-offset-2 sm:min-h-0"
            onClick={() => go({ ...list, q: '', department: 'all', scope: 'all', state: 'open', page: 1 })}
          >
            Clear filters
          </button>
        )}
      </p>

      {result.error ? (
        <ErrorState title="Could not load the task list" error={result.error} onRetry={() => void result.refetch()} />
      ) : result.isPending ? (
        <LoadingState label="Loading the task list…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No tasks match">
          {list.page > 1 ? (
            <>
              This page is past the end of the list.{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => go({ ...list, page: 1 })}>
                Back to the first page
              </button>
            </>
          ) : filtered ? (
            'Nothing matches these filters. Clear them to see every open task.'
          ) : (
            'There are no open tasks in this season.'
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface" data-testid="tasks-table-wrap">
          <table className="block w-full text-left text-sm sm:table" data-testid="tasks-table">
            <thead className="hidden bg-slate-50 sm:table-header-group">
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <HeadingCell key={column} column={column} list={list} onSort={() => go(clickColumn(list, column))} />
                ))}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {nestedRows.map(({ task: entry, nested, partOf }) => {
                const row = entry.row as TaskListRow
                const overdue = row.due_date !== null && row.due_date < today && row.state !== 'done' && row.state !== 'cancelled'
                const subtasks = subtaskCount.get(entry.id) ?? 0
                return (
                  <tr key={row.id} className={`block border-t border-slate-100 px-3 py-2 first:border-t-0 sm:table-row sm:px-0 sm:py-0 ${nested ? 'bg-slate-50' : ''}`} data-testid={`task-row-${row.id}`} data-nested={nested || undefined}>
                    <td className={`block py-0.5 font-medium text-slate-900 sm:table-cell sm:py-2 ${nested ? 'pl-5 sm:pl-10 sm:pr-3' : 'sm:px-3'}`}>
                      <Link to={`/board?task=${encodeURIComponent(row.id ?? '')}`} className="underline-offset-2 hover:underline">
                        {row.title}
                      </Link>
                      {subtasks > 0 && (
                        <span className="block text-xs font-normal text-slate-600" data-testid={`task-subtasks-${row.id}`}>
                          {subtasks} {subtasks === 1 ? 'subtask' : 'subtasks'}
                        </span>
                      )}
                      {partOf && <span className="block text-xs font-normal text-slate-600">Part of {partOf}</span>}
                    </td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{row.department_name ?? <span className="text-slate-500 italic">none</span>}</td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{row.owner_name ?? <span className="text-slate-500 italic">unassigned</span>}</td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{TASK_STATE_LABEL[row.state as TaskState] ?? row.state}</td>
                    <td className="inline-block pr-3 text-xs sm:table-cell sm:px-3 sm:py-2 sm:text-sm">
                      {row.priority === 'urgent' ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">{TASK_PRIORITY_LABEL[row.priority as TaskPriority]}</span> : <span className="text-slate-500">—</span>}
                    </td>
                    <td className={`inline-block pr-3 text-xs sm:table-cell sm:px-3 sm:py-2 sm:text-sm ${overdue ? 'font-medium text-red-800' : 'text-slate-700'}`}>
                      {row.due_date ? <time dateTime={row.due_date}>{formatDay(row.due_date)}</time> : <span className="text-slate-500 italic">no deadline</span>}
                      {overdue && <span className="block text-xs font-normal"> (overdue)</span>}
                    </td>
                    <td className="inline-block text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{row.milestone_name ?? <span className="text-slate-500 italic">none</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-3 flex flex-wrap items-center gap-2" aria-label="Pages" data-testid="tasks-pages">
          <button type="button" className={buttonSecondary} disabled={list.page <= 1} onClick={() => go({ ...list, page: list.page - 1 })}>
            <span aria-hidden="true">←</span> Previous
          </button>
          <span className="text-sm text-slate-700">
            Page {list.page} of {pages}
          </span>
          <button type="button" className={buttonSecondary} disabled={list.page >= pages} onClick={() => go({ ...list, page: list.page + 1 })}>
            Next <span aria-hidden="true">→</span>
          </button>
        </nav>
      )}
    </main>
  )
}

// A column heading is a button: it sorts the whole list by that column. ▲ ascending, ▼ descending,
// a faint triangle on the others says it can be clicked.
function HeadingCell({ column, list, onSort }: { column: SortColumn; list: TaskListParams; onSort: () => void }) {
  const active = list.sort === column
  const direction = active ? (list.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th scope="col" aria-sort={direction} className="px-3 py-2 font-semibold text-slate-700">
      <button
        type="button"
        onClick={onSort}
        className="inline-flex min-h-8 items-center gap-1 rounded text-left hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
        data-testid={`sort-${column}`}
      >
        {COLUMN_LABEL[column]}
        <span aria-hidden="true" className={active ? 'text-slate-900' : 'text-slate-300'}>
          {active ? (list.dir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
        <span className="sr-only">{active ? `, sorted ${direction}. Click to reverse.` : ', click to sort'}</span>
      </button>
    </th>
  )
}
