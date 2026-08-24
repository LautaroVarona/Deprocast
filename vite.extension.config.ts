import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { deflateSync } from 'node:zlib'

const root = dirname(fileURLToPath(import.meta.url))

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    }
  }
  return (~c) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Icono 128×128: marco oro sobre fondo oscuro. */
function makeIconPng(size = 128): Buffer {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  const inset = Math.round(size * 0.18)
  const lid = Math.round(size * 0.42)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < size; x++) {
      const i = y * stride + 1 + x * 4
      const inBox =
        x >= inset && x < size - inset && y >= inset && y < size - inset
      if (inBox) {
        const gold = y < lid
        raw[i] = gold ? 0xd4 : 0xc4
        raw[i + 1] = gold ? 0xb3 : 0xa3
        raw[i + 2] = gold ? 0x6a : 0x5a
        raw[i + 3] = 255
      } else {
        raw[i] = 0x0e
        raw[i + 1] = 0x10
        raw[i + 2] = 0x12
        raw[i + 3] = 255
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    target: 'chrome116',
    rollupOptions: {
      input: {
        sw: resolve(root, 'extension/sw.ts'),
        offscreen: resolve(root, 'extension/offscreen.ts'),
        popup: resolve(root, 'extension/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'cofre-static',
      closeBundle() {
        const dest = resolve(root, 'dist-extension')
        copyFileSync(resolve(root, 'extension/manifest.json'), resolve(dest, 'manifest.json'))
        copyFileSync(resolve(root, 'extension/popup.html'), resolve(dest, 'popup.html'))
        copyFileSync(resolve(root, 'extension/popup.css'), resolve(dest, 'popup.css'))
        copyFileSync(
          resolve(root, 'extension/offscreen.html'),
          resolve(dest, 'offscreen.html'),
        )
        mkdirSync(resolve(dest, 'icons'), { recursive: true })
        writeFileSync(resolve(dest, 'icons/cofre.png'), makeIconPng(128))
      },
    },
  ],
})
