import type { ReactNode } from 'react'

// What the few shapes on the timeline mean. Each entry pairs the SHAPE with words, so the chart never relies on
// colour alone. The samples are decorative (aria-hidden): the list itself carries the meaning.
const ENTRIES: { sample: ReactNode; text: string }[] = [
  { sample: <span className="inline-block h-4 w-0 border-l border-dashed border-accent-ring" />, text: 'Today' },
  { sample: <span className="text-base font-bold leading-none text-accent">⚑</span>, text: 'Submission deadline' },
  { sample: <span className="inline-block h-3 w-6 rounded border border-slate-300/40 bg-slate-300/15" />, text: 'Submission window' },
  { sample: <span className="inline-block h-2 w-6 rounded-sm bg-slate-400/60" />, text: 'Section: first start to last deadline' },
  { sample: <span className="inline-block h-3 w-6 rounded border-2 border-blue-500 bg-blue-500/25" />, text: 'Task with a start and a deadline' },
  { sample: <span className="text-base font-bold leading-none text-slate-700">●</span>, text: 'Task with one date' },
  { sample: <span className="text-base font-bold leading-none text-accent-ring">!</span>, text: 'Overdue' },
  { sample: <span className="text-base font-bold leading-none text-ok">✓</span>, text: 'Done' },
  { sample: <span className="inline-block h-3 w-6 rounded border-2 border-dashed border-slate-300 opacity-70" />, text: 'Cancelled' },
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
