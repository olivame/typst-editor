import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'

const apiProxyTarget = env.API_PROXY_TARGET || env.VITE_API_URL || 'http://api:8000'
const previewProxyTarget = env.PREVIEW_PROXY_TARGET || env.VITE_PREVIEW_URL || 'http://preview:8002'
const realtimeProxyTarget = env.REALTIME_PROXY_TARGET || env.VITE_REALTIME_URL || 'ws://realtime:8003'

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
