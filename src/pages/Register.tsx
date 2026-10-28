import { PageHeader } from '../ui/PageHeader.tsx'
import { pageMain } from '../ui/layout.ts'
import { ErrorState } from '../ui/states.tsx'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { obligationName } from '../clauses/labels.ts'
import { Link } from 'react-router-dom'
import { canEditTask } from '../auth/permissions.ts'
import { BookReader } from '../book/BookReader.tsx'
import { clausePageTarget, targetHref, targetNote } from '../book/source.ts'
import { useTaskActor } from '../data/useTaskActor.ts'
import { useTasks } from '../data/useTasks.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { AssignContext, type AssignContextValue } from './register/assignContext.ts'
import type { ClauseState } from '../data/useClauseStatus.ts'
import { useClauseStatus, useSetClauseStatus, type ClauseStatusEdit } from '../data/useClauseStatus.ts'
import { useClauses } from '../data/useClauses.ts'
import { useMembers } from '../data/useMembers.ts'
import { useSubteams } from '../data/useSubteams.ts'
import { useRealtimeClauseStatus } from '../data/useRealtimeClauseStatus.ts'
import { useRealtimeTaskRequirements } from '../data/useRealtimeTaskRequirements.ts'
import { useRealtimeTasks } from '../data/useRealtimeTasks.ts'
import { useTaskRequirements, useTasksForProgress } from '../data/useTaskHistory.ts'
import { useSeason } from '../season/context.ts'
import { ClauseRow } from './register/ClauseRow.tsx'
import { indexLinkedWork, linkedWorkFor } from './register/linkedWork.ts'
import {
  applyFilters,
  buildRows,
  DEFAULT_FILTERS,
  GROUPINGS,
  groupRows,
  parseChapterParam,
  type Filters,
  type GroupingId,
  type SubteamInfo,
} from './register/registerModel.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'

// With no search, "Team duties only" is on; a search (often a link to one rule)
// turns it off so the rule is found even if it is a definition.
const impliedDuties = (search: string) => search === ''

