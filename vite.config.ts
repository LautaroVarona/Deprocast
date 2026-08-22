import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      'maplibre-gl',
      'h3-js',
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/geo-layers',
      '@deck.gl/mapbox',
    ],
    esbuildOptions: {
      target: 'es2022',
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        // Uploads grandes (m4a 100–200 MB): sin timeout del proxy
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
