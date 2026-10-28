// One page width for the whole app, shared by the header and every screen so
// their edges line up. Capped at 90rem: wider than that the Board's lanes and
// the Gantt only stretch apart without showing more, and every other screen
// looks lost on a big monitor. Phones are unaffected — below the cap it is just
// the side padding.
export const SHELL = 'mx-auto w-full max-w-[90rem] px-3 sm:px-6 lg:px-8'

// How far a screen's content may stretch inside the shell. Each value caps
// every direct child of <main>, so the header, notices and lists share one
// right edge.
//   full    — the screen is laid out for width (Board, Now, Gantt)
//   wide    — lists that stay scannable up to a laptop width
//   reading — mostly forms and sentences (Settings, Finances)
// wide and reading stay on the shell's LEFT edge, the one the header's logo,
// title and navigation start from, so a screen has one left edge to read down.
// (They used to be centred, which put the page title 25 to 160px away from the
// navigation above it.) Only the right side is left empty on a big monitor.
const MEASURE = {
  full: '',
  wide: '*:max-w-6xl',
  reading: '*:max-w-4xl',
} as const

export type Measure = keyof typeof MEASURE

export function pageMain(measure: Measure = 'full'): string {
  return `${SHELL} py-4 ${MEASURE[measure]}`.trim()
}
