import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function localToken(): string {
  const env = (process.env.LOCAL_API_TOKEN || '').replace(/^["']|["']$/g, '').trim()
  if (env) return env
  const file = path.resolve('data/local-token')
  try {
    const disk = fs.readFileSync(file, 'utf8').trim()
    if (disk) return disk
  } catch {
    /* first boot */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const token = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(file, token, { encoding: 'utf8' })
  return token
}

const token = localToken()

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
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      'three-stdlib',
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
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('X-Deprocast-Token', token)
          })
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('X-Deprocast-Token', token)
          })
        },
      },
    },
  },
})
