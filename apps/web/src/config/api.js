const DEFAULT_API_PORT = '8000'

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

export function getApiBaseUrl() {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL)
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`
  }

  return `http://localhost:${DEFAULT_API_PORT}`
}

export const API_URL = getApiBaseUrl()
