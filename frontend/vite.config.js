import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// Live QuickBooks testing serves the whole app through ONE ngrok HTTPS origin
// (ngrok -> this Vite dev server -> /api proxied to the backend), so the login
// session cookie, the OAuth callback and the frontend share the same origin.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    // In "live" mode (npm run dev:live) accept any Host header so the ngrok
    // domain is never blocked. Otherwise only localhost + ngrok domains.
    allowedHosts:
      mode === 'live'
        ? true
        : ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:7004',
        changeOrigin: false,
      },
    },
  },
}))
