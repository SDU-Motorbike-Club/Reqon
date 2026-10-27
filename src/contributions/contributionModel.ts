import type { Task } from '../tasks/types.ts'

// One finished task, as the contribution record needs it. Credit goes to the
// task's owner at the time of reading: a task has one owner, and the history of
// who held it is in the activity trail, not here.
export type ContributionTask = Pick<Task, 'id' | 'title' | 'season_id' | 'subteam_key' | 'completed_at' | 'archived_at'>

// The part of a season the grouping needs; a full season row fits.
export type SeasonLabel = { id: string; label: string; is_current: boolean }

export type DepartmentCount = { key: string | null; count: number }
export type SeasonGroup = {
  seasonId: string
  label: string
  isCurrent: boolean
  tasks: ContributionTask[]
  byDepartment: DepartmentCount[]
}

// Finished tasks grouped by season: the current season first, then the rest
// newest label first. Inside a season the most recently finished comes first; a
// task with no completion time (older rows) goes last. A task of a season that
// is not in the list still shows, under a plain label, rather than vanishing.
export function groupBySeason(tasks: readonly ContributionTask[], seasons: readonly SeasonLabel[]): SeasonGroup[] {
  const known = new Map(seasons.map((s) => [s.id, s]))
  const groups = new Map<string, ContributionTask[]>()
  for (const task of tasks) {
    const list = groups.get(task.season_id)
    if (list) list.push(task)
    else groups.set(task.season_id, [task])
  }
  const finished = (t: ContributionTask) => t.completed_at ?? ''
  const result = [...groups].map(([seasonId, list]): SeasonGroup => {
    const sorted = [...list].sort((a, b) => finished(b).localeCompare(finished(a)) || a.id.localeCompare(b.id))
    const counts = new Map<string | null, number>()
    for (const t of sorted) counts.set(t.subteam_key, (counts.get(t.subteam_key) ?? 0) + 1)
    return {
      seasonId,
      label: known.get(seasonId)?.label ?? 'An earlier season',
      isCurrent: known.get(seasonId)?.is_current ?? false,
      tasks: sorted,
      byDepartment: [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || Number(a.key === null) - Number(b.key === null) || String(a.key).localeCompare(String(b.key))),
    }
  })
  return result.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.label.localeCompare(a.label))
}

export const taskCount = (n: number) => (n === 1 ? '1 task' : `${n} tasks`)
