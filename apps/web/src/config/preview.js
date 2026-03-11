const DEFAULT_PREVIEW_PORT = '8002'

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

export function getPreviewBaseUrl() {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_PREVIEW_URL)
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_PREVIEW_PORT}`
  }

  return `http://localhost:${DEFAULT_PREVIEW_PORT}`
}

export const PREVIEW_URL = getPreviewBaseUrl()
