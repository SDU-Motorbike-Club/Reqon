import { buttonSecondary } from '../../ui/buttons.ts'
import { selectSmall } from './GanttChart.tsx'

// Expand/collapse everything, and the month/week scale. Pure interaction
// orchestration handed up to Gantt.tsx as callbacks (Phase 6 §6.3) — this
// component holds no state of its own. It is a bare row of controls: Gantt.tsx
// puts it in the same card as the scope filter, so the chart is not pushed down
// by a stack of boxes.
export function GanttToolbar({
  allOpen,
  onToggleAll,
  scale,
  onScale,
  legendOpen,
  legendId,
  onLegend,
  onToday,
}: {
  allOpen: boolean
  onToggleAll: () => void
  scale: 'month' | 'week'
  onScale: (scale: 'month' | 'week') => void
  legendOpen: boolean
  legendId: string
  onLegend: () => void
  // Scrolls the chart to today; absent when today is outside the chart.
  onToday?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`${buttonSecondary} text-xs`} onClick={onToggleAll}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
      {onToday && (
        <button type="button" className={`${buttonSecondary} text-xs max-sm:hidden`} onClick={onToday} data-testid="gantt-to-today">
          Jump to today
        </button>
      )}
      <label className="flex items-center gap-1.5 text-xs text-slate-600 max-sm:hidden">
        Scale
        <select
          value={scale}
          onChange={(e) => onScale(e.target.value as 'month' | 'week')}
          className={selectSmall}
        >
          <option value="month">Monthly</option>
          <option value="week">Weekly</option>
        </select>
      </label>
      <button
        type="button"
        className={`${buttonSecondary} text-xs`}
        aria-expanded={legendOpen}
        aria-controls={legendId}
        onClick={onLegend}
        data-testid="gantt-legend-toggle"
      >
        Legend
      </button>
    </div>
  )
}
