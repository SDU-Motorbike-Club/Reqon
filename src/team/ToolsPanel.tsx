import { useId, useMemo, useState, type FormEvent } from 'react'
import { useRemoveTool, useAddTool, useUpdateTool, type Tool } from '../data/useTeam.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { ActionError, EmptyState } from '../ui/states.tsx'
import {
  CLUB_TOOL_LABEL,
  TOOL_LOCATION_LABEL,
  TOOL_LOCATIONS,
  groupByLocation,
  holderText,
  isToolLocation,
  toolKindLabel,
  toolMatches,
  type ToolLocation,
} from './toolModel.ts'

const FIELD =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-600'
const CELL = 'inline-block pr-3 text-xs text-slate-700 sm:table-cell sm:px-3 sm:py-2 sm:text-sm'

// The club's tools, read by place: a list grouped under the workshop, home, the university and so on, laid out like
// the Tasks list. Everyone sees where each tool is. Each tool is either its owner's own or a club tool, chosen when
// it is listed. Any full member can rename, move or hand on any tool (a member on trial only reads); the owner or an
// administrator removes it. The database decides all of this: a refused change comes back as an
// error, never as success.
export function ToolsPanel({
  tools,
  names,
  me,
  canWrite,
  canModify,
  isAdmin,
  roster,
}: {
  tools: readonly Tool[]
  names: ReadonlyMap<string, string>
  me: string | undefined
  canWrite: boolean
  // Every active member may change any tool (name, place, who has it); a member on trial may not.
  canModify: boolean
  isAdmin: boolean
  roster: readonly { id: string; full_name: string }[]
}) {
  const id = useId()
  const add = useAddTool()
  const update = useUpdateTool()
  const remove = useRemoveTool()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [item, setItem] = useState('')
  const [location, setLocation] = useState<ToolLocation>('workshop')
  const [kind, setKind] = useState<'own' | 'club'>('own')
  const [owner, setOwner] = useState('')
  const [problem, setProblem] = useState('')
  const [removing, setRemoving] = useState(false)

  const isOwnerOrAdmin = (t: Tool) => canWrite && (t.owner_id === me || isAdmin)
  // Me first, so "I have it" is one pick.
  const people = [...roster.filter((m) => m.id === me), ...roster.filter((m) => m.id !== me)]
  const groups = useMemo(() => groupByLocation(tools.filter((t) => toolMatches(t, query, names))), [tools, query, names])
  const editing = editingId ? (tools.find((t) => t.id === editingId) ?? null) : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (add.isPending) return
    if (item.trim() === '') {
      setProblem('Name the tool.')
      document.getElementById(`${id}-item`)?.focus()
      return
    }
    setProblem('')
    try {
      await add.mutateAsync({
        item: item.trim(),
        location,
        heldBy: null,
        ...(kind === 'club' ? { shared: true } : {}),
        ...(isAdmin && owner ? { ownerId: owner } : {}),
      })
      setItem('')
      setLocation('workshop')
      setKind('own')
      setOwner('')
      setAdding(false)
    } catch {
      // Shown by ActionError; what was typed stays.
    }
  }

  const whoOptions = (
    <>
      <option value="">Nobody (it just sits there)</option>
      {people.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id === me ? `Me (${m.full_name})` : m.full_name}
        </option>
      ))}
    </>
  )

  return (
    <section aria-labelledby={`${id}-heading`} data-tutorial="team-tools">
      <h2 id={`${id}-heading`} className="sr-only">
        Tools
      </h2>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <label className="sr-only" htmlFor={`${id}-find`}>
            Find a tool
          </label>
          <input
            id={`${id}-find`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a tool, a person or a place"
            className="min-h-11 w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0"
          />
        </div>
        {canWrite && (
          <button type="button" className={buttonPrimary} onClick={() => setAdding(true)} data-testid="tools-add-open">
            Add a tool
          </button>
        )}
      </div>
      <ActionError error={add.error ?? update.error ?? remove.error} className="mb-2" />

      {tools.length === 0 ? (
        <EmptyState title="No tools listed yet">{canWrite ? 'Choose “Add a tool” to list the first one.' : 'When members list their tools, they appear here.'}</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState title="No tool matches">Try another word.</EmptyState>
      ) : (
        <div className="space-y-3" data-testid="tools-list">
          {groups.map((group) => (
            <details key={group.location} open className="group rounded-lg border border-slate-200 bg-surface" data-testid={`tools-at-${group.location}`}>
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring">
                <span aria-hidden="true" className="w-3 text-slate-500 group-open:hidden">
                  ▸
                </span>
                <span aria-hidden="true" className="hidden w-3 text-slate-500 group-open:inline">
                  ▾
                </span>
                {TOOL_LOCATION_LABEL[group.location]} <span className="font-normal text-slate-500">({group.tools.length})</span>
              </summary>
              <table className="block w-full text-left text-sm sm:table sm:table-fixed">
                <thead className="hidden border-t border-slate-100 bg-slate-50 sm:table-header-group">
                  <tr className="text-xs text-slate-600">
                    <th scope="col" className="w-[40%] px-3 py-1.5 font-medium">
                      Tool
                    </th>
                    <th scope="col" className="w-[20%] px-3 py-1.5 font-medium">
                      Whose
                    </th>
                    <th scope="col" className="w-[18%] px-3 py-1.5 font-medium">
                      Who has it
                    </th>
                    <th scope="col" className="px-3 py-1.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {group.tools.map((tool) => (
                    <tr key={tool.id} className="block border-t border-slate-100 px-3 py-2 sm:table-row sm:px-0 sm:py-0" data-testid={`tool-${tool.id}`}>
                      <td className="block py-0.5 font-medium break-words text-slate-900 sm:table-cell sm:px-3 sm:py-2">{tool.item}</td>
                      <td className={CELL}>
                        {tool.shared ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">{CLUB_TOOL_LABEL}</span>
                        ) : (
                          toolKindLabel(tool, names, me)
                        )}
                      </td>
                      <td className={CELL} data-testid={`tool-holder-${tool.id}`}>
                        {tool.held_by === null ? <span className="text-slate-500 italic">nobody</span> : holderText(tool.held_by, names, me)}
                      </td>
                      <td className="inline-block text-xs sm:table-cell sm:px-3 sm:py-2 sm:text-right sm:text-sm">
                        <span className="inline-flex flex-wrap items-center justify-end gap-2">
                          {canModify && tool.held_by === null && me && (
                            <button type="button" className={buttonSecondary} disabled={update.isPending} onClick={() => update.mutate({ id: tool.id, heldBy: me })}>
                              I have it
                            </button>
                          )}
                          {canModify && tool.held_by === me && (
                            <button type="button" className={buttonSecondary} disabled={update.isPending} onClick={() => update.mutate({ id: tool.id, heldBy: null })}>
                              Give back
                            </button>
                          )}
                          {canModify && (
                            <button
                              type="button"
                              className={buttonSecondary}
                              aria-label={`Edit ${tool.item}`}
                              onClick={() => {
                                setRemoving(false)
                                setEditingId(tool.id)
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} labelledBy={`${id}-add-title`} dismissible={!add.isPending}>
        <form onSubmit={submit} noValidate aria-label="Add a tool">
          <h2 id={`${id}-add-title`} className="text-base font-semibold text-slate-900">
            Add a tool
          </h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className={LABEL} htmlFor={`${id}-item`}>
                Tool
              </label>
              <input
                id={`${id}-item`}
                value={item}
                maxLength={120}
                onChange={(e) => setItem(e.target.value)}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${id}-problem` : undefined}
                placeholder="Torque wrench 3/8"
                className={FIELD}
              />
              {problem && (
                <p id={`${id}-problem`} className="mt-1 text-xs text-red-700">
                  {problem}
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor={`${id}-kind`}>
                  Whose tool is it
                </label>
                <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value === 'club' ? 'club' : 'own')} className={FIELD}>
                  <option value="own">My own tool</option>
                  <option value="club">{CLUB_TOOL_LABEL} (the club’s, for everyone)</option>
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor={`${id}-where`}>
                  Where it is
                </label>
                <select id={`${id}-where`} value={location} onChange={(e) => isToolLocation(e.target.value) && setLocation(e.target.value)} className={FIELD}>
                  {TOOL_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {TOOL_LOCATION_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {isAdmin && (
              <div>
                <label className={LABEL} htmlFor={`${id}-owner`}>
                  List it for
                </label>
                <select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD}>
                  <option value="">Me</option>
                  {roster.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <ActionError error={add.error} className="mt-3" />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonSecondary} disabled={add.isPending} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary} disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add tool'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditingId(null)} labelledBy={`${id}-edit-title`} size="side">
        {editing && (
          <div data-testid={`tool-sheet-${editing.id}`}>
            <h2 id={`${id}-edit-title`} className="text-base font-semibold break-words text-slate-900">
              {editing.item}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {toolKindLabel(editing, names, me)}. Changes save as you make them.
            </p>
            <div className="mt-4 space-y-3">
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const next = (new FormData(e.currentTarget).get('name') as string).trim()
                  if (next !== '' && next !== editing.item) update.mutate({ id: editing.id, item: next })
                }}
              >
                <div className="flex-1">
                  <label className={LABEL} htmlFor={`${id}-n-${editing.id}`}>
                    Name
                  </label>
                  <input id={`${id}-n-${editing.id}`} name="name" key={editing.item} defaultValue={editing.item} maxLength={120} className={FIELD} />
                </div>
                <button type="submit" className={buttonSecondary} disabled={update.isPending}>
                  Save name
                </button>
              </form>
              <div>
                <label className={LABEL} htmlFor={`${id}-w-${editing.id}`}>
                  Where is {editing.item}
                </label>
                <select
                  id={`${id}-w-${editing.id}`}
                  value={isToolLocation(editing.location) ? editing.location : 'other'}
                  disabled={update.isPending}
                  onChange={(e) => isToolLocation(e.target.value) && update.mutate({ id: editing.id, location: e.target.value })}
                  className={FIELD}
                >
                  {TOOL_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {TOOL_LOCATION_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor={`${id}-h-${editing.id}`}>
                  Who has {editing.item}
                </label>
                <p className="mt-0.5 text-xs text-slate-500">Pick someone else to hand it to them, for example a member who cannot change tools yet.</p>
                <select
                  id={`${id}-h-${editing.id}`}
                  value={editing.held_by ?? ''}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ id: editing.id, heldBy: e.target.value || null })}
                  className={FIELD}
                >
                  {whoOptions}
                </select>
              </div>
            </div>
            <ActionError error={update.error ?? remove.error} className="mt-3" />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              {isOwnerOrAdmin(editing) ? (
                removing ? (
                  <button
                    type="button"
                    className={buttonSecondary}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(editing.id, { onSuccess: () => setEditingId(null), onSettled: () => setRemoving(false) })}
                  >
                    Remove {editing.item}?
                  </button>
                ) : (
                  <button type="button" className={buttonSecondary} aria-label={`Remove ${editing.item}`} onClick={() => setRemoving(true)}>
                    Remove
                  </button>
                )
              ) : (
                <span />
              )}
              <button type="button" className={buttonPrimary} onClick={() => setEditingId(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  )
}
