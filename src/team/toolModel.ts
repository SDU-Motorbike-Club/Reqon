// A tool has THREE separate facts (20260141000000_team_tools.sql):
//   * who OWNS it: never changes;
//   * WHERE it is: the workshop, someone's home, the university, or somewhere else;
//   * WHO HAS IT right now: a member, or nobody (it just sits where it is).
// "Borrowed" is not a place: it is somebody having it.
export const TOOL_LOCATIONS = ['workshop', 'home', 'university', 'other'] as const
export type ToolLocation = (typeof TOOL_LOCATIONS)[number]

export const TOOL_LOCATION_LABEL: Record<ToolLocation, string> = {
  workshop: 'In the workshop',
  home: 'At home',
  university: 'At the university',
  other: 'Somewhere else',
}

export const isToolLocation = (value: string): value is ToolLocation => (TOOL_LOCATIONS as readonly string[]).includes(value)

// "Nobody" / "You" / a name: who has the tool, said to the person reading.
export function holderText(heldBy: string | null, names: ReadonlyMap<string, string>, me: string | undefined): string {
  if (heldBy === null) return 'Nobody'
  if (heldBy === me) return 'You'
  return names.get(heldBy) ?? 'Someone no longer on the roster'
}

// A tool is either its owner's own or a club tool, chosen when it is listed (20260147000000_tools_shared_flag.sql).
// "Club tool" is the name for what was loosely called "common": something the club keeps for everyone.
export const CLUB_TOOL_LABEL = 'Club tool'

// What the list says about whose a tool is: "Club tool", "Mine", or the owner's name.
export function toolKindLabel(tool: { shared: boolean; owner_id: string }, names: ReadonlyMap<string, string>, me: string | undefined): string {
  if (tool.shared) return CLUB_TOOL_LABEL
  if (tool.owner_id === me) return 'Mine'
  return names.get(tool.owner_id) ?? 'Someone no longer on the roster'
}

export type ToolLocationGroup<T> = { location: ToolLocation; tools: T[] }

// The list is read by place: the workshop first, then home, the university and everywhere else. Only places that
// have a tool appear; within a place the tools are in name order. A place this client does not know is "somewhere else".
export function groupByLocation<T extends { id: string; item: string; location: string }>(tools: readonly T[]): ToolLocationGroup<T>[] {
  const groups = new Map<ToolLocation, T[]>(TOOL_LOCATIONS.map((l) => [l, []]))
  for (const tool of tools) groups.get(isToolLocation(tool.location) ? tool.location : 'other')?.push(tool)
  return TOOL_LOCATIONS.map((location) => ({
    location,
    tools: [...(groups.get(location) ?? [])].sort((a, b) => a.item.localeCompare(b.item) || a.id.localeCompare(b.id)),
  })).filter((g) => g.tools.length > 0)
}

// Does a tool belong in the list for this search? It looks at the tool's name, its owner's and holder's names, the
// place and "club tool", case-insensitively, so "bo" finds the tools Bo owns or has.
export function toolMatches(
  tool: { item: string; location: string; owner_id: string; held_by: string | null; shared: boolean },
  query: string,
  names: ReadonlyMap<string, string>,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const place = isToolLocation(tool.location) ? TOOL_LOCATION_LABEL[tool.location] : TOOL_LOCATION_LABEL.other
  const haystack = [tool.item, names.get(tool.owner_id) ?? '', tool.held_by ? (names.get(tool.held_by) ?? '') : '', place, tool.shared ? CLUB_TOOL_LABEL : ''].join(' ').toLowerCase()
  return haystack.includes(needle)
}
