// The real lines of an agenda: headings skipped, bullets and Markdown marks removed, empty lines (the untouched
// template's bare "- ") dropped. The upcoming meeting card lists the first few of these.
export function agendaItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}(\s|$)/.test(line))
    .map((line) => line.replace(/^([-*+]|\d+[.)])(\s+|$)/, '').replace(/[*_`\\]/g, '').trim())
    .filter(Boolean)
}
