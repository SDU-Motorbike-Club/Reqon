import type { Task } from './types.ts'

// Everybody a task is assigned to, by task id (task_assignees, 20260165000000). The lead is tasks.owner_id.
export type AssigneesByTask = ReadonlyMap<string, readonly string[]>

export function groupAssignees(rows: readonly { task_id: string; member_id: string }[]): Map<string, string[]> {
  const byTask = new Map<string, string[]>()
  for (const r of rows) byTask.set(r.task_id, [...(byTask.get(r.task_id) ?? []), r.member_id])
  return byTask
}

// The lead first, then the others in the order they were stored. The lead is always included, so a screen
// that has not loaded the assignees yet still shows the owner.
export function assigneeIds(task: Pick<Task, 'id' | 'owner_id'>, byTask: AssigneesByTask | undefined): string[] {
  const others = (byTask?.get(task.id) ?? []).filter((id) => id !== task.owner_id)
  return task.owner_id ? [task.owner_id, ...others] : others
}

export function isAssignee(task: Pick<Task, 'id' | 'owner_id'>, memberId: string | null | undefined, byTask: AssigneesByTask | undefined): boolean {
  return Boolean(memberId) && assigneeIds(task, byTask).includes(memberId as string)
}

export function sameAssignees(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}
