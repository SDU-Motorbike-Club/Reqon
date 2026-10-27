import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { useTaskList } from '../data/useTaskList.ts'
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
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-600'

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

      <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]" data-testid="tasks-filters">
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
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-testid="tasks-table-wrap">
          <table className="block w-full text-left text-sm sm:table" data-testid="tasks-table">
            <thead className="hidden bg-slate-50 sm:table-header-group">
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <HeadingCell key={column} column={column} list={list} onSort={() => go(clickColumn(list, column))} />
                ))}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {rows.map((row) => {
                const overdue = row.due_date !== null && row.due_date < today && row.state !== 'done' && row.state !== 'cancelled'
                return (
                  <tr key={row.id} className="block border-t border-slate-100 px-3 py-2 first:border-t-0 sm:table-row sm:px-0 sm:py-0" data-testid={`task-row-${row.id}`}>
                    <td className="block py-0.5 font-medium text-slate-900 sm:table-cell sm:px-3 sm:py-2">
                      <Link to={`/board?task=${encodeURIComponent(row.id ?? '')}`} className="underline-offset-2 hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{row.department_name ?? <span className="text-slate-500 italic">none</span>}</td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{row.owner_name ?? <span className="text-slate-500 italic">unassigned</span>}</td>
                    <td className="inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm">{TASK_STATE_LABEL[row.state as TaskState] ?? row.state}</td>
                    <td className="inline-block pr-3 text-xs sm:table-cell sm:px-3 sm:py-2 sm:text-sm">
                      {row.priority === 'urgent' ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">{TASK_PRIORITY_LABEL[row.priority as TaskPriority]}</span> : <span className="text-slate-500">—</span>}
                    </td>
                    <td className={`inline-block pr-3 text-xs sm:table-cell sm:px-3 sm:py-2 sm:text-sm ${overdue ? 'font-medium text-red-800' : 'text-slate-700'}`}>
                      {row.due_date ? <time dateTime={row.due_date}>{formatDay(row.due_date)}</time> : <span className="text-slate-500 italic">no deadline</span>}
                      {overdue && <span className="sr-only"> (overdue)</span>}
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
        className="inline-flex min-h-8 items-center gap-1 rounded text-left hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
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
