import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/context.ts'
import { groupBySeason, taskCount } from '../contributions/contributionModel.ts'
import { useContributions } from '../data/useContributions.ts'
import { useMembers } from '../data/useMembers.ts'
import { useSeasons } from '../data/useSeasons.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { formatInstantDay } from '../lib/dates.ts'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

const FIELD =
  'mt-1 min-h-11 w-full max-w-sm rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 sm:min-h-0'

// What a member has finished, across every season: the tasks they own that are
// done. Read-only and built from the tasks themselves, so it never disagrees
// with the Board or the Archive. Credit follows the task's current owner, and a
// cancelled task is not a contribution. Former members keep their record: it is
// the work they left behind.
export default function Contributions() {
  const auth = useAuth()
  const me = auth.status === 'member' ? auth.member.id : undefined
  const [search, setSearch] = useSearchParams()
  const members = useMembers()
  const seasons = useSeasons()
  const departments = useSubteams()

  const roster = useMemo(() => [...(members.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name)), [members.data])
  // A name in the address that is not on the roster falls back to yourself.
  const asked = search.get('member')
  const memberId = asked && roster.some((m) => m.id === asked) ? asked : me
  const person = roster.find((m) => m.id === memberId)
  const record = useContributions(memberId)

  const tasks = record.data
  const groups = useMemo(() => groupBySeason(tasks ?? [], seasons.data ?? []), [tasks, seasons.data])
  const deptName = (key: string | null) => (key ? (departments.data?.find((d) => d.key === key)?.name ?? key) : 'No department')
  const error = record.error ?? members.error ?? seasons.error
  const total = tasks?.length ?? 0

  const pick = (id: string) => setSearch(id === me ? {} : { member: id }, { replace: true })

  return (
    <main id="main-content" tabIndex={-1} className={pageMain()}>
      <PageHeader
        title="Contributions"
        description="The tasks a member has finished, season by season."
        tutorialId="contributions-overview"
      />

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="contribution-member">
          Whose record
        </label>
        <select
          id="contribution-member"
          className={FIELD}
          value={memberId ?? ''}
          disabled={roster.length === 0}
          onChange={(e) => pick(e.target.value)}
        >
          {roster.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
              {m.id === me ? ' (you)' : ''}
              {m.status === 'alumni' ? ' (former member)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4" aria-live="polite">
        {error ? (
          <ErrorState title="Could not load the contribution record" error={error} onRetry={() => void record.refetch()} />
        ) : !tasks || members.isPending ? (
          <LoadingState label="Loading the contribution record…" />
        ) : total === 0 ? (
          <EmptyState title="No finished tasks yet">
            {person && person.id === me
              ? 'Tasks you finish appear here, in the season they were done.'
              : `${person?.full_name ?? 'This member'} has not finished a task that they own.`}
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-slate-800" data-testid="contribution-summary">
              {person?.full_name ?? 'This member'} finished {taskCount(total)}
              {groups.length > 1 ? ` across ${groups.length} seasons` : ''}.
            </p>
            <div className="mt-3 space-y-5">
              {groups.map((group) => (
                <section key={group.seasonId} aria-labelledby={`season-${group.seasonId}`} data-testid={`season-${group.seasonId}`}>
                  <h2 id={`season-${group.seasonId}`} className="text-sm font-semibold text-slate-900">
                    {group.label}
                    {group.isCurrent ? ' (current)' : ''} · {taskCount(group.tasks.length)}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {group.byDepartment.map((d) => `${deptName(d.key)} ${d.count}`).join(' · ')}
                  </p>
                  <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {group.tasks.map((task) => (
                      <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                        <span className="min-w-0 text-slate-900">
                          {group.isCurrent ? (
                            <Link
                              to={task.archived_at ? `/archive?tab=tasks&id=${encodeURIComponent(task.id)}` : `/board?task=${encodeURIComponent(task.id)}`}
                              className="underline underline-offset-2"
                            >
                              {task.title}
                            </Link>
                          ) : (
                            task.title
                          )}
                        </span>
                        <span className="text-xs text-slate-600">
                          {deptName(task.subteam_key)}
                          {task.completed_at ? ` · ${formatInstantDay(task.completed_at)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
