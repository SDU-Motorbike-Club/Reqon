import type { ReactNode } from 'react'

// What the few shapes on the timeline mean. Each entry pairs the SHAPE with words, so the chart never relies on
// colour alone. The samples are decorative (aria-hidden): the list itself carries the meaning.
const ENTRIES: { sample: ReactNode; text: string }[] = [
  { sample: <span className="inline-block h-4 w-0 border-l border-dashed border-accent-ring" />, text: 'Today' },
  { sample: <span className="text-base font-bold leading-none text-accent">⚑</span>, text: 'Submission deadline' },
  { sample: <span className="text-base font-bold leading-none text-slate-700">●</span>, text: 'Task date' },
  { sample: <span className="text-base font-bold leading-none text-accent-ring">!</span>, text: 'Overdue' },
  { sample: <span className="text-base font-bold leading-none text-ok">✓</span>, text: 'Done' },
]

export function GanttLegend({ id }: { id?: string }) {
  return (
    <section id={id} aria-label="Legend" className="mb-3 rounded-xl border border-slate-200 bg-surface px-3 py-2" data-testid="gantt-legend">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
        {ENTRIES.map((entry) => (
          <li key={entry.text} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-flex min-w-5 items-center justify-center">
              {entry.sample}
            </span>
            {entry.text}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-600">A task with no dates draws nothing and says so. Nothing is estimated.</p>
    </section>
  )
}
