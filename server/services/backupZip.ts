import type { Response } from 'express'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import {
  FEEDBACK_DIR,
  serializeBackupJson,
  VAULT_DIR,
  type BackupDump,
} from './backup.js'

const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const ZIP64_SENTINEL = 0xffffffff

type ZipCdEntry = {
  name: string
  method: number
  compactSize: number
  uncompSize: number
  localOffset: number
}

export type MediaCopyStats = {
  copied: number
  skipped: number
}

function walkFiles(root: string): Array<{ rel: string; size: number; mtime: string }> {
  if (!fs.existsSync(root)) return []
  const out: Array<{ rel: string; size: number; mtime: string }> = []
  const walk = (dir: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(abs)
        continue
      }
      if (!ent.isFile()) continue
      try {
        const st = fs.statSync(abs)
        out.push({
          rel: path.relative(root, abs).replaceAll('\\', '/'),
          size: st.size,
          mtime: st.mtime.toISOString(),
        })
      } catch {
        /* ignore */
      }
    }
  }
  walk(root)
  return out
}

export function streamBackupZip(
  dump: BackupDump,
  filename: string,
  res: Response,
): void {
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  )

  const archive = archiver('zip', { zlib: { level: 1 } })
  archive.on('error', (err) => {
    console.error('[backup/zip]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Error al exportar ZIP' })
    } else {
      res.end()
    }
  })
  archive.pipe(res)
  archive.append(serializeBackupJson(dump), { name: 'dump.json' })
  if (fs.existsSync(VAULT_DIR)) {
    archive.directory(VAULT_DIR, 'vault')
  }
  if (fs.existsSync(FEEDBACK_DIR)) {
    archive.directory(FEEDBACK_DIR, 'feedback')
  }
  void archive.finalize()
}

function readU16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off)
}

function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off)
}

function findEocd(
  fd: number,
  fileSize: number,
): { cdOffset: number; cdSize: number; entries: number } {
  const maxScan = Math.min(fileSize, 65535 + 22)
  if (maxScan < 22) {
    throw new Error('ZIP inválido: archivo demasiado corto')
  }
  const buf = Buffer.alloc(maxScan)
  fs.readSync(fd, buf, 0, maxScan, fileSize - maxScan)
  for (let i = buf.length - 22; i >= 0; i--) {
    if (readU32(buf, i) !== EOCD_SIG) continue
    const commentLen = readU16(buf, i + 20)
    if (i + 22 + commentLen !== buf.length) continue
    const cdOffset = readU32(buf, i + 16)
    const cdSize = readU32(buf, i + 12)
    if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL) {
      throw new Error(
        'ZIP demasiado grande (ZIP64). Usá el JSON y copiá vault/ a mano.',
      )
    }
    return {
      entries: readU16(buf, i + 10),
      cdSize,
      cdOffset,
    }
  }
  throw new Error('ZIP inválido: no se encontró directorio central')
}

function readCentralDirectory(fd: number, fileSize: number): ZipCdEntry[] {
  const eocd = findEocd(fd, fileSize)
  const cd = Buffer.alloc(eocd.cdSize)
  const n = fs.readSync(fd, cd, 0, eocd.cdSize, eocd.cdOffset)
  if (n !== eocd.cdSize) {
    throw new Error('ZIP inválido: directorio central incompleto')
  }
  const out: ZipCdEntry[] = []
  let off = 0
  while (off + 46 <= cd.length) {
    if (readU32(cd, off) !== CD_SIG) {
      throw new Error('ZIP inválido: firma de directorio central')
    }
    const method = readU16(cd, off + 10)
    const compactSize = readU32(cd, off + 20)
    const uncompSize = readU32(cd, off + 24)
    const nameLen = readU16(cd, off + 28)
    const extraLen = readU16(cd, off + 30)
    const commentLen = readU16(cd, off + 32)
    const localOffset = readU32(cd, off + 42)
    if (localOffset === ZIP64_SENTINEL || compactSize === ZIP64_SENTINEL) {
      throw new Error(
        'ZIP demasiado grande (ZIP64). Usá el JSON y copiá vault/ a mano.',
      )
    }
    const nameStart = off + 46
    const name = cd.subarray(nameStart, nameStart + nameLen).toString('utf8')
    out.push({ name, method, compactSize, uncompSize, localOffset })
    off = nameStart + nameLen + extraLen + commentLen
  }
  return out
}

