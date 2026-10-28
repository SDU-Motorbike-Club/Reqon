import { useState } from 'react'
import type { MilestoneSection } from '../../data/useMilestones.ts'
import type { Task } from '../../data/useTasks.ts'
import { ROW, STICKY_LABEL, Track } from './GanttChart.tsx'
import { taskDropHandlers } from './ganttDrag.ts'
import { GanttTaskRow } from './GanttTaskRow.tsx'
import { LinkTaskTool } from './LinkTaskTool.tsx'
import type { GanttEnv } from './ganttEnv.ts'
import { currentTargetKey, linkCandidates, relinkFrom } from './ganttLinking.ts'
import { progressLabel, sectionProgress, tasksUnderSection, type ProgressSource } from './ganttProgress.ts'

// One milestone section: its drafted tick, its bar, and — when open — its Board
// tasks and the tool that links an existing one. Progress comes from ALL linked
// tasks (archived included) so archiving a Done task never lowers it; the rows
// listed are the active ones.
export function SectionRow({
  section,
  milestoneKey,
  tasks,
  progressTasks,
  open,
  onToggle,
  subsections = [],
  openSections,
  onToggleSection,
  depth = 0,
  env,
}: {
  section: MilestoneSection
  milestoneKey: string
  tasks: Task[]
  progressTasks: ProgressSource[]
  open: boolean
  onToggle: () => void
  // Subsections are drawn under their parent, one level deep (a subsection has none).
  subsections?: MilestoneSection[]
  openSections?: ReadonlySet<string>
  onToggleSection?: (key: string) => void
  depth?: number
  env: GanttEnv
}) {
  const subsectionIds = subsections.map((s) => s.id)
  // The section's own subtasks are listed here; a section that has subsections
  // also counts theirs in its progress and bar.
  const under = tasksUnderSection(tasks, section.id)
  const underAll = tasks.filter((t) => t.section_id === section.id || (t.section_id !== null && subsectionIds.includes(t.section_id)))
  const shown = under.filter(env.lens.matches)
  const progress = sectionProgress(section, progressTasks, subsectionIds)
  const words = progressLabel(progress, 'section', 'drafted')
  const target = { seasonId: env.seasonId, milestoneKey, sectionId: section.id }
  const { direct, relink } = linkCandidates(tasks, target, (t) => env.permsFor(t).canEdit)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  // A task dragged from another row lands here (the same move as "Move to").
  const [dropOver, setDropOver] = useState(false)
  const drop = taskDropHandlers((taskId) => {
    const task = byId.get(taskId)
    if (task) env.onMoveTo(task, target)
  }, setDropOver)
  const dimmed = env.lens.active && !underAll.some(env.lens.matches)
  const link = (taskId: string) => {
    const task = byId.get(taskId)
    if (task) env.onLink(task, target)
  }

  return (
    <div data-testid={`gantt-section-${section.id}`} className={dimmed ? 'opacity-70' : undefined}>
      <div className={`${ROW} group py-1 ${dropOver ? "rounded-lg ring-2 ring-accent-ring" : ""}`} {...drop} data-drop-target="true">
        <div className={`${STICKY_LABEL} flex items-center gap-1.5 bg-surface ${depth > 0 ? 'pl-10' : 'pl-6'} pr-2 group-hover:bg-slate-100`}>
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-11 items-center gap-1.5 text-left text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0"
          >
            <span aria-hidden="true" className="w-3 text-slate-500">
              {open ? '▾' : '▸'}
            </span>
            {section.name}
          </button>
          {/* Progress is counted from the section's tasks; the "drafted" tick lives on Milestones, not here. */}
          <span className="ml-auto shrink-0 text-xs text-slate-600">{progress.basis === 'tasks' ? `${progress.done}/${progress.total}` : ''}</span>
        </div>

        <Track
          today={env.todayLeft}
          summary={`${section.name}: ${words}${
            env.lens.active ? `. ${shown.length} task${shown.length === 1 ? '' : 's'} shown for ${env.lens.name}` : ''
          }`}
        >
        </Track>
      </div>

      {open && (
        <>
          {shown.map((task) => {
            const perms = env.permsFor(task)
            return (
              <GanttTaskRow
                key={task.id}
                task={task}
                today={env.today}
                departmentName={task.subteam_key ? (env.departmentNames.get(task.subteam_key) ?? task.subteam_key) : null}
                ownerName={task.owner_id ? (env.memberNames.get(task.owner_id) ?? 'Unknown member') : null}
                members={env.members}
                range={env.range}
                todayLeft={env.todayLeft}
                perms={perms}
                unlink={
                  perms.canEdit
                    ? { kind: 'action', label: `Unlink ${task.title} from ${section.name}`, onUnlink: () => env.onUnlinkSection(task) }
                    : null
                }
                expanded={env.expandedTask === task.id}
                onToggle={() => env.onToggleTask(task.id)}
                moveTargets={env.moveTargets}
                currentTargetKey={currentTargetKey(task)}
                onMoveTo={(to) => env.onMoveTo(task, to)}
                onSchedule={(start, due) => env.onSchedule(task, start, due)}
                prerequisites={env.prerequisitesFor(task)}
                onMove={(state, reason) => env.onMove(task.id, state, reason)}
                onOwner={(ownerId) => env.onOwner(task.id, ownerId)}
              />
            )
          })}

          {subsections.map((sub) => (
            <SectionRow
              key={sub.id}
              section={sub}
              milestoneKey={milestoneKey}
              tasks={tasks}
              progressTasks={progressTasks}
              open={openSections?.has(sub.id) ?? false}
              onToggle={() => onToggleSection?.(sub.id)}
              depth={depth + 1}
              env={env}
            />
          ))}

          {underAll.length === 0 && (
            <p className="sticky left-0 z-10 w-fit bg-surface pl-12 text-[11px] text-slate-600">
              No subtasks yet.{env.canManage ? ' Link an existing Board task below.' : ''}
            </p>
          )}
          {under.length > 0 && shown.length === 0 && (
            <p className="sticky left-0 z-10 w-fit bg-surface pl-12 text-[11px] text-slate-600" data-testid={`gantt-section-empty-${section.id}`}>
              Nothing for {env.lens.name} in this section ({under.length} task{under.length === 1 ? '' : 's'} hidden by the
              filter).
            </p>
          )}

          {env.canManage && (
            <LinkTaskTool
              targetLabel={section.name}
              direct={direct.map((t) => ({ id: t.id, title: t.title }))}
              moves={relink.map((t) => ({ id: t.id, title: t.title, from: relinkFrom(t, (id) => env.sectionNames.get(id) ?? null) }))}
              onLink={link}
              onMove={link}
            />
          )}
        </>
      )}
    </div>
  )
}
