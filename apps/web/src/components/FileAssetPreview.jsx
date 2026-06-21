import { useEffect, useState } from 'react'
import PdfPreview from './PdfPreview'
import { getAuthToken } from '../services/projects'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
const PDF_EXTENSIONS = new Set(['pdf'])

function getExtension(path) {
  const parts = `${path || ''}`.split('.')
  return parts.length > 1 ? parts.at(-1).toLowerCase() : ''
}

function getPreviewKind(path) {
  const extension = getExtension(path)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (PDF_EXTENSIONS.has(extension)) return 'pdf'
  return 'unknown'
}

export default function FileAssetPreview({ path, src, zoom = 1 }) {
  const previewKind = getPreviewKind(path)
  const [assetUrl, setAssetUrl] = useState('')
  const [assetState, setAssetState] = useState('idle')
  const [assetError, setAssetError] = useState('')

  useEffect(() => {
    if (!src || previewKind === 'unknown') {
      setAssetUrl('')
      setAssetState('idle')
      setAssetError('')
      return undefined
    }

    let cancelled = false
    let objectUrl = ''
    const controller = new AbortController()

    async function loadAsset() {
      setAssetUrl('')
      setAssetState('loading')
      setAssetError('')

      try {
        const token = getAuthToken()
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to load file preview (${response.status})`)
        }

        const blob = await response.blob()
        if (cancelled) return

        objectUrl = window.URL.createObjectURL(blob)
        setAssetUrl(objectUrl)
        setAssetState('ready')
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return
        setAssetUrl('')
        setAssetState('error')
        setAssetError(error?.message || 'Preview unavailable')
      }
    }

    void loadAsset()

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl)
      }
    }
  }, [src, previewKind])

  if (previewKind !== 'unknown' && assetState !== 'ready') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.unsupportedCard}>
          <div style={styles.unsupportedTitle}>
            {assetState === 'error' ? 'Preview unavailable' : 'Loading preview'}
          </div>
          {assetState === 'error' ? (
            <div style={styles.unsupportedText}>{assetError}</div>
          ) : null}
          <div style={styles.unsupportedMeta}>{path}</div>
        </div>
      </div>
    )
  }

  if (previewKind === 'image') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.centerStage}>
          <div
            style={{
              ...styles.scaledStage,
              transform: `scale(${zoom})`,
            }}
          >
            <img alt={path} src={assetUrl} style={styles.imagePreview} />
          </div>
        </div>
      </div>
    )
  }

  if (previewKind === 'video') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.centerStage}>
          <div
            style={{
              ...styles.scaledStage,
              transform: `scale(${zoom})`,
            }}
          >
            <video controls src={assetUrl} style={styles.mediaPreview} />
          </div>
        </div>
      </div>
    )
  }

  if (previewKind === 'audio') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.audioShell}>
          <div style={styles.audioLabel}>Audio Preview</div>
          <audio controls src={assetUrl} style={styles.audioPreview} />
        </div>
      </div>
    )
  }

  if (previewKind === 'pdf') {
    return <PdfPreview src={assetUrl} zoom={zoom} />
  }

  return (
    <div style={styles.assetViewport}>
      <div style={styles.unsupportedCard}>
        <div style={styles.unsupportedTitle}>Preview unavailable</div>
        <div style={styles.unsupportedText}>
          This file type is not previewable in the browser yet.
        </div>
        <div style={styles.unsupportedMeta}>{path}</div>
      </div>
    </div>
  )
}

const styles = {
  assetViewport: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    background: '#eef1f5',
    padding: '20px',
  },
  centerStage: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaledStage: {
    transformOrigin: 'center center',
  },
  imagePreview: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: '16px',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.14)',
    background: '#ffffff',
  },
  mediaPreview: {
    width: 'min(100%, 960px)',
    maxHeight: '100%',
    borderRadius: '16px',
    background: '#000000',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.2)',
  },
  audioShell: {
    maxWidth: '520px',
    margin: '0 auto',
    padding: '24px',
    borderRadius: '18px',
    background: '#ffffff',
    border: '1px solid #d8dee8',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.12)',
  },
  audioLabel: {
    marginBottom: '14px',
    fontSize: '13px',
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  audioPreview: {
    width: '100%',
  },
  unsupportedCard: {
    maxWidth: '420px',
    margin: '72px auto',
    padding: '20px',
    borderRadius: '18px',
    background: '#ffffff',
    border: '1px solid #d8dee8',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.1)',
  },
  unsupportedTitle: {
    fontSize: '16px',
    fontWeight: '800',
    color: '#1f2937',
  },
  unsupportedText: {
    marginTop: '8px',
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#64748b',
  },
  unsupportedMeta: {
    marginTop: '12px',
    fontSize: '12px',
    color: '#94a3b8',
    wordBreak: 'break-word',
  },
}
