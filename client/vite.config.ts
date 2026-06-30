import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      // Proxy Supabase through the dev origin so the browser talks to it
      // same-origin (no CORS). The local Supabase returns `Access-Control-Allow-
      // Origin: *` together with `Allow-Credentials: true`, which browsers reject
      // for credentialed requests (e.g. password reset). Same-origin sidesteps it.
      '/sb': {
        target: 'http://127.0.0.1:54740',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/sb/, ''),
      },
    },
  },
})
