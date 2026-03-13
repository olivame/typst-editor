import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.API_PROXY_TARGET || process.env.VITE_API_URL || 'http://api:8000'
const previewProxyTarget = process.env.PREVIEW_PROXY_TARGET || process.env.VITE_PREVIEW_URL || 'http://preview:8002'

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
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
