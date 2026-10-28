import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'
import { cleanEditorMarkdown } from './editorMarkdown.ts'
import { editorExtensions } from './editorExtensions.ts'

// A document you write in, like a word processor: type, and use the buttons for headings and bullet points.
// What is stored is still the Markdown the Meetings page, the WhatsApp text and the email text read; the person
// never sees it. Loaded on demand (RichTextField.tsx), so the app shell does not pay for the editor.

const same = (a: string, b: string) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '')

const tool =
  'min-h-11 rounded px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-40 aria-pressed:bg-slate-200 aria-pressed:text-slate-950 sm:min-h-0 sm:py-1'

export default function RichTextEditor({
  labelId,
  value,
  onChange,
  placeholder,
  disabled = false,
  heightClass,
}: {
  // The id of the element that names this field; the writing area is a textbox labelled by it.
  labelId: string
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  disabled?: boolean
  // The writing area's height, as Tailwind classes (min-h and max-h), so a long agenda scrolls inside it.
  heightClass: string
}) {
  // What the field was last given, so a "change" that is only the editor reading that same text (it reports one when
  // it first parses the stored Markdown) is not passed on as an edit: the form would think it was modified.
  const given = useRef(value)
  useEffect(() => {
    given.current = value
  }, [value])
  const extensions = useMemo(() => [...editorExtensions(), Placeholder.configure({ placeholder: placeholder ?? '' })], [placeholder])
  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelId, class: 'pc-doc' },
      // ProseMirror cancels Escape's default on purpose, so the browser would never close the dialog this sits
      // in. Hand Escape to that dialog's own cancel handling, as every other field in it does.
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape') return false
        view.dom.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = cleanEditorMarkdown(e.getMarkdown())
      if (!same(next, given.current)) onChange(next)
    },
  })

  // The text can change from outside (the default agenda reloaded after someone else saved it). Only then is the
  // document replaced; a value that is just this editor's own text coming back leaves the cursor where it is.
  useEffect(() => {
    if (!editor || same(cleanEditorMarkdown(editor.getMarkdown()), value)) return
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      heading: e.isActive('heading', { level: 2 }),
      subheading: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bullets: e.isActive('bulletList'),
      numbered: e.isActive('orderedList'),
      canIndent: e.can().sinkListItem('listItem'),
      canOutdent: e.can().liftListItem('listItem'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  // A button must not take the focus (and with it the selection) out of the text before it acts.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()
  const run = (command: () => boolean) => () => {
    command()
  }

  return (
    <div className="rounded border border-slate-300 bg-surface focus-within:ring-2 focus-within:ring-accent-ring">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 rounded-t border-b border-slate-200 bg-slate-50 p-1">
        <button type="button" className={tool} aria-pressed={state.heading} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
          Heading
        </button>
        <button type="button" className={tool} aria-pressed={state.subheading} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>
          Sub-heading
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300" />
        <button type="button" className={`${tool} font-bold`} aria-pressed={state.bold} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleBold().run())}>
          Bold
        </button>
        <button type="button" className={`${tool} italic`} aria-pressed={state.italic} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleItalic().run())}>
          Italic
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300" />
        <button type="button" className={tool} aria-pressed={state.bullets} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleBulletList().run())}>
          • Bullets
        </button>
        <button type="button" className={tool} aria-pressed={state.numbered} disabled={disabled} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().toggleOrderedList().run())}>
          1. Numbered
        </button>
        <button type="button" className={tool} disabled={disabled || !state.canIndent} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().sinkListItem('listItem').run())}>
          Indent
        </button>
        <button type="button" className={tool} disabled={disabled || !state.canOutdent} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().liftListItem('listItem').run())}>
          Outdent
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300" />
        <button type="button" className={tool} disabled={disabled || !state.canUndo} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().undo().run())}>
          Undo
        </button>
        <button type="button" className={tool} disabled={disabled || !state.canRedo} onMouseDown={keepFocus} onClick={run(() => editor.chain().focus().redo().run())}>
          Redo
        </button>
      </div>
      <div className={`overflow-y-auto overscroll-contain ${heightClass}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
