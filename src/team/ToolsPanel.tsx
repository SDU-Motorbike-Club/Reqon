import { useId, useState, type FormEvent } from 'react'
import { useRemoveTool, useAddTool, useUpdateTool, type Tool } from '../data/useTeam.ts'
import { buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { ActionError, EmptyState } from '../ui/states.tsx'
import { TOOL_LOCATION_LABEL, TOOL_LOCATIONS, groupByOwner, holderText, isToolLocation, type ToolLocation } from './toolModel.ts'

const FIELD =
  'mt-1 min-h-11 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 sm:min-h-0'
const LABEL = 'block text-xs font-medium text-slate-600'

// What the club owns or can borrow. Each tool says three separate things: whose it is (never changes),
// WHERE it is, and WHO HAS IT right now (a member, or nobody: it just sits where it is). Everyone reads it.
// The owner, an administrator or whoever has a tool changes where it is and who has it; anyone else may
// take a tool nobody has ("I have it"). Only the owner or an administrator renames or removes it. The
// database decides all of this: a refused change comes back as an error, never as success.
export function ToolsPanel({
  tools,
  names,
  me,
  canWrite,
  isAdmin,
  roster,
}: {
  tools: readonly Tool[]
  names: ReadonlyMap<string, string>
  me: string | undefined
  canWrite: boolean
  isAdmin: boolean
  roster: readonly { id: string; full_name: string }[]
}) {
  const id = useId()
  const add = useAddTool()
  const update = useUpdateTool()
  const remove = useRemoveTool()
  const [item, setItem] = useState('')
  const [location, setLocation] = useState<ToolLocation>('workshop')
  const [heldBy, setHeldBy] = useState('')
  const [owner, setOwner] = useState('')
  const [problem, setProblem] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const groups = groupByOwner(tools, names, me)
  const isOwnerOrAdmin = (t: Tool) => canWrite && (t.owner_id === me || isAdmin)
  // The owner, an admin or whoever has it may change where it is and who has it.
  const mayMove = (t: Tool) => isOwnerOrAdmin(t) || (canWrite && t.held_by !== null && t.held_by === me)
  // Me first, so "I have it" is one pick.
  const people = [...roster.filter((m) => m.id === me), ...roster.filter((m) => m.id !== me)]

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
      await add.mutateAsync({ item: item.trim(), location, heldBy: heldBy || null, ...(isAdmin && owner ? { ownerId: owner } : {}) })
      setItem('')
      setLocation('workshop')
      setHeldBy('')
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
      <h2 id={`${id}-heading`} className="text-sm font-semibold text-slate-900">
        Tools
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">Whose it is, where it is, and who has it right now. Update yours when it moves.</p>

      {canWrite && (
        <form onSubmit={submit} noValidate className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end" aria-label="Add a tool">
          <div className="sm:col-span-2 lg:col-span-1">
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
          <div>
            <label className={LABEL} htmlFor={`${id}-who`}>
              Who has it
            </label>
            <select id={`${id}-who`} value={heldBy} onChange={(e) => setHeldBy(e.target.value)} className={FIELD}>
              {whoOptions}
            </select>
          </div>
          {isAdmin && (
            <div>
              <label className={LABEL} htmlFor={`${id}-owner`}>
                Whose it is
              </label>
              <select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD}>
                <option value="">Mine</option>
                {roster.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className={buttonPrimary} disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add tool'}
          </button>
        </form>
      )}
      <ActionError error={add.error ?? update.error ?? remove.error} className="mt-2" />

      <div className="mt-3">
        {groups.length === 0 ? (
          <EmptyState title="No tools listed yet">{canWrite ? 'Add the first one above.' : 'When members list their tools, they appear here.'}</EmptyState>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.ownerId} data-testid={`tools-${group.ownerId}`}>
                <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">{group.ownerId === me ? 'Yours' : group.name}</h3>
                <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {group.tools.map((tool) => {
                    const place = isToolLocation(tool.location) ? tool.location : 'other'
                    return (
                      <li key={tool.id} className="px-3 py-2 text-sm" data-testid={`tool-${tool.id}`}>
                        <p className="font-medium text-slate-900">{tool.item}</p>
                        <p className="mt-0.5 text-xs text-slate-700" data-testid={`tool-facts-${tool.id}`}>
                          Where: <span className="font-medium">{TOOL_LOCATION_LABEL[place]}</span> · Who has it:{' '}
                          <span className="font-medium">{holderText(tool.held_by, names, me)}</span>
                        </p>
                        {(mayMove(tool) || (canWrite && tool.held_by === null)) && (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            {mayMove(tool) && (
                              <>
                                <div>
                                  <label className="block text-xs text-slate-600" htmlFor={`${id}-w-${tool.id}`}>
                                    Where is {tool.item}
                                  </label>
                                  <select
                                    id={`${id}-w-${tool.id}`}
                                    value={place}
                                    disabled={update.isPending}
                                    onChange={(e) => isToolLocation(e.target.value) && update.mutate({ id: tool.id, location: e.target.value })}
                                    className="min-h-11 rounded border border-slate-300 bg-white px-2 py-1 text-sm sm:min-h-0"
                                  >
                                    {TOOL_LOCATIONS.map((l) => (
                                      <option key={l} value={l}>
                                        {TOOL_LOCATION_LABEL[l]}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-600" htmlFor={`${id}-h-${tool.id}`}>
                                    Who has {tool.item}
                                  </label>
                                  <select
                                    id={`${id}-h-${tool.id}`}
                                    value={tool.held_by ?? ''}
                                    disabled={update.isPending}
                                    onChange={(e) => update.mutate({ id: tool.id, heldBy: e.target.value || null })}
                                    className="min-h-11 rounded border border-slate-300 bg-white px-2 py-1 text-sm sm:min-h-0"
                                  >
                                    {whoOptions}
                                  </select>
                                </div>
                              </>
                            )}
                            {canWrite && tool.held_by === null && me && (
                              <button type="button" className={buttonSecondary} disabled={update.isPending} onClick={() => update.mutate({ id: tool.id, heldBy: me })}>
                                I have it
                              </button>
                            )}
                            {isOwnerOrAdmin(tool) &&
                              (removing === tool.id ? (
                                <button type="button" className={buttonSecondary} disabled={remove.isPending} onClick={() => remove.mutate(tool.id, { onSettled: () => setRemoving(null) })}>
                                  Remove {tool.item}?
                                </button>
                              ) : (
                                <button type="button" className={buttonSecondary} aria-label={`Remove ${tool.item}`} onClick={() => setRemoving(tool.id)}>
                                  Remove
                                </button>
                              ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
