import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import RichTextEditor from './RichTextEditor.tsx'

// The real editor, in jsdom. jsdom has no layout, so the few measuring calls ProseMirror makes after a command are
// stubbed. Typing into a contenteditable is not something jsdom does faithfully, so these tests drive the toolbar and
// the value that comes in and goes out; that what goes out reads back correctly is editorMarkdown.test.ts.
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  document.elementFromPoint = () => null
})

// A parent that keeps what it is told, as every form does: the value the editor is given follows what it reported.
function Parent({ initial, onChange, ...rest }: { initial: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <p id="agenda-label">Agenda</p>
      <RichTextEditor
        labelId="agenda-label"
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
        heightClass="min-h-[8rem]"
        {...rest}
      />
    </div>
  )
}

function mount(value: string, over: Partial<{ disabled: boolean; placeholder: string }> = {}) {
  const onChange = vi.fn()
  const view = render(<Parent initial={value} onChange={onChange} {...over} />)
  return { onChange, ...view }
}

const toolbar = () => within(screen.getByRole('toolbar', { name: 'Formatting' }))

describe('the writing area', () => {
  it('is one textbox named by the label above it, and draws the stored Markdown as a document', async () => {
    mount('## Agenda\n\n- Frame jig\n  - bring the welder\n- Wheels')
    const box = await screen.findByRole('textbox', { name: 'Agenda' })
    expect(box).toHaveAttribute('aria-multiline', 'true')
    expect(within(box).getByRole('heading', { level: 2, name: 'Agenda' })).toBeInTheDocument()
    expect(within(box).getAllByRole('listitem').map((li) => li.firstElementChild?.textContent ?? li.textContent)).toEqual(
      expect.arrayContaining(['Frame jig', 'bring the welder', 'Wheels']),
    )
    expect(within(box).getByText('bring the welder').closest('ul')?.parentElement?.closest('ul')).not.toBeNull()
  })

  it('has no Markdown legend or syntax help anywhere', async () => {
    mount('## Agenda')
    await screen.findByRole('textbox', { name: 'Agenda' })
    expect(screen.queryByText(/Formatting:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\*\*bold\*\*/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
  })

  it('shows the placeholder only while the document is empty', async () => {
    const { container } = mount('', { placeholder: 'What was decided' })
    await screen.findByRole('textbox', { name: 'Agenda' })
    expect(container.querySelector('p.is-editor-empty')).toHaveAttribute('data-placeholder', 'What was decided')
  })
})

describe('the buttons', () => {
  it('turn the line into a heading, a sub-heading, a bullet or a numbered item, and write it as Markdown', async () => {
    const user = userEvent.setup()
    const { onChange } = mount('one line')
    await screen.findByRole('textbox', { name: 'Agenda' })

    await user.click(toolbar().getByRole('button', { name: 'Heading' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('## one line'))
    expect(toolbar().getByRole('button', { name: 'Heading' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(toolbar().getByRole('button', { name: 'Sub-heading' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('### one line'))

    await user.click(toolbar().getByRole('button', { name: 'Sub-heading' })) // off again
    await user.click(toolbar().getByRole('button', { name: /Bullets/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('- one line'))
    expect(toolbar().getByRole('button', { name: /Bullets/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(toolbar().getByRole('button', { name: /Numbered/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('1. one line'))
  })

  it('offer Indent and Outdent only inside a list, and Undo only after a change', async () => {
    const user = userEvent.setup()
    mount('one line')
    await screen.findByRole('textbox', { name: 'Agenda' })
    expect(toolbar().getByRole('button', { name: 'Indent' })).toBeDisabled()
    expect(toolbar().getByRole('button', { name: 'Outdent' })).toBeDisabled()
    expect(toolbar().getByRole('button', { name: 'Undo' })).toBeDisabled()
    await user.click(toolbar().getByRole('button', { name: /Bullets/ }))
    await waitFor(() => expect(toolbar().getByRole('button', { name: 'Undo' })).toBeEnabled())
    // The only item cannot be indented under nothing, but it can step back out of the list.
    await waitFor(() => expect(toolbar().getByRole('button', { name: 'Outdent' })).toBeEnabled())
  })

  it('undo takes the change back', async () => {
    const user = userEvent.setup()
    const { onChange } = mount('one line')
    await screen.findByRole('textbox', { name: 'Agenda' })
    await user.click(toolbar().getByRole('button', { name: /Bullets/ }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('- one line'))
    await user.click(toolbar().getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('one line'))
  })

  it('stay out of the way of a person who may not edit', async () => {
    mount('one line', { disabled: true })
    const box = await screen.findByRole('textbox', { name: 'Agenda' })
    expect(box).toHaveAttribute('contenteditable', 'false')
    for (const button of toolbar().getAllByRole('button')) expect(button).toBeDisabled()
  })
})

describe('opening a document', () => {
  it('does not report an edit just because the editor read the stored text', async () => {
    const { onChange } = mount('## Agenda\n\n- one\n\n## Notes\n\n')
    await screen.findByRole('textbox', { name: 'Agenda' })
    await act(async () => {})
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('text coming in from outside', () => {
  it('replaces the document without calling onChange, and leaves it alone when it is just the editor’s own text', async () => {
    const onChange = vi.fn()
    const field = (value: string) => (
      <div>
        <p id="agenda-label">Agenda</p>
        <RichTextEditor labelId="agenda-label" value={value} onChange={onChange} heightClass="min-h-[8rem]" />
      </div>
    )
    const { rerender } = render(field('first text'))
    await screen.findByText('first text')
    rerender(field('## Reloaded\n\n- from the database'))
    expect(await screen.findByRole('heading', { name: 'Reloaded' })).toBeInTheDocument()
    expect(screen.queryByText('first text')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => {})
    expect(onChange).not.toHaveBeenCalled()
  })

  // ProseMirror cancels Escape's default, so without this the dialog around the editor could not be closed from
  // the keyboard while the cursor was in the text (found by the real-browser Meetings test).
  it('passes Escape to the dialog around it', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { container } = render(
      <dialog open onCancel={onCancel}>
        <Parent initial="text" onChange={() => {}} />
      </dialog>,
    )
    const box = await within(container).findByRole('textbox')
    await user.click(box)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
