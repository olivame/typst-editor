import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

const TinymistPreview = forwardRef(function TinymistPreview(
  { onJumpToSource, onZoomChange, src, zoom = 1 },
  ref,
) {
  const iframeRef = useRef(null)
  const lastSentZoomRef = useRef(Number.NaN)
  const pendingZoomTargetRef = useRef(null)
  const suppressZoomEchoUntilRef = useRef(0)
  const [frameState, setFrameState] = useState('loading')

  const targetOrigin = useMemo(() => {
    try {
      return new URL(src, window.location.href).origin
    } catch {
      return '*'
    }
  }, [src])

  const postMessage = (message) => {
    const contentWindow = iframeRef.current?.contentWindow
    if (!contentWindow) return false
    contentWindow.postMessage(message, targetOrigin)
    return true
  }
  const postPreviewMessage = useEffectEvent((message) => postMessage(message))
  const sendZoomToPreview = useEffectEvent((nextZoom, force = false) => {
    const normalizedZoom = Number(nextZoom) || 1
    if (!force && Math.abs(lastSentZoomRef.current - normalizedZoom) < 0.0001) {
      return false
    }

    lastSentZoomRef.current = normalizedZoom
    pendingZoomTargetRef.current = normalizedZoom
    suppressZoomEchoUntilRef.current = Date.now() + 2200
    return postPreviewMessage({ type: 'setZoom', zoom: normalizedZoom })
  })

  useImperativeHandle(ref, () => ({
    revealCursor(payload) {
      return postPreviewMessage({ type: 'revealCursor', payload })
    },
  }))

  useEffect(() => {
    if (frameState !== 'ready') return
    sendZoomToPreview(zoom)
  }, [frameState, sendZoomToPreview, zoom])

  useEffect(() => {
    if (!onJumpToSource && !onZoomChange) return undefined

    const handleWindowMessage = (event) => {
      if (event.origin !== targetOrigin) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      if (message.type === 'editorScrollTo') {
        onJumpToSource(message.payload)
      }
      if (message.type === 'previewZoomChange' && onZoomChange) {
        const nextZoom = message.payload?.zoom ?? 1
        const pendingZoomTarget = pendingZoomTargetRef.current

        if (Number.isFinite(pendingZoomTarget)) {
          if (Math.abs(nextZoom - pendingZoomTarget) < 0.05) {
            pendingZoomTargetRef.current = null
            suppressZoomEchoUntilRef.current = 0
            return
          }

          if (Date.now() < suppressZoomEchoUntilRef.current) {
            return
          }

          pendingZoomTargetRef.current = null
        }

        if (
          Date.now() < suppressZoomEchoUntilRef.current
          && Math.abs(nextZoom - lastSentZoomRef.current) < 0.05
        ) {
          return
        }
        onZoomChange(nextZoom)
      }
    }

    window.addEventListener('message', handleWindowMessage)
    return () => window.removeEventListener('message', handleWindowMessage)
  }, [onJumpToSource, onZoomChange, targetOrigin])

  return (
    <div style={styles.previewViewport}>
      {frameState !== 'ready' ? (
        <div style={styles.previewStatus}>
          {frameState === 'error' ? 'Preview unavailable' : 'Loading preview...'}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        onError={() => setFrameState('error')}
        onLoad={() => {
          setFrameState('ready')
          window.setTimeout(() => {
            sendZoomToPreview(zoom, true)
          }, 0)
        }}
        src={src}
        style={{
          ...styles.iframe,
          opacity: frameState === 'ready' ? 1 : 0,
        }}
        title="Typst Preview"
      />
    </div>
  )
})

export default TinymistPreview

const styles = {
  previewViewport: {
    position: 'relative',
    display: 'flex',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#d1d5db',
  },
  iframe: {
    display: 'block',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    background: '#d1d5db',
    transition: 'opacity 160ms ease',
  },
  previewStatus: {
    position: 'absolute',
    inset: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#516173',
    fontSize: '14px',
    fontWeight: '600',
    textAlign: 'center',
    zIndex: 1,
    pointerEvents: 'none',
  },
}
