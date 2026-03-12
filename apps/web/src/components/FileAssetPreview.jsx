import PdfPreview from './PdfPreview'

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

export default function FileAssetPreview({ path, src }) {
  const previewKind = getPreviewKind(path)

  if (previewKind === 'image') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.centerStage}>
          <img alt={path} src={src} style={styles.imagePreview} />
        </div>
      </div>
    )
  }

  if (previewKind === 'video') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.centerStage}>
          <video controls src={src} style={styles.mediaPreview} />
        </div>
      </div>
    )
  }

  if (previewKind === 'audio') {
    return (
      <div style={styles.assetViewport}>
        <div style={styles.audioShell}>
          <div style={styles.audioLabel}>Audio Preview</div>
          <audio controls src={src} style={styles.audioPreview} />
        </div>
      </div>
    )
  }

  if (previewKind === 'pdf') {
    return <PdfPreview src={src} zoom={1} />
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
