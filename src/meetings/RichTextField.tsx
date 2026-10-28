import { lazy, Suspense } from 'react'

// The agenda and the minutes are written in a document-style editor (RichTextEditor), loaded when a dialog that
// needs it opens. The stored value is Markdown, as before; nothing about how it is read changes.
const RichTextEditor = lazy(() => import('./RichTextEditor.tsx'))

// How tall the writing area is. Written out in full so Tailwind sees the classes.
const HEIGHT = {
  large: 'min-h-[22rem] max-h-[60dvh]',
  medium: 'min-h-[12rem] max-h-[40dvh]',
} as const

export function RichTextField({
  id,
  label,
  value,
  onChange,
  size = 'large',
  placeholder,
  note,
  disabled = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  size?: keyof typeof HEIGHT
  placeholder?: string
  note?: string
  disabled?: boolean
}) {
  const labelId = `${id}-label`
  return (
    <div>
      {/* A <label for> cannot point at a contenteditable box, so the box is named by aria-labelledby instead. */}
      <p id={labelId} className="mb-1 text-xs font-medium text-slate-600">
        {label}
      </p>
      <Suspense
        fallback={
          <div role="status" className={`flex items-center justify-center rounded border border-slate-300 bg-slate-50 text-sm text-slate-600 ${HEIGHT[size].split(' ')[0]}`}>
            Loading the editor…
          </div>
        }
      >
        <RichTextEditor labelId={labelId} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} heightClass={HEIGHT[size]} />
      </Suspense>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}
