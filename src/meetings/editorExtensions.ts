import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

// One configuration for the meeting editor, shared by the component and by the test that proves the Markdown
// round trip, so the test checks what ships.
//
// Only what MarkdownView can draw is switched on. StarterKit also brings Underline and code blocks; neither has
// a Markdown form the renderer shows (underline has none, a fenced block is not in its allowed elements), so
// they would be written out and then lost on the next read. Links are kept if pasted, but never made on their
// own: a bare URL stays a bare URL (editorMarkdown.ts undoes the writer's `[url](url)`).
export function editorExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false },
    }),
    Markdown,
  ]
}
