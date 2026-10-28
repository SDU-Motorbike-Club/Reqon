import { milestoneLabel } from '../../milestones/label.ts'
import type { Milestone, MilestoneSection } from '../../data/useMilestones.ts'
import type { Task } from '../../data/useTasks.ts'
import { formatDay } from '../../lib/dates.ts'
import { sectionsFor, subsectionsOf, topLevelSections } from '../milestones/milestoneModel.ts'
import { Marker, ROW, STICKY_LABEL, Track } from './GanttChart.tsx'
import { shortDay } from './ganttModel.ts'
import { SectionRow } from './SectionRow.tsx'
import { UnsectionedRow } from './UnsectionedRow.tsx'
import type { GanttEnv } from './ganttEnv.ts'
import { daysUntil, deadlineNote, milestoneMarks, milestoneSummary } from './ganttMarks.ts'
import { lensProgress, milestoneProgress, progressLabel, type ProgressRow } from './ganttProgress.ts'

// One submission: its window bar and deadline, TWO progress figures when a
// department filter is on (the overall one, which never changes with the filter,
// and the filtered one, labelled with the department), and — when open — its
// sections and its unsectioned work.
export function MilestoneRow({
  milestone,
  sections,
  tasks,
  progressTasks,
  open,
  onToggle,
  openSections,
  onToggleSection,
  env,
}: {
  milestone: Milestone
  sections: MilestoneSection[]
  // Active tasks: the rows that are listed.
  tasks: Task[]
  // Active AND archived tasks: what progress is counted from.
  progressTasks: ProgressRow[]
  open: boolean
  onToggle: () => void
  openSections: ReadonlySet<string>
  onToggleSection: (key: string) => void
  env: GanttEnv
}) {
  // Every section and subsection of the milestone count toward progress; only the
  // top-level ones are rows here — a subsection is drawn under its parent.
  const mySections = sectionsFor(sections, milestone.key)
  const topSections = topLevelSections(sections, milestone.key)
  const marks = milestoneMarks(milestone, env.today)
  const progress = milestoneProgress(mySections, progressTasks, milestone.key)
  const words = progressLabel(progress, 'submission', 'drafted')
  const lens = env.lens.active
    ? lensProgress(mySections, progressTasks.filter(env.lens.matches), milestone.key)
    : null
  const late = marks.passed && (progress.percent ?? 0) < 100
  const note = deadlineNote(marks.deadline, env.today, progress.percent === 100)
  // A submission months away, and closed, steps back until it is looked at.
  const far = !open && marks.deadline !== null && daysUntil(marks.deadline, env.today) > 60
  const unsectionedKey = `unsectioned:${milestone.key}`

  const badge =
    progress.basis === 'tasks'
      ? `Overall ${progress.percent}%`
      : progress.basis === 'drafted'
        ? `${progress.done}/${progress.total} drafted`
        : 'No linked work'

  return (
    <li className={`border-b border-slate-100 py-2 last:border-0 ${far ? 'opacity-70 transition-opacity focus-within:opacity-100 hover:opacity-100' : ''}`} data-testid={`gantt-milestone-${milestone.key}`}>
      <div className={`${ROW} rounded-lg bg-slate-100 py-1`}>
        <div className={`${STICKY_LABEL} flex flex-wrap items-center gap-1.5 bg-slate-100 pr-2`}>
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-11 items-center gap-1.5 text-left text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-0"
          >
            <span aria-hidden="true" className="w-3 text-slate-500">
              {open ? '▾' : '▸'}
            </span>
            <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs">{milestoneLabel(milestone)}</span>
            <span className="font-normal">{milestone.name}</span>
          </button>
          <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            <span
              data-testid={`gantt-overall-${milestone.key}`}
              title={words}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                progress.percent === 100 ? 'bg-green-100 text-green-800' : late ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {badge}
              {late ? ' · deadline passed' : ''}
            </span>
            {lens && (
              <span
                data-testid={`gantt-lens-${milestone.key}`}
                className="rounded-full border border-slate-400 bg-surface px-2 py-0.5 text-xs text-slate-800"
              >
                {lens.basis === 'tasks' ? `${env.lens.name}: ${lens.done} of ${lens.total} done` : `${env.lens.name}: no linked work`}
              </span>
            )}
          </span>
          {/* The answer to "is this urgent?", without opening anything or reading a bar. */}
          <span
            data-testid={`gantt-note-${milestone.key}`}
            className={`basis-full pl-5 text-xs ${
              note.tone === 'late' ? 'font-medium text-accent-ring' : note.tone === 'soon' ? 'font-medium text-amber-800' : 'text-slate-500'
            }`}
          >
            {note.text}
            {marks.deadline ? ` · ${formatDay(marks.deadline)}` : ''}
          </span>
        </div>

        <Track
          onClick={onToggle}
          today={env.todayLeft}
          label={marks.deadline === null && marks.opensOnly ? `Opens ${formatDay(marks.opensOnly)} · deadline TBC` : undefined}
          summary={milestoneSummary(milestone, env.today, words)}
        >
          {marks.deadline && (
            <Marker
              day={marks.deadline}
              range={env.range}
              kind="milestone-deadline"
              overdue={late}
              caption={`Due ${shortDay(marks.deadline)}`}
              title={`${milestoneLabel(milestone)} deadline: ${formatDay(marks.deadline)}${marks.passed ? ' (passed)' : ''}${
                marks.window ? '' : ' — no opening date published'
              }`}
            />
          )}
        </Track>
      </div>

      {open && mySections.length === 0 && (
        <p className="sticky left-0 z-10 w-fit bg-surface py-1 pl-6 text-xs text-slate-600">
          No sections listed for this submission yet.
        </p>
      )}

      {open &&
        topSections.map((section) => (
          <SectionRow
            key={section.id}
            section={section}
            milestoneKey={milestone.key}
            tasks={tasks}
            progressTasks={progressTasks}
            open={openSections.has(section.id)}
            onToggle={() => onToggleSection(section.id)}
            subsections={subsectionsOf(sections, section.id)}
            openSections={openSections}
            onToggleSection={onToggleSection}
            env={env}
          />
        ))}

      {open && (
        <UnsectionedRow
          milestone={milestone}
          tasks={tasks}
          progressTasks={progressTasks}
          open={openSections.has(unsectionedKey)}
          onToggle={() => onToggleSection(unsectionedKey)}
          env={env}
        />
      )}
    </li>
  )
}
