// How many cards a lane shows before "Show more". A lane of 66 is not a board.
export const LANE_PAGE = 10

// What a lane shows: its first `limit` cards, plus the one card that must stay in
// view (the task a link opened, or the one whose details are open) even beyond that.
export function laneWindow<T extends { id: string }>(laneTasks: readonly T[], limit: number, keepId: string | null): { shown: T[]; hidden: number } {
  const shown = laneTasks.slice(0, limit)
  const kept = keepId ? laneTasks.find((t) => t.id === keepId) : undefined
  if (kept && !shown.includes(kept)) shown.push(kept)
  return { shown, hidden: laneTasks.length - shown.length }
}
