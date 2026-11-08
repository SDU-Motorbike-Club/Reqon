import type { Task } from './types.ts'

type Node = Pick<Task, 'id' | 'parent_id'>

/**
 * What the Board shows as cards: parent tasks with their subtasks tucked underneath.
 *
 * - `flat` (the "My tasks" scope) shows every matching task as its own card, no nesting.
 * - Otherwise a task that passes the filters and has a parent is shown under that parent, and
 *   the parent is pulled in even when it fails the filters itself, so a filter never hides a match.
 * - A subtask whose parent is not among `all` (not loaded) stays a card of its own.
 * - `childrenOf` lists ALL of a parent's subtasks, not just the matching ones: opening a broad task
 *   shows its whole breakdown.
 */
export function groupBoardTasks<T extends Node>(
  visible: readonly T[],
  all: readonly T[],
  flat: boolean,
): { tops: T[]; childrenOf: Map<string, T[]> } {
  if (flat) return { tops: [...visible], childrenOf: new Map() }
  const byId = new Map(all.map((t) => [t.id, t]))
  const childrenOf = new Map<string, T[]>()
  for (const t of all) {
    if (t.parent_id && byId.has(t.parent_id)) childrenOf.set(t.parent_id, [...(childrenOf.get(t.parent_id) ?? []), t])
  }
  const seen = new Set<string>()
  const tops: T[] = []
  for (const t of visible) {
    const top = (t.parent_id && byId.get(t.parent_id)) || t
    if (!seen.has(top.id)) {
      seen.add(top.id)
      tops.push(top)
    }
  }
  return { tops, childrenOf }
}

/**
 * The order a Gantt group lists its tasks in: a subtask goes right under its parent when both are in the group.
 * A subtask whose parent is somewhere else (another section, or filtered out) keeps its place and carries the
 * parent's title as `partOf`, so the link is never lost. Placement is per task, so this never moves anything.
 */
export function nestUnderParents<T extends Node & { title: string }>(
  group: readonly T[],
  all: readonly T[],
): { task: T; nested: boolean; partOf: string | null }[] {
  const here = new Set(group.map((t) => t.id))
  const byId = new Map(all.map((t) => [t.id, t]))
  const kids = new Map<string, T[]>()
  for (const t of group) if (t.parent_id && here.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t])
  const out: { task: T; nested: boolean; partOf: string | null }[] = []
  for (const t of group) {
    if (t.parent_id && here.has(t.parent_id)) continue
    out.push({ task: t, nested: false, partOf: t.parent_id ? (byId.get(t.parent_id)?.title ?? null) : null })
    for (const child of kids.get(t.id) ?? []) out.push({ task: child, nested: true, partOf: null })
  }
  return out
}

/** The card a task appears under: its parent's id when it is nested, otherwise its own. */
export function topLevelId<T extends Node>(id: string | null, all: readonly T[], flat: boolean): string | null {
  if (!id || flat) return id
  const parent = all.find((t) => t.id === id)?.parent_id
  return parent && all.some((t) => t.id === parent) ? parent : id
}
