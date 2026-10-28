// The editor writes Markdown, but a general-purpose Markdown writer is careful in ways that do not suit
// this text. An agenda is read three ways: drawn on the Meetings page (MarkdownView), pasted into WhatsApp
// and pasted into an email (meetingText.ts). The last two show the Markdown more or less as stored, so what the
// editor writes must read the way a person would have typed it.
//
// Measured with @tiptap/markdown 3.32 (see editorMarkdown.test.ts): headings (`## `), bullets (`- `), nested
// sub-points (two spaces), numbered lists, bold, italic and the club's default agenda come back byte for byte.
// What does NOT, and what this fixes:
//   snake_case          written as snake\_case
//   a & b, a < b        written as a &amp; b, a &lt; b
//   https://x.org/a_b   written as [https://x.org/a\_b](https://x.org/a_b)
//   [note]              written as \[note\]
// Left escaped on purpose: `\*`, `\#` and the like. Un-escaping them could turn text a person typed literally
// into emphasis or a heading the next time the text is read; meetingText.ts strips those backslashes for the
// plain-text share instead.

const WORD = String.raw`\p{L}\p{N}`

export function cleanEditorMarkdown(raw: string): string {
  let out = raw
    // `&lt;` `&gt;` first and `&amp;` last, so a literal "&lt;" the person typed (written `&amp;lt;`) stays "&lt;".
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // An underscore with a letter or digit on both sides is never emphasis, so it needs no escape.
    .replace(new RegExp(String.raw`(?<=[${WORD}])((?:\\_)+)(?=[${WORD}])`, 'gu'), (_, run: string) => '_'.repeat(run.length / 2))

  // A link whose text is just its own address is a pasted URL, not a link someone made: back to the bare URL.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => (text === href ? href : whole))

  return out
    .replace(/\\([[\]])/g, '$1')
    .replace(/\s+$/, '')
}

// The reverse for plain text: the share texts (WhatsApp, email) have no Markdown to interpret, so a backslash
// the editor kept in front of punctuation would show.
export function stripMarkdownEscapes(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
}
