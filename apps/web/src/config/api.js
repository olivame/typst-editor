const DEFAULT_API_PORT = '8000'

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]'
}

export function getApiBaseUrl() {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL)
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    if (isLocalHostname(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`
    }

    return `${window.location.origin}/api`
  }

  return `http://localhost:${DEFAULT_API_PORT}`
}

export const API_URL = getApiBaseUrl()
