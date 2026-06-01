import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'

function buildProxyTarget(explicitUrl, scheme, host, port, fallback) {
  if (explicitUrl) return explicitUrl
  if (!host) return fallback
  return `${scheme}://${host}${port ? `:${port}` : ''}`
}

const apiProxyTarget = buildProxyTarget(
  env.API_PROXY_TARGET || env.VITE_API_URL,
  env.API_PROXY_SCHEME || env.VITE_API_SCHEME || 'http',
  env.API_PROXY_HOST || env.API_HOST || env.VITE_API_HOST,
  env.API_PROXY_PORT || env.API_PORT || env.VITE_API_PORT || '8000',
  'http://api:8000',
)
const previewProxyTarget = buildProxyTarget(
  env.PREVIEW_PROXY_TARGET || env.VITE_PREVIEW_URL,
  env.PREVIEW_PROXY_SCHEME || env.VITE_PREVIEW_SCHEME || 'http',
  env.PREVIEW_PROXY_HOST || env.PREVIEW_HOST || env.VITE_PREVIEW_HOST,
  env.PREVIEW_PROXY_PORT || env.PREVIEW_PORT || env.VITE_PREVIEW_PORT || '8002',
  'http://preview:8002',
)
const realtimeProxyTarget = buildProxyTarget(
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
        target: previewProxyTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/preview/, ''),
      },
      '/realtime': {
        target: realtimeProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
