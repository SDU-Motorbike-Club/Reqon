import type { CSSProperties } from 'react'

// The month (or week) lines behind every track, drawn once as a CSS background from the ruler's own ticks so the
// lines and the labels can never disagree. Set on the chart's wrapper as custom properties; a Track reads them.
// Without them (a Track drawn on its own) the background is simply none.
const GRID_LINE = 'linear-gradient(rgb(255 255 255 / 0.07), rgb(255 255 255 / 0.07))'

export function gridStyle(ticks: readonly { left: number }[]): CSSProperties {
  return {
    '--gantt-grid-img': ticks.map(() => GRID_LINE).join(','),
    '--gantt-grid-size': ticks.map(() => '1px 100%').join(','),
    '--gantt-grid-pos': ticks.map((tick) => `${tick.left}% 0`).join(','),
  } as CSSProperties
}