function localDataOffset(fd: number, localOffset: number): number {
  const hdr = Buffer.alloc(30)
  fs.readSync(fd, hdr, 0, 30, localOffset)
  if (readU32(hdr, 0) !== LOCAL_SIG) {
    throw new Error('ZIP inválido: firma de archivo local')
  }
  const nameLen = readU16(hdr, 26)
  const extraLen = readU16(hdr, 28)
  return localOffset + 30 + nameLen + extraLen
}

function safeExtractPath(root: string, rel: string): string {
  const cleaned = rel.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.endsWith('/')) {
    throw new Error('Ruta ZIP vacía')
  }
  if (cleaned.split('/').some((p) => p === '..' || p === '')) {
    throw new Error(`ZIP path traversal: ${rel}`)
  }
  const abs = path.resolve(root, cleaned)
  const base = path.resolve(root)
  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  if (abs !== base && !abs.startsWith(prefix)) {
    throw new Error(`ZIP path traversal: ${rel}`)
  }
  return abs
}

async function extractEntry(
  zipPath: string,
  entry: ZipCdEntry,
  destAbs: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  if (entry.compactSize === 0) {
    fs.writeFileSync(destAbs, Buffer.alloc(0))
    return
  }
  const fd = fs.openSync(zipPath, 'r')
  let start: number
  try {
    start = localDataOffset(fd, entry.localOffset)
  } finally {
    fs.closeSync(fd)
  }
  const end = start + entry.compactSize - 1
  const read = fs.createReadStream(zipPath, { start, end })
  const write = fs.createWriteStream(destAbs)
  if (entry.method === 0) {
    await pipeline(read, write)
    return
  }
  if (entry.method === 8) {
    await pipeline(read, zlib.createInflateRaw(), write)
    return
  }
  read.destroy()
  write.destroy()
  throw new Error(`Compresión ZIP no soportada (${entry.method}) en ${entry.name}`)
}

export async function extractZip(
  zipPath: string,
  destDir: string,
): Promise<{ files: number }> {
  fs.mkdirSync(destDir, { recursive: true })
  const st = fs.statSync(zipPath)
  const fd = fs.openSync(zipPath, 'r')
  let entries: ZipCdEntry[]
  try {
    entries = readCentralDirectory(fd, st.size)
  } finally {
    fs.closeSync(fd)
  }
  let files = 0
  for (const entry of entries) {
    const name = entry.name.replaceAll('\\', '/')
    if (!name || name.endsWith('/')) continue
    const destAbs = safeExtractPath(destDir, name)
    await extractEntry(zipPath, entry, destAbs)
    files++
  }
  return { files }
}

export function findBackupDumpJson(extractRoot: string): string {
  const direct = path.join(extractRoot, 'dump.json')
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
  const walk = (dir: string, depth: number): string | null => {
    if (depth < 0) return null
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name)
      if (ent.isFile() && ent.name === 'dump.json') return abs
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue
      const found = walk(path.join(dir, ent.name), depth - 1)
      if (found) return found
    }
    return null
  }
  const found = walk(extractRoot, 2)
  if (!found) {
    throw new Error('El ZIP no contiene dump.json')
  }
  return found
}

function copyMissingTree(fromDir: string, toDir: string): MediaCopyStats {
  const stats: MediaCopyStats = { copied: 0, skipped: 0 }
  if (!fs.existsSync(fromDir)) return stats
  const files = walkFiles(fromDir)
  for (const file of files) {
    const dest = path.join(toDir, file.rel)
    if (fs.existsSync(dest)) {
      stats.skipped++
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(fromDir, file.rel), dest)
    stats.copied++
  }
  return stats
}

export function copyMissingMedia(extractRoot: string): MediaCopyStats {
  const vault = copyMissingTree(path.join(extractRoot, 'vault'), VAULT_DIR)
  const feedback = copyMissingTree(
    path.join(extractRoot, 'feedback'),
    FEEDBACK_DIR,
  )
  return {
    copied: vault.copied + feedback.copied,
    skipped: vault.skipped + feedback.skipped,
  }
}
