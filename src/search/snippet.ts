export type Snippet = { before: string; match: string; after: string }

// A short window of `text` around the first place `term` occurs (case-insensitive), cut with "…" where the text
// goes on. Whitespace is collapsed so a multi-line description reads as one line. No match: the start of the text.
export function snippet(text: string, term: string, radius = 45): Snippet {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = term ? flat.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (at < 0) return { before: '', match: '', after: flat.length > radius * 2 ? `${flat.slice(0, radius * 2).trimEnd()}…` : flat }
  const start = Math.max(0, at - radius)
  const end = Math.min(flat.length, at + term.length + radius)
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, at + term.length),
    after: flat.slice(at + term.length, end) + (end < flat.length ? '…' : ''),
  }
}
