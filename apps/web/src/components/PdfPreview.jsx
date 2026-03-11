import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const PdfPreview = forwardRef(function PdfPreview({ src, zoom = 1 }, ref) {
  const viewportRef = useRef(null)
  const pagesRef = useRef(null)
  const pageRecordsRef = useRef([])
  const markerCleanupRef = useRef(null)
  const [previewState, setPreviewState] = useState('idle')
  const [previewError, setPreviewError] = useState('')

  useImperativeHandle(ref, () => ({
    revealText(query) {
      const normalizedQuery = normalizeText(query)
      if (!normalizedQuery || !viewportRef.current) return false

      const match = pageRecordsRef.current.find((pageRecord) =>
        pageRecord.textItems.find((item) => item.normalized.includes(normalizedQuery)),
      )
      if (!match) return false

      const matchedItem = match.textItems.find((item) => item.normalized.includes(normalizedQuery))
      if (!matchedItem || !match.pageShell) return false

      const viewport = viewportRef.current
      const scrollTop = Math.max(
        match.pageShell.offsetTop + matchedItem.top - viewport.clientHeight / 2 + matchedItem.height,
        0,
      )
      viewport.scrollTo({ top: scrollTop, behavior: 'smooth' })

      if (markerCleanupRef.current) {
        markerCleanupRef.current()
      }

      const marker = document.createElement('div')
      Object.assign(marker.style, {
        position: 'absolute',
        left: `${Math.max(matchedItem.left - 10, 8)}px`,
        top: `${Math.max(matchedItem.top - 6, 8)}px`,
        width: `${Math.max(matchedItem.width + 20, 32)}px`,
        height: `${Math.max(matchedItem.height + 12, 24)}px`,
        borderRadius: '999px',
        background: 'rgba(79, 151, 221, 0.16)',
        border: '2px solid rgba(79, 151, 221, 0.92)',
        boxShadow: '0 0 0 6px rgba(79, 151, 221, 0.12)',
        pointerEvents: 'none',
        transition: 'opacity 220ms ease',
      })

      match.pageShell.appendChild(marker)

      const timeoutId = window.setTimeout(() => {
        marker.style.opacity = '0'
        window.setTimeout(() => marker.remove(), 220)
      }, 1100)

      markerCleanupRef.current = () => {
        window.clearTimeout(timeoutId)
        marker.remove()
        markerCleanupRef.current = null
      }

      return true
    },
  }))

  useEffect(() => {
    if (!src || !pagesRef.current) {
      setPreviewState('idle')
      setPreviewError('')
      pageRecordsRef.current = []
      return undefined
    }

    let cancelled = false
    let loadingTask = null
    let pdfDocument = null
    const controller = new AbortController()

    const renderPreview = async () => {
      const pagesContainer = pagesRef.current
      if (!pagesContainer) return

      setPreviewState('loading')
      setPreviewError('')
      pageRecordsRef.current = []
      pagesContainer.replaceChildren()

      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF (${response.status})`)
        }

        const pdfData = new Uint8Array(await response.arrayBuffer())
        if (cancelled) return

        loadingTask = pdfjs.getDocument({
          data: pdfData,
          isImageDecoderSupported: false,
          isOffscreenCanvasSupported: false,
          useWasm: false,
        })
        pdfDocument = await loadingTask.promise
        if (cancelled) return

        const devicePixelRatio = window.devicePixelRatio || 1
        const availableWidth = Math.max(Math.min(pagesContainer.clientWidth - 48, 920), 320)

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber)
          if (cancelled) return

          const baseViewport = page.getViewport({ scale: 1 })
          const scale = (availableWidth / baseViewport.width) * zoom
          const viewport = page.getViewport({ scale })
          const textContent = await page.getTextContent()
          if (cancelled) return

          const pageShell = document.createElement('div')
          Object.assign(pageShell.style, {
            position: 'relative',
            background: '#ffffff',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
          })

          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) {
            throw new Error('Canvas context unavailable')
          }

          canvas.width = Math.floor(viewport.width * devicePixelRatio)
          canvas.height = Math.floor(viewport.height * devicePixelRatio)
          canvas.style.width = `${viewport.width}px`
          canvas.style.height = `${viewport.height}px`
          canvas.style.display = 'block'
          canvas.style.background = '#ffffff'

          context.scale(devicePixelRatio, devicePixelRatio)
          pageShell.appendChild(canvas)
          pagesContainer.appendChild(pageShell)

          const textItems = textContent.items
            .map((item) => {
              if (!('str' in item) || !item.str) return null

              const [left, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
              const itemHeight = Math.max((item.height || 12) * viewport.scale, 14)
              const itemWidth = Math.max((item.width || item.str.length * 6) * viewport.scale, 18)

              return {
                normalized: normalizeText(item.str),
                left,
                top: baseline - itemHeight,
                width: itemWidth,
                height: itemHeight,
              }
            })
            .filter(Boolean)

          pageRecordsRef.current.push({
            pageNumber,
            pageShell,
            textItems,
          })

          const renderTask = page.render({ canvasContext: context, viewport })
          await renderTask.promise
          page.cleanup()
        }

        setPreviewState('ready')
      } catch (error) {
        if (cancelled || error.name === 'AbortError') {
          return
        }

        console.error('PDF preview failed:', error)
        setPreviewState('error')
        setPreviewError(error?.message || 'Preview unavailable')
      }
    }

    void renderPreview()

    return () => {
      cancelled = true
      controller.abort()
      loadingTask?.destroy()
      pdfDocument?.destroy()
      pageRecordsRef.current = []
      if (markerCleanupRef.current) {
        markerCleanupRef.current()
      }
    }
  }, [src, zoom])

  return (
    <div ref={viewportRef} style={styles.previewViewport}>
      {previewState === 'loading' && (
        <div style={styles.previewStatus}>Rendering preview...</div>
      )}
      {previewState === 'error' && (
        <div style={styles.previewStatus}>{previewError}</div>
      )}
      <div ref={pagesRef} style={styles.previewPages} />
    </div>
  )
})

export default PdfPreview

const styles = {
  previewViewport: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    background: '#d1d5db',
  },
  previewPages: {
    minHeight: '100%',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  previewStatus: {
    paddingTop: '24px',
    textAlign: 'center',
    color: '#5a5a5a',
    fontSize: '14px',
  },
}
