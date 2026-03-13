const DEFAULT_PREVIEW_PORT = '8002'

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]'
}

export function getPreviewBaseUrl() {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_PREVIEW_URL)
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    if (isLocalHostname(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_PREVIEW_PORT}`
    }

    return `${window.location.origin}/preview`
  }

  return `http://localhost:${DEFAULT_PREVIEW_PORT}`
}

export const PREVIEW_URL = getPreviewBaseUrl()
