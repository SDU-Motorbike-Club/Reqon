// The order of the Settings sections for ONE person: the ones they use most first, inside two fixed groups.
//
// Rules, in this order, per group:
//   1. the pinned section (Your account) is always first in its group;
//   2. a section that needs attention (a failing backup) comes next;
//   3. then by how much the person uses it, newest habits counting more (a score that halves every 30 days);
//   4. ties, and everything for someone with no habits yet, fall back to the fixed default order (rank).
// Sections the person may not see are simply not passed in. A section never moves to the other group, so the
// page keeps its two headings in a place people can learn.

export type SectionGroup = 'personal' | 'admin'
export type SectionMeta = { id: string; group: SectionGroup; rank: number }
export type UsageEntry = { score: number; scoredAt: string }

export const HALF_LIFE_DAYS = 30

export function decayedScore(entry: UsageEntry | undefined, now: Date): number {
  if (!entry) return 0
  const then = Date.parse(entry.scoredAt)
  if (!Number.isFinite(then) || !Number.isFinite(entry.score)) return 0
  const days = Math.max(0, (now.getTime() - then) / 86_400_000)
  return entry.score * Math.pow(0.5, days / HALF_LIFE_DAYS)
}

export function orderSections(
  sections: readonly SectionMeta[],
  // null = not known (loading, or it failed): the fixed order.
  usage: ReadonlyMap<string, UsageEntry> | null,
  now: Date,
  attention: ReadonlySet<string> = new Set(),
  pinned: string | null = null,
): Record<SectionGroup, SectionMeta[]> {
  const out: Record<SectionGroup, SectionMeta[]> = { personal: [], admin: [] }
  const score = (id: string) => (usage ? decayedScore(usage.get(id), now) : 0)
  const tier = (id: string) => (id === pinned ? 0 : attention.has(id) ? 1 : 2)
  for (const group of ['personal', 'admin'] as const) {
    out[group] = sections
      .filter((s) => s.group === group)
      .slice()
      .sort((a, b) => tier(a.id) - tier(b.id) || score(b.id) - score(a.id) || a.rank - b.rank)
  }
  return out
}
