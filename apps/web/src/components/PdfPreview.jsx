import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export default function PdfPreview({ src }) {
  const containerRef = useRef(null)
  const [previewState, setPreviewState] = useState('idle')
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!src || !containerRef.current) {
      setPreviewState('idle')
      setPreviewError('')
      return undefined
    }

    let cancelled = false
    let loadingTask = null
    let pdfDocument = null
    const controller = new AbortController()

    const renderPreview = async () => {
      const container = containerRef.current
      if (!container) return

      setPreviewState('loading')
      setPreviewError('')
      container.replaceChildren()

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
        const availableWidth = Math.max(Math.min(container.clientWidth - 48, 920), 320)

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber)
          if (cancelled) return

          const baseViewport = page.getViewport({ scale: 1 })
          const scale = availableWidth / baseViewport.width
          const viewport = page.getViewport({ scale })

          const pageShell = document.createElement('div')
          Object.assign(pageShell.style, {
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
          container.appendChild(pageShell)

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

    renderPreview()

    return () => {
      cancelled = true
      controller.abort()
      loadingTask?.destroy()
      pdfDocument?.destroy()
    }
  }, [src])

  return (
    <div style={styles.previewViewport}>
      {previewState === 'loading' && (
        <div style={styles.previewStatus}>Rendering preview...</div>
      )}
      {previewState === 'error' && (
        <div style={styles.previewStatus}>{previewError}</div>
      )}
      <div ref={containerRef} style={styles.previewPages} />
    </div>
  )
}

const styles = {
  previewViewport: { width: '100%', height: '100%', overflow: 'auto', background: '#d1d5db' },
  previewPages: { minHeight: '100%', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' },
  previewStatus: { paddingTop: '24px', textAlign: 'center', color: '#5a5a5a', fontSize: '14px' },
}
