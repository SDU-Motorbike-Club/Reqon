/** Splits meetings (newest first, as the query returns them) into Upcoming, soonest first, and Past, newest first. A meeting held today is upcoming. */
export function splitMeetings<T extends { held_on: string }>(rows: T[], today: string): { upcoming: T[]; past: T[] } {
  const upcoming = rows.filter((m) => m.held_on >= today).reverse()
  const past = rows.filter((m) => m.held_on < today)
  return { upcoming, past }
}