export default function Register() {
  const clauses = useClauses()
  const statuses = useClauseStatus()
  const members = useMembers()
  const subteams = useSubteams()
  const setStatus = useSetClauseStatus()
  const realtime = useRealtimeClauseStatus()
  // Linked work: every requirement link and every task summary of the season,
  // read ONCE and joined here — never a query per clause.
  const links = useTaskRequirements()
  const linkedTasks = useTasksForProgress()
  useRealtimeTaskRequirements()
  useRealtimeTasks()
  const season = useSeason()
  // The edition this season reads. A clause's recorded page only counts when
  // the clause belongs to the same edition.
  const seasonRegsRef = season.status === 'ready' ? (season.season.regs_ref ?? null) : null

  // Search, grouping and the rule open in the reader live in the address, so a
  // refresh, the browser's Back button or a shared link keep them. The Now
  // screen links here with ?subteam=GEOM; the Spec sheet with ?search=B.2.1.9
  // (which also switches "Team duties only" off, so the rule is found).
  const [searchParams, setSearchParams] = useUrlParams()
  const subteamParam = searchParams.get('subteam')
  // ?chapter=A (a book section) or ?chapter=A.3 (one of its articles) — the Now
  // screen's requirements progress links here. Book position, not department.
  const chapterScope = parseChapterParam(searchParams.get('chapter'))
  const urlSearch = searchParams.get('search') ?? ''
  const rawGroup = searchParams.get('group')
  const grouping: GroupingId = GROUPINGS.some((g) => g.id === rawGroup) ? (rawGroup as GroupingId) : 'subsystem'
  const setGrouping = (id: GroupingId) =>
    setSearchParams((current) => mergeSearchParams(current, { group: id === 'subsystem' ? null : id }), { replace: true })
  // The other filters live in the address too, so a reload or Back keeps them,
  // and a link can ask for a narrower list (Now's chapter rows send ?unresolved=1).
  // "Team duties only" defaults on, except for a link that arrives with a search
  // (the Spec sheet's ?search=B.2.1.9), where the rule must be found.
  const otherFilters: Omit<Filters, 'search'> = useMemo(
    () => ({
      teamDutiesOnly: searchParams.has('duties') ? searchParams.get('duties') === '1' : impliedDuties(urlSearch),
      unresolvedOnly: searchParams.get('unresolved') === '1',
      obligation: searchParams.get('kind') ?? DEFAULT_FILTERS.obligation,
      owner: searchParams.get('owner') ?? DEFAULT_FILTERS.owner,
    }),
    [searchParams, urlSearch],
  )
  // The box keeps its own value (typing must never wait for the router) and the
  // address follows it. It starts from the address; a link from another screen
  // (Now, the Spec sheet) arrives as a fresh visit, so it is picked up here.
  const [search, setSearch] = useState(urlSearch)
  const filters: Filters = useMemo(() => ({ ...otherFilters, search }), [otherFilters, search])
  const setFilters = (update: (f: Filters) => Filters) => {
    const next = update(filters)
    if (next.search !== search) setSearch(next.search)
    // Every filter written out, each only when it differs from its default, so the
    // address stays short. "Team duties only" is written whenever it differs from
    // what the search alone would imply, so typing a search never flips it.
    setSearchParams(
      (current) =>
        mergeSearchParams(current, {
          search: next.search,
          duties: next.teamDutiesOnly === impliedDuties(next.search) ? null : next.teamDutiesOnly ? '1' : '0',
          unresolved: next.unresolvedOnly ? '1' : null,
          kind: next.obligation !== DEFAULT_FILTERS.obligation ? next.obligation : null,
          owner: next.owner !== DEFAULT_FILTERS.owner ? next.owner : null,
        }),
      { replace: true },
    )
  }

  // The rule open in the Book reader (?rule=<clause_key> — clause_key, never the
  // printed reference, which two different rules can share).
  const readingKey = searchParams.get('rule')
  const [pageTurn, setPageTurn] = useState<{ rule: string; page: number } | null>(null)
  // Opening the reader is its own history step, so Back (the phone's back
  // gesture, where the reader covers the screen) closes it instead of leaving
  // the Register. Moving an already-open reader to another rule replaces it.
  const openBook = useCallback(
    (clauseKey: string) =>
      setSearchParams((current) => mergeSearchParams(current, { rule: clauseKey }), {
        replace: new URLSearchParams(window.location.search).has('rule'),
      }),
    [setSearchParams],
  )
  const closeBook = () => {
    const key = readingKey
    setSearchParams((current) => mergeSearchParams(current, { rule: null }), { replace: true })
    // Back to the rule the reader was opened from.
    if (key) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="book-link-${CSS.escape(key)}"]`)?.focus())
  }
  const readerHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (readingKey) readerHeading.current?.focus()
  }, [readingKey])

  // Linking existing tasks from a rule: the season's active tasks and the same
  // edit rule the Board uses, provided once for every row.
  const tasks = useTasks()
  const actor = useTaskActor()
  const assign: AssignContextValue | null = useMemo(
    () =>
      actor && actor.status === 'active'
        ? { candidates: tasks.data ?? [], canEdit: (task) => canEditTask(actor, { owner_id: task.owner_id, subteam_key: task.subteam_key, archived_at: task.archived_at }) }
        : null,
    [actor, tasks.data],
  )

  const subteamMap = useMemo(() => {
    const map = new Map<string, SubteamInfo>()
    for (const s of subteams.data ?? []) {
      map.set(s.key, { name: s.name, isParked: s.is_parked })
    }
    return map
  }, [subteams.data])

  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.id, m.full_name])),
    [members.data],
  )

  const departmentNames = useMemo(
    () => new Map((subteams.data ?? []).map((s) => [s.key, s.name])),
    [subteams.data],
  )
  const linkIndex = useMemo(
    () => indexLinkedWork(links.data ?? [], linkedTasks.data ?? []),
    [links.data, linkedTasks.data],
  )
  const linkAvailability: 'ready' | 'loading' | 'unavailable' =
    links.error || linkedTasks.error
      ? 'unavailable'
      : links.data && linkedTasks.data
        ? 'ready'
        : 'loading'

  const rows = useMemo(
    () => buildRows(clauses.data ?? [], statuses.data ?? [], subteamMap),
    [clauses.data, statuses.data, subteamMap],
  )
  const chapterSection = chapterScope?.section ?? null
  const chapterArticle = chapterScope?.article ?? null
  const scoped = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!subteamParam || r.clause.subteam_key === subteamParam) &&
          (!chapterSection || (r.clause.section === chapterSection && (chapterArticle === null || r.clause.article === chapterArticle))),
      ),
    [rows, subteamParam, chapterSection, chapterArticle],
  )
  // Re-filtering ~500 rows (each carrying two <select>s) blocked the first
  // keystroke for 133ms, measured in Chrome. The box keeps the typed value
  // immediately; the list re-renders at lower priority a frame later.
  const visibleFilters = useDeferredValue(filters)
  const filtered = useMemo(() => applyFilters(scoped, visibleFilters), [scoped, visibleFilters])
  // The tutorial points at one representative rule — one with a criticality
  // badge when there is one on screen, so the badges get explained too.
  const tutorialRowKey = useMemo(
    () =>
      (
        filtered.find((r) => r.clause.criticality === 'blocking' || r.clause.criticality === 'penalty') ??
        filtered[0]
      )?.clause.clause_key,
    [filtered],
  )
  const groups = useMemo(
    () => groupRows(filtered, grouping, { subteams: subteamMap, memberNames }),
    [filtered, grouping, subteamMap, memberNames],
  )

  const obligations = useMemo(
    () => [...new Set((clauses.data ?? []).map((c) => c.obligation))].sort(),
    [clauses.data],
  )

  // All four writes are the same upsert on (season_id, clause_key) — the real
  // unique key from the schema. Writes go to clause_status; `clauses` is the
  // rulebook and is never edited to record progress.
  // Each save reports back on its own row: "Saved" for a moment, or what went
  // wrong, beside the controls that were changed — not at the top of a long page.
  const [rowNote, setRowNote] = useState<{ key: string; error: string | null } | null>(null)
  const saveStatus = setStatus.mutateAsync
  const saveRow = useCallback(
    (edit: ClauseStatusEdit) => {
      saveStatus(edit).then(
        () => setRowNote({ key: edit.clauseKey, error: null }),
        (e: unknown) => setRowNote({ key: edit.clauseKey, error: e instanceof Error ? e.message : 'That change was not saved.' }),
      )
    },
    [saveStatus],
  )
  useEffect(() => {
    if (!rowNote || rowNote.error) return
    const shown = rowNote
    const timer = setTimeout(() => setRowNote((current) => (current === shown ? null : current)), 2500)
    return () => clearTimeout(timer)
  }, [rowNote])
  const onSetState = useCallback((clauseKey: string, state: ClauseState) => saveRow({ clauseKey, state }), [saveRow])
  const onSetOwner = useCallback((clauseKey: string, ownerId: string | null) => saveRow({ clauseKey, ownerId }), [saveRow])
  const onSetEvidence = useCallback(
    (clauseKey: string, evidence: string) => saveRow({ clauseKey, evidence: evidence || null }),
    [saveRow],
  )
  const onToggleStar = useCallback((clauseKey: string, starred: boolean) => saveRow({ clauseKey, starred }), [saveRow])

  const error = clauses.error ?? statuses.error ?? members.error ?? subteams.error
  if (error) {
    return (
      <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
        <ErrorState
          title="Could not load the register"
          error={error}
          onRetry={() => {
            void clauses.refetch()
            void statuses.refetch()
            void members.refetch()
            void subteams.refetch()
          }}
        />
      </main>
    )
  }

  const loading = clauses.isLoading || statuses.isLoading
  const total = rows.length
  const shown = filtered.length

  // The rule open in the reader, and the page it opens on: its recorded page
  // when that page belongs to this season's edition, else the start (with the
  // reason said), unless the reader has since been paged.
  const reading = readingKey ? rows.find((r) => r.clause.clause_key === readingKey) : undefined
  const readingTarget = reading ? clausePageTarget(reading.clause, seasonRegsRef) : null
  const readerPage =
    reading && pageTurn?.rule === reading.clause.clause_key
      ? pageTurn.page
      : readingTarget?.kind === 'page'
        ? readingTarget.page
        : null

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader
        title="Register"
        description="Every rule in the regulations, and what the team has done about each one."
      >
        <p className="mt-1 text-sm text-slate-600" data-testid="counts" data-tutorial="register-live">
          {loading ? 'Loading the rulebook…' : `${shown} of ${total} rules shown`}
          <span
            className="ml-2 text-xs"
            data-testid="realtime-state"
            title="Live updates from other people editing"
          >
            · live updates: {realtime}
          </span>
        </p>
      </PageHeader>

      {/* Grouping. The same rules, re-filed by the question being asked. */}
      <fieldset className="mb-3" data-tutorial="register-grouping">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          Group by
        </legend>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md border border-slate-300 bg-surface p-0.5">
          {GROUPINGS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={grouping === g.id}
              title={g.hint}
              onClick={() => setGrouping(g.id)}
              className={`min-h-11 rounded px-2.5 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0 ${
                grouping === g.id
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div role="search" aria-label="Find rules" className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4" data-tutorial="register-filters">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="search" className="block text-xs font-medium text-slate-600">
            Search
          </label>
          <input
            id="search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Reference or wording…"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          />
        </div>

        <div>
          <label htmlFor="obligation" className="block text-xs font-medium text-slate-600">
            Kind of work
          </label>
          <select
            id="obligation"
            value={filters.obligation}
            onChange={(e) => setFilters((f) => ({ ...f, obligation: e.target.value }))}
            className="mt-1 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <option value="all">All kinds</option>
            {obligations.map((o) => (
              <option key={o} value={o}>
                {obligationName(o)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="owner" className="block text-xs font-medium text-slate-600">
            Owner
          </label>
          <select
            id="owner"
            value={filters.owner}
            onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
            className="mt-1 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-2 pb-1 sm:col-span-1">
          {/* Visible, not hidden: this default is why the screen is usable. */}
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={filters.teamDutiesOnly}
              onChange={(e) =>
                setFilters((f) => ({ ...f, teamDutiesOnly: e.target.checked }))
              }
              className="h-5 w-5 accent-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            />
            Team duties only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={filters.unresolvedOnly}
              onChange={(e) =>
                setFilters((f) => ({ ...f, unresolvedOnly: e.target.checked }))
              }
              className="h-5 w-5 accent-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            />
            Unresolved only
          </label>
        </div>
      </div>

      {chapterScope && (
        <p className="mb-3 flex items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <span data-testid="chapter-scope">
            Showing <strong>Section {chapterScope.section}{chapterScope.article !== null ? `, Article ${chapterScope.article}` : ''}</strong> only
          </span>
          <button
            type="button"
            onClick={() => setSearchParams((current) => mergeSearchParams(current, { chapter: null }), { replace: true })}
            className="rounded border border-slate-300 bg-surface px-2 py-0.5 text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            Clear
          </button>
        </p>
      )}
      {subteamParam && (
        <p className="mb-3 flex items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <span data-testid="subteam-scope">
            Showing <strong>{subteamMap.get(subteamParam)?.name ?? subteamParam}</strong> only
          </span>
          <button
            type="button"
            onClick={() => setSearchParams((current) => mergeSearchParams(current, { subteam: null }), { replace: true })}
            className="rounded border border-slate-300 bg-surface px-2 py-0.5 text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            Clear
          </button>
        </p>
      )}


      {!loading && shown === 0 && (
        <p className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
          No rules match these filters. Try clearing the search, or switch off
          “Team duties only” to see definitions and the Organization's own powers.
        </p>
      )}

      <AssignContext.Provider value={assign}>
      <div className={reading ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(26rem,42%)] lg:items-start lg:gap-4' : undefined}>
      <div className="min-w-0">
      <div id="register-list">
        {groups.map((group) => (
          <section key={group.key} className="mb-5">
            <h2 className="sticky top-0 z-10 border-b border-slate-300 bg-surface py-1.5 text-sm font-semibold text-slate-900">
              {group.label}{' '}
              <span className="font-normal text-slate-500">({group.rows.length})</span>
            </h2>
            <ul>
              {group.rows.map((row) => (
                <ClauseRow
                  key={row.clause.clause_key}
                  tutorialId={row.clause.clause_key === tutorialRowKey ? 'register-row' : undefined}
                  row={row}
                  members={members.data ?? []}
                  onSetState={onSetState}
                  onSetOwner={onSetOwner}
                  onSetEvidence={onSetEvidence}
                  onToggleStar={onToggleStar}
                  work={linkedWorkFor(linkIndex, row.clause.clause_key)}
                  linkAvailability={linkAvailability}
                  seasonRegsRef={seasonRegsRef}
                  memberNames={memberNames}
                  departmentNames={departmentNames}
                  onOpenBook={openBook}
                  reading={row.clause.clause_key === readingKey}
                  saved={rowNote?.key === row.clause.clause_key && rowNote.error === null}
                  saveError={rowNote?.key === row.clause.clause_key ? rowNote.error : null}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      </div>

      {reading && (
        <aside
          aria-labelledby="register-reader-heading"
          data-testid="register-reader"
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeBook()
          }}
          className="register-reader fixed inset-0 z-50 overflow-auto overscroll-contain bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:sticky lg:top-2 lg:z-auto lg:max-h-[calc(100dvh-1rem)] lg:rounded-lg lg:border lg:border-slate-300 lg:pt-3 lg:shadow-sm"
        >
          {/* Stays on screen while the page is scrolled, so Close is always in reach. */}
          <div className="sticky top-0 z-10 -mx-3 mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 lg:static lg:mx-0 lg:border-0 lg:p-0">
            <h2 id="register-reader-heading" ref={readerHeading} tabIndex={-1} className="text-base font-semibold text-slate-900 focus:outline-none">
              Requirements Book · <span className="font-mono">{reading.clause.printed_ref}</span>
            </h2>
            <div className="flex items-center gap-2">
              <Link to={targetHref((readingTarget ?? { kind: "unrecorded" as const }), reading.clause.printed_ref)} className="text-xs underline underline-offset-2">
                Open full screen
              </Link>
              <button type="button" onClick={closeBook} className="min-h-11 rounded border border-slate-300 bg-surface px-3 py-1 text-sm font-medium hover:bg-slate-100 sm:min-h-0" data-testid="register-reader-close">
                Close the book
              </button>
            </div>
          </div>
          <p className="mb-2 text-xs text-slate-600">{reading.clause.body.slice(0, 220)}{reading.clause.body.length > 220 ? '…' : ''}</p>
          <BookReader
            compact
            page={readerPage}
            ruleRef={reading.clause.printed_ref}
            note={targetNote((readingTarget ?? { kind: "unrecorded" as const }))}
            onPageChange={(page) => setPageTurn({ rule: reading.clause.clause_key, page })}
          />
        </aside>
      )}
      </div>
      </AssignContext.Provider>
    </main>
  )
}
