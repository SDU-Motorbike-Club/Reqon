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

type ToolRow = { id: string; item: string; owner_id: string }
export type ToolOwnerGroup<T extends ToolRow> = { ownerId: string; name: string; tools: T[] }

// Tools grouped by owner: the signed-in member first, then the others by name.
// An owner who is not on the roster list still shows, under a plain name.
export function groupByOwner<T extends ToolRow>(tools: readonly T[], names: ReadonlyMap<string, string>, me: string | undefined): ToolOwnerGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const tool of tools) {
    const list = groups.get(tool.owner_id)
    if (list) list.push(tool)
    else groups.set(tool.owner_id, [tool])
  }
  return [...groups]
    .map(([ownerId, list]) => ({
      ownerId,
      name: names.get(ownerId) ?? 'Someone no longer on the roster',
      tools: [...list].sort((a, b) => a.item.localeCompare(b.item) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => Number(b.ownerId === me) - Number(a.ownerId === me) || a.name.localeCompare(b.name))
}
