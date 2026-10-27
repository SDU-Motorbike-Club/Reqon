import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

// The whole Requirements Book as ONE scrollable column, like reading a long web
// page: no Previous and Next. Every page has a box of the right height from the
// start, so the scroll bar is the real length of the book; a page is drawn only
// when it is near the screen and freed again when it is far away, so a 200-page
// book never holds 200 pictures in memory. Loaded only when the Book is opened
// (React.lazy in BookReader.tsx), like the one-page view.
const NEAR = '1500px 0px'

export default function PdfScrollView({
  url,
  pageIndex,
  label,
  maxHeightClass,
  onDocument,
  onVisiblePage,
  onError,
}: {
  url: string
  // 1-based PDF page the reader asks to see. Scrolls there when it differs from the page the reader is already on.
  pageIndex: number
  label: string
  maxHeightClass: string
  onDocument: (pageCount: number) => void
  // The page in the middle of the screen, as the reader scrolls (1-based PDF page).
  onVisiblePage: (pageIndex: number) => void
  onError: (message: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slots = useRef<(HTMLDivElement | null)[]>([])
  const [loaded, setLoaded] = useState<{ url: string; doc: PDFDocumentProxy; ratio: number } | null>(null)
  const doc = loaded?.url === url ? loaded.doc : null
  const ratio = loaded?.url === url ? loaded.ratio : 1.3
  const [width, setWidth] = useState(0)
  const [near, setNear] = useState<ReadonlySet<number>>(new Set())
  const reported = useRef<number | null>(null)
  const onDocumentRef = useRef(onDocument)
  const onErrorRef = useRef(onError)
  const onVisibleRef = useRef(onVisiblePage)
  useEffect(() => {
    onDocumentRef.current = onDocument
    onErrorRef.current = onError
    onVisibleRef.current = onVisiblePage
  })

  // Open the document once per address, and measure page 1 for the boxes.
  useEffect(() => {
    let cancelled = false
    const task = getDocument({ url, enableXfa: false })
    task.promise.then(
      async (opened) => {
        const first = await opened.getPage(1)
        if (cancelled) return
        const base = first.getViewport({ scale: 1 })
        setLoaded({ url, doc: opened, ratio: base.height / base.width })
        onDocumentRef.current(opened.numPages)
      },
      (error: unknown) => {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : 'The document could not be read.')
      },
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [url])

  // Follow the column's width, so a page fits a narrow screen.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof ResizeObserver === 'undefined') {
      setWidth(root.clientWidth || 800)
      return
    }
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const pages = doc?.numPages ?? 0
  // One stable function, so a page is not redrawn on every render of this component.
  const fail = useCallback((message: string) => onErrorRef.current(message), [])

  // Which pages are near the screen (drawn), and which one is in the middle (reported).
  useEffect(() => {
    const root = rootRef.current
    if (!root || pages === 0 || typeof IntersectionObserver === 'undefined') return
    const nearObserver = new IntersectionObserver(
      (entries) =>
        setNear((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(index)
            else next.delete(index)
          }
          return next
        }),
      { root, rootMargin: NEAR },
    )
    const middleObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page))
        if (hit.length === 0) return
        const index = Math.min(...hit)
        reported.current = index
        onVisibleRef.current(index)
      },
      { root, rootMargin: '-45% 0px -45% 0px' },
    )
    for (const slot of slots.current) {
      if (slot) {
        nearObserver.observe(slot)
        middleObserver.observe(slot)
      }
    }
    return () => {
      nearObserver.disconnect()
      middleObserver.disconnect()
    }
  }, [pages, url])

  // Scroll to the page the reader asked for, unless that is the page it is already on.
  useEffect(() => {
    if (pages === 0) return
    const index = Math.min(Math.max(1, pageIndex), pages)
    if (reported.current === index) return
    reported.current = index
    slots.current[index - 1]?.scrollIntoView({ block: 'start' })
  }, [pageIndex, pages, url, width])

  return (
    <div
      ref={rootRef}
      className={`w-full overflow-y-auto overscroll-contain rounded border border-slate-300 bg-slate-200 ${maxHeightClass}`}
      data-testid="book-scroll"
      data-pages={pages || ''}
      aria-label={label}
      role="document"
      tabIndex={0}
    >
      {!doc && (
        <p role="status" className="p-4 text-sm text-slate-600">
          Opening the document…
        </p>
      )}
      {doc &&
        Array.from({ length: pages }, (_, i) => i + 1).map((index) => (
          <div
            key={index}
            ref={(el) => {
              slots.current[index - 1] = el
            }}
            data-page={index}
            className="mx-auto mb-2 w-full bg-white"
            style={{ aspectRatio: `1 / ${ratio}` }}
          >
            {width > 0 && near.has(index) && <PageCanvas doc={doc} index={index} width={width} label={`${label}, PDF page ${index}`} onError={fail} />}
          </div>
        ))}
    </div>
  )
}

function PageCanvas({ doc, index, width, label, onError }: { doc: PDFDocumentProxy; index: number; width: number; label: string; onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let task: RenderTask | null = null
    let cancelled = false
    const mounted = canvasRef.current
    doc.getPage(index).then(
      (page) => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const base = page.getViewport({ scale: 1 })
        const pixelRatio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (width / base.width) * pixelRatio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        task = page.render({ canvas, viewport })
        task.promise.then(() => {}, () => {})
      },
      (error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : 'That page could not be read.')
      },
    )
    return () => {
      cancelled = true
      task?.cancel()
      // Free the picture's memory when the page leaves the screen's neighbourhood.
      if (mounted) {
        mounted.width = 0
        mounted.height = 0
      }
    }
  }, [doc, index, width, onError])
  return <canvas ref={canvasRef} role="img" aria-label={label} className="block w-full bg-white" />
}
