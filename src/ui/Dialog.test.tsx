import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog.tsx'

// The proposals overlay holds the review dialog, so one <dialog> sits inside another. A native `cancel`
// (Escape) does not bubble, but React's synthetic onCancel walks up the component tree: without a check,
// closing the inner dialog would close the outer one too — even while the inner one was saving.
describe('nested dialogs', () => {
  function Nested({ onOuter, onInner, innerDismissible = true }: { onOuter: () => void; onInner: () => void; innerDismissible?: boolean }) {
    return (
      <Dialog open onClose={onOuter} labelledBy="outer">
        <h2 id="outer">Outer</h2>
        <Dialog open onClose={onInner} labelledBy="inner" dismissible={innerDismissible}>
          <h2 id="inner">Inner</h2>
          <button type="button">Inner button</button>
        </Dialog>
      </Dialog>
    )
  }
  const dialogOf = (heading: string) => screen.getByText(heading).closest('dialog') as HTMLDialogElement

  it('Escape in the inner dialog closes only the inner one', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<Nested onOuter={outer} onInner={inner} />)
    fireEvent(dialogOf('Inner'), new Event('cancel', { bubbles: false, cancelable: true }))
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('a save in flight in the inner dialog keeps both open', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<Nested onOuter={outer} onInner={inner} innerDismissible={false} />)
    fireEvent(dialogOf('Inner'), new Event('cancel', { bubbles: false, cancelable: true }))
    expect(inner).not.toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
  })

  it('Escape in the outer dialog still closes it', () => {
    const outer = vi.fn()
    render(<Nested onOuter={outer} onInner={vi.fn()} />)
    fireEvent(dialogOf('Outer'), new Event('cancel', { bubbles: false, cancelable: true }))
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('a click inside the inner dialog does not close the outer one', () => {
    const outer = vi.fn()
    render(<Nested onOuter={outer} onInner={vi.fn()} />)
    fireEvent.click(screen.getByText('Inner button'))
    expect(outer).not.toHaveBeenCalled()
  })
})
