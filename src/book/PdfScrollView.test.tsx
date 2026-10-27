import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The continuous Book view over a fake pdf.js and a fake IntersectionObserver: every page has a box from
// the start, only pages near the screen are drawn (and freed when they leave), the page in the middle is
// reported, and a requested page is scrolled to. A real browser run draws the real PDF.
const fake = vi.hoisted(() => ({
  destroyed: 0,
  rendered: [] as number[],
  observers: [] as { cb: (e: unknown[]) => void; opts: { rootMargin?: string }; targets: Element[] }[],
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 5,
      getPage: async (n: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 840 * scale }),
        render: () => {
          fake.rendered.push(n)
          return { cancel: () => {}, promise: Promise.resolve() }
        },
      }),
    }),
    destroy: async () => {
      fake.destroyed += 1
    },
  }),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.js' }))

const { default: PdfScrollView } = await import('./PdfScrollView.tsx')

const scrolled: number[] = []
beforeEach(() => {
  fake.destroyed = 0
  fake.rendered = []
  fake.observers = []
  scrolled.length = 0
  class FakeIO {
    cb: (e: unknown[]) => void
    entry: { cb: (e: unknown[]) => void; opts: { rootMargin?: string }; targets: Element[] }
    constructor(cb: (e: unknown[]) => void, opts: { rootMargin?: string }) {
      this.cb = cb
      this.entry = { cb, opts, targets: [] }
      fake.observers.push(this.entry)
    }
    observe(el: Element) { this.entry.targets.push(el) }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIO)
  class FakeRO {
    cb: (e: unknown[]) => void
    constructor(cb: (e: unknown[]) => void) {
      this.cb = cb
    }
    observe() { this.cb([{ contentRect: { width: 600 } }]) }
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeRO)
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(Number((this as HTMLElement).dataset.page)) }
})
afterEach(() => vi.unstubAllGlobals())

const props = { url: 'https://x/regs.pdf', label: 'Book', maxHeightClass: 'h-96', onDocument: () => {}, onVisiblePage: () => {}, onError: () => {} }
const tell = (which: 'near' | 'middle', pages: number[], isIntersecting: boolean) => {
  const obs = fake.observers.find((o) => (which === 'near' ? o.opts.rootMargin?.startsWith('1500') : o.opts.rootMargin?.startsWith('-45')))
  act(() => obs?.cb(pages.map((p) => ({ target: obs.targets[p - 1], isIntersecting }))))
}

describe('PdfScrollView', () => {
  it('gives every page a box up front, so the scroll bar is the real length of the book', async () => {
    const seen = vi.fn()
    render(<PdfScrollView {...props} pageIndex={1} onDocument={seen} />)
    await waitFor(() => expect(screen.getByTestId('book-scroll')).toHaveAttribute('data-pages', '5'))
    expect(seen).toHaveBeenCalledWith(5)
    expect(document.querySelectorAll('[data-page]')).toHaveLength(5)
    expect(fake.rendered).toEqual([]) // nothing is near yet, so nothing is drawn
  })

  it('draws only the pages near the screen, and frees one that leaves', async () => {
    render(<PdfScrollView {...props} pageIndex={1} />)
    await waitFor(() => expect(screen.getByTestId('book-scroll')).toHaveAttribute('data-pages', '5'))
    tell('near', [1, 2], true)
    await waitFor(() => expect(fake.rendered.sort()).toEqual([1, 2]))
    expect(screen.getAllByRole('img')).toHaveLength(2)
    tell('near', [1], false)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
  })

  it('reports the page in the middle of the screen as the reader scrolls', async () => {
    const visible = vi.fn()
    render(<PdfScrollView {...props} pageIndex={1} onVisiblePage={visible} />)
    await waitFor(() => expect(screen.getByTestId('book-scroll')).toHaveAttribute('data-pages', '5'))
    tell('middle', [3], true)
    expect(visible).toHaveBeenLastCalledWith(3)
  })

  it('scrolls to the page it is asked for, and does not fight the reader once the reader is there', async () => {
    const { rerender } = render(<PdfScrollView {...props} pageIndex={4} />)
    await waitFor(() => expect(scrolled).toContain(4))
    const first = scrolled.length
    tell('middle', [4], true)
    rerender(<PdfScrollView {...props} pageIndex={4} />)
    expect(scrolled.length).toBe(first)
    rerender(<PdfScrollView {...props} pageIndex={2} />)
    await waitFor(() => expect(scrolled).toContain(2))
  })

  it('releases the pdf.js worker when it closes', async () => {
    const { unmount } = render(<PdfScrollView {...props} pageIndex={1} />)
    await waitFor(() => expect(screen.getByTestId('book-scroll')).toHaveAttribute('data-pages', '5'))
    unmount()
    expect(fake.destroyed).toBeGreaterThan(0)
  })
})
