// The letters shown in place of a picture: the first letter of the first and last name, upper case. One letter
// for a single name, "?" for none. Whole characters, so letters outside plain ASCII are never cut in half.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return (first + last).toLocaleUpperCase()
}
