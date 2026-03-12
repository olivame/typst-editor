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

  useImperativeHandle(ref, () => ({
    revealCursor(payload) {
      return postPreviewMessage({ type: 'revealCursor', payload })
    },
  }))

  useEffect(() => {
    if (frameState !== 'ready') return
    postPreviewMessage({ type: 'setZoom', zoom })
  }, [frameState, zoom])

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
        onZoomChange(message.payload?.zoom ?? 1)
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
            postPreviewMessage({ type: 'setZoom', zoom })
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
