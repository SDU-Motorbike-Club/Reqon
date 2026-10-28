import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { cleanEditorMarkdown, stripMarkdownEscapes } from './editorMarkdown.ts'
import { editorExtensions } from './editorExtensions.ts'
import { emailText, whatsappText } from './meetingText.ts'

// The stored agenda is Markdown, and three things read it: the Meetings page, the WhatsApp text and the email
// text. The editor must therefore write back what it was given. These tests run the REAL editor (headless, in
// jsdom) with the configuration that ships, so a library upgrade that changes how it writes Markdown fails here
// instead of putting backslashes into a message someone pastes into the team chat.

function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: editorExtensions(), content: markdown, contentType: 'markdown' })
  try {
    return cleanEditorMarkdown(editor.getMarkdown())
  } finally {
    editor.destroy()
  }
}

// What the club's database seeds new meetings with (20260108000000), word for word.
const DEFAULT_TEMPLATE =
  '## Agenda\n\n- \n\n## Action items from last time\n\n- \n\n## Blockers\n\n- \n\n## Decisions\n\n- \n\n## New actions\n\n- who does what, by when\n\n## Notes\n\n'

const SAME: Record<string, string> = {
  'the default template': DEFAULT_TEMPLATE,
  'headings, bullets and two levels of sub-points': '## Agenda\n\n- Frame jig\n  - bring the welder\n    - and the clamps\n  - check the table\n- Wheels\n',
  'a numbered list': '## Decisions\n\n1. Order tyres\n2. Book the track\n3. Pay the entry fee\n',
  'bold and italic': 'Some *italic* and **bold** and ***both*** in a line\n',
  'strike-through, inline code, a quote and a rule': 'Dropped ~~this~~ and use `npm test`\n\n> quoted line\n\n---\n\nAfter the rule\n',
  'a hash that is not a heading': '- Item #3 is open\n- see issue #12\n',
  'underscores inside words': '- snake_case_name and a_b and MY_CONSTANT\n- a__b__c\n',
  'a URL with underscores, a query and an ampersand': 'See https://example.com/a_b_c/d?x=1&y=2&z=a_b for more.\n',
  'angle brackets and ampersands in prose': '- a < b and c > d\n- R&D, Q&A and AT&T\n',
  'square brackets that are not a link': '- [not a link] and (parens)\n- see [1] and [2]\n',
  'a real link someone pasted': 'A [link text](https://example.com/page_one) in a line\n',
  'a list item that looks like a number': '- 1. not a list\n- 2026. a year and a stop\n',
  'lines typed one under another without bullets': 'Line one\nLine two\nLine three\n',
  'accented and other letters': '## Réunion\n\n- Ärger über Ölpreise_alt\n- 日本語_テスト\n',
}

describe('the editor writes back what it was given', () => {
  for (const [name, markdown] of Object.entries(SAME)) {
    it(`${name}`, () => {
      expect(roundTrip(markdown)).toBe(markdown.replace(/\s+$/, ''))
    })
  }

  it('leaves the text of every share message exactly as it was', () => {
    for (const [name, agenda] of Object.entries(SAME)) {
      const meeting = { title: 'Weekly', held_on: '2026-11-03', starts_at: '16:30:00', ends_at: null, location: 'Workshop', agenda }
      const after = { ...meeting, agenda: roundTrip(agenda) }
      expect(whatsappText(after, null), `WhatsApp text for: ${name}`).toBe(whatsappText(meeting, null))
      expect(emailText(after, null), `email text for: ${name}`).toEqual(emailText(meeting, null))
    }
  })

  it('writes bullets as "- " lines and headings as "## ", which is what the share code reads', () => {
    const out = roundTrip('## Agenda\n\n- one\n- two\n')
    expect(out.split('\n')).toEqual(['## Agenda', '', '- one', '- two'])
    expect(whatsappText({ title: 'T', held_on: '2026-11-03', starts_at: null, ends_at: null, location: null, agenda: out }, null)).toContain('*Agenda*\n\n- one\n- two')
  })

  it('writes italics as *x*, whichever way they were stored, and they read the same', () => {
    expect(roundTrip('an _italic_ word\n')).toBe('an *italic* word')
  })

  it('puts a blank line between a paragraph and a list that followed it directly, and nothing else changes', () => {
    expect(roundTrip('Attendance first\n- one\n- two\n')).toBe('Attendance first\n\n- one\n- two')
  })

  it('does not turn a pasted URL into a link', () => {
    expect(roundTrip('Visit https://example.com/a_b now')).toBe('Visit https://example.com/a_b now')
  })
})

describe('a literal asterisk', () => {
  // Kept escaped so it is not read as emphasis; the share texts strip the backslash.
  it('stays safe in the stored text and clean in the messages', () => {
    const stored = roundTrip('Costs 5 * 3 = 15, use * carefully\n')
    expect(stored).toContain('\\*')
    const meeting = { title: 'T', held_on: '2026-11-03', starts_at: null, ends_at: null, location: null, agenda: stored }
    expect(whatsappText(meeting, null)).toContain('Costs 5 * 3 = 15, use * carefully')
    expect(whatsappText(meeting, null)).not.toContain('\\')
    expect(emailText(meeting, null).body).not.toContain('\\')
  })
})

describe('cleanEditorMarkdown', () => {
  it('undoes the writer escapes that cannot change how the text reads', () => {
    expect(cleanEditorMarkdown('snake\\_case and a\\_\\_b')).toBe('snake_case and a__b')
    expect(cleanEditorMarkdown('R&amp;D a &lt; b &gt; c')).toBe('R&D a < b > c')
    expect(cleanEditorMarkdown('\\[note\\]')).toBe('[note]')
  })

  it('keeps a leading or trailing underscore escaped, where it could start emphasis', () => {
    expect(cleanEditorMarkdown('\\_word\\_')).toBe('\\_word\\_')
  })

  it('does not decode an entity the person typed literally', () => {
    expect(cleanEditorMarkdown('typed &amp;amp; here')).toBe('typed &amp; here')
    expect(cleanEditorMarkdown('typed &amp;lt; here')).toBe('typed &lt; here')
  })

  it('collapses a link only when its text is its own address', () => {
    expect(cleanEditorMarkdown('[https://x.org/a](https://x.org/a)')).toBe('https://x.org/a')
    expect(cleanEditorMarkdown('[the site](https://x.org/a)')).toBe('[the site](https://x.org/a)')
  })

  it('trims trailing whitespace and nothing else', () => {
    expect(cleanEditorMarkdown('- one\n- \n\n')).toBe('- one\n-')
  })
})

describe('stripMarkdownEscapes', () => {
  it('removes a backslash before Markdown punctuation and keeps other backslashes', () => {
    expect(stripMarkdownEscapes('5 \\* 3 \\# \\[x\\] \\_y\\_')).toBe('5 * 3 # [x] _y_')
    expect(stripMarkdownEscapes('C:\\temp\\file')).toBe('C:\\temp\\file')
  })
})
