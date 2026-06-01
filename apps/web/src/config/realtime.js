const DEFAULT_REALTIME_PORT = '8003'

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]'
}

function getDefaultRealtimeScheme() {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') return 'wss'
  return 'ws'
}

function buildEnvUrl() {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_REALTIME_URL)
  if (envUrl) return envUrl

  const envHost = `${import.meta.env.VITE_REALTIME_HOST || ''}`.trim()
  if (!envHost) return ''

  const scheme = `${import.meta.env.VITE_REALTIME_SCHEME || getDefaultRealtimeScheme()}`.replace(/:+$/, '') || getDefaultRealtimeScheme()
  const port = `${import.meta.env.VITE_REALTIME_PORT || DEFAULT_REALTIME_PORT}`.trim()
  return `${scheme}://${envHost}${port ? `:${port}` : ''}`
}

export function getRealtimeBaseUrl() {
  const envUrl = buildEnvUrl()
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    if (isLocalHostname(window.location.hostname)) {
      return `${protocol}//${window.location.hostname}:${DEFAULT_REALTIME_PORT}`
    }

    return `${protocol}//${window.location.host}/realtime`
  }

  return `ws://localhost:${DEFAULT_REALTIME_PORT}`
}

export const REALTIME_URL = getRealtimeBaseUrl()
