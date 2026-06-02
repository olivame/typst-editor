import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'

function splitCsv(value) {
  return `${value || ''}`
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeUrl(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

function buildProxyTarget(explicitUrl, scheme, host, port, fallback) {
  if (explicitUrl) return explicitUrl
  if (!host) return fallback
  return `${scheme}://${host}${port ? `:${port}` : ''}`
}

function buildProxyTargets(explicitTargets, explicitUrl, scheme, host, port, fallback) {
  const targets = splitCsv(explicitTargets).map(normalizeUrl)
  if (targets.length > 0) return targets

  return [normalizeUrl(buildProxyTarget(explicitUrl, scheme, host, port, fallback))]
}

function extractPathname(rawUrl) {
  try {
    return new URL(rawUrl || '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(`${value || ''}`, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function chooseStableTarget(targets, key) {
  if (targets.length === 0) return ''
  if (targets.length === 1) return targets[0]

  const normalizedKey = key > 0 ? key : 1
  return targets[(normalizedKey - 1) % targets.length]
}

function resolvePreviewProxyTarget(rawUrl, targets) {
  const pathname = extractPathname(rawUrl)
  const match = pathname.match(/^\/(?:preview\/)?sessions\/(\d+)(?:\/|$)/)
  return chooseStableTarget(targets, toPositiveInteger(match?.[1]))
}

function resolveRealtimeProxyTarget(rawUrl, targets) {
  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl || '/', 'http://localhost')
  } catch {
    return chooseStableTarget(targets, 1)
  }

  const fileId = toPositiveInteger(parsedUrl.searchParams.get('fileId'))
  if (fileId > 0) {
    return chooseStableTarget(targets, fileId)
  }

  const roomMatch = parsedUrl.pathname.match(/file:(\d+)/)
  return chooseStableTarget(targets, toPositiveInteger(roomMatch?.[1]))
}

function configureDynamicProxy(proxy, resolver) {
  const proxyWeb = proxy.web.bind(proxy)
  const proxyWs = proxy.ws.bind(proxy)

  proxy.web = (request, response, options = {}) => proxyWeb(request, response, {
    ...options,
    target: resolver(request.url, options.target),
  })

  proxy.ws = (request, socket, head, options = {}) => proxyWs(request, socket, head, {
    ...options,
    target: resolver(request.url, options.target),
  })
}

const apiProxyTarget = buildProxyTarget(
  env.API_PROXY_TARGET || env.VITE_API_URL,
  env.API_PROXY_SCHEME || env.VITE_API_SCHEME || 'http',
  env.API_PROXY_HOST || env.API_HOST || env.VITE_API_HOST,
  env.API_PROXY_PORT || env.API_PORT || env.VITE_API_PORT || '8000',
  'http://api:8000',
)
const previewProxyTargets = buildProxyTargets(
  env.PREVIEW_PROXY_TARGETS,
  env.PREVIEW_PROXY_TARGET || env.VITE_PREVIEW_URL,
  env.PREVIEW_PROXY_SCHEME || env.VITE_PREVIEW_SCHEME || 'http',
  env.PREVIEW_PROXY_HOST || env.PREVIEW_HOST || env.VITE_PREVIEW_HOST,
  env.PREVIEW_PROXY_PORT || env.PREVIEW_PORT || env.VITE_PREVIEW_PORT || '8002',
  'http://preview:8002',
)
const realtimeProxyTargets = buildProxyTargets(
  env.REALTIME_PROXY_TARGETS,
  env.REALTIME_PROXY_TARGET || env.VITE_REALTIME_URL,
  env.REALTIME_PROXY_SCHEME || env.VITE_REALTIME_SCHEME || 'ws',
  env.REALTIME_PROXY_HOST || env.REALTIME_HOST || env.VITE_REALTIME_HOST,
  env.REALTIME_PROXY_PORT || env.REALTIME_PORT || env.VITE_REALTIME_PORT || '8003',
  'ws://realtime:8003',
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/preview': {
        target: previewProxyTargets[0],
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/preview/, ''),
        configure(proxy) {
          configureDynamicProxy(proxy, (requestUrl, fallbackTarget) => (
            resolvePreviewProxyTarget(requestUrl, previewProxyTargets) || fallbackTarget || previewProxyTargets[0]
          ))
        },
      },
      '/realtime': {
        target: realtimeProxyTargets[0],
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          configureDynamicProxy(proxy, (requestUrl, fallbackTarget) => (
            resolveRealtimeProxyTarget(requestUrl, realtimeProxyTargets) || fallbackTarget || realtimeProxyTargets[0]
          ))
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
