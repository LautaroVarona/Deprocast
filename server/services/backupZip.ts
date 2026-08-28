import type { Response } from 'express'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import zlib from 'node:zlib'
import {
  FEEDBACK_DIR,
  serializeBackupJson,
  VAULT_DIR,
  type BackupDump,
} from './backup.js'
import { maybeEncryptDump } from './backupCrypto.js'
import {
  fileFingerprint,
  resolveContained,
} from './paths.js'
import { assertZipBudget, ZIP_LIMITS } from './zipLimits.js'

const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')

const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CD_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const ZIP64_SENTINEL = 0xffffffff
const ZIP64_EXTRA_ID = 0x0001

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
  conflicts: number
  failed: number
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
  const payload = maybeEncryptDump(serializeBackupJson(dump))
  archive.append(payload.body, { name: payload.name })
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

function readU64(buf: Buffer, off: number): number {
  const v = buf.readBigUInt64LE(off)
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ZIP demasiado grande para este lector')
  }
  return Number(v)
}

function parseZip64Extra(
  extra: Buffer,
  compactSize: number,
  uncompSize: number,
  localOffset: number,
): { compactSize: number; uncompSize: number; localOffset: number } {
  let off = 0
  while (off + 4 <= extra.length) {
    const id = readU16(extra, off)
    const size = readU16(extra, off + 2)
    const data = extra.subarray(off + 4, off + 4 + size)
    off += 4 + size
    if (id !== ZIP64_EXTRA_ID) continue
    let p = 0
    if (uncompSize === ZIP64_SENTINEL && p + 8 <= data.length) {
      uncompSize = readU64(data, p)
      p += 8
    }
    if (compactSize === ZIP64_SENTINEL && p + 8 <= data.length) {
      compactSize = readU64(data, p)
      p += 8
    }
    if (localOffset === ZIP64_SENTINEL && p + 8 <= data.length) {
      localOffset = readU64(data, p)
    }
  }
  return { compactSize, uncompSize, localOffset }
}

function readZip64Eocd(
  fd: number,
  eocdAbs: number,
): { cdOffset: number; cdSize: number; entries: number } {
  if (eocdAbs < 20) {
    throw new Error('ZIP inválido: locator ZIP64 ausente')
  }
  const loc = Buffer.alloc(20)
  fs.readSync(fd, loc, 0, 20, eocdAbs - 20)
  if (readU32(loc, 0) !== ZIP64_LOCATOR_SIG) {
    throw new Error('ZIP inválido: no se encontró locator ZIP64')
  }
  const zip64Off = readU64(loc, 8)
  const hdr = Buffer.alloc(56)
  const n = fs.readSync(fd, hdr, 0, 56, zip64Off)
  if (n < 56 || readU32(hdr, 0) !== ZIP64_EOCD_SIG) {
    throw new Error('ZIP inválido: registro ZIP64')
  }
  return {
    entries: readU64(hdr, 32),
    cdSize: readU64(hdr, 40),
    cdOffset: readU64(hdr, 48),
  }
}

function findEocd(
  fd: number,
  fileSize: number,
): { cdOffset: number; cdSize: number; entries: number } {
  const maxScan = Math.min(fileSize, 65535 + 22)
  if (maxScan < 22) {
    throw new Error(
      `ZIP inválido: archivo demasiado corto (${fileSize} bytes). Está vacío o no terminó de copiarse.`,
    )
  }
  const buf = Buffer.alloc(maxScan)
  fs.readSync(fd, buf, 0, maxScan, fileSize - maxScan)
  for (let i = buf.length - 22; i >= 0; i--) {
    if (readU32(buf, i) !== EOCD_SIG) continue
    const commentLen = readU16(buf, i + 20)
    if (i + 22 + commentLen !== buf.length) continue
    const cdOffset = readU32(buf, i + 16)
    const cdSize = readU32(buf, i + 12)
    const entries = readU16(buf, i + 10)
    if (
      cdOffset === ZIP64_SENTINEL ||
      cdSize === ZIP64_SENTINEL ||
      entries === 0xffff
    ) {
      const eocdAbs = fileSize - maxScan + i
      return readZip64Eocd(fd, eocdAbs)
    }
    return { entries, cdSize, cdOffset }
  }
  throw new Error('ZIP inválido: no se encontró directorio central')
}

function readCentralDirectory(fd: number, fileSize: number): ZipCdEntry[] {
  const eocd = findEocd(fd, fileSize)
  if (eocd.cdSize <= 0) return []
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
    let compactSize = readU32(cd, off + 20)
    let uncompSize = readU32(cd, off + 24)
    const nameLen = readU16(cd, off + 28)
    const extraLen = readU16(cd, off + 30)
    const commentLen = readU16(cd, off + 32)
    let localOffset = readU32(cd, off + 42)
    const nameStart = off + 46
    const name = cd.subarray(nameStart, nameStart + nameLen).toString('utf8')
    const extra = cd.subarray(
      nameStart + nameLen,
      nameStart + nameLen + extraLen,
    )
    if (
      compactSize === ZIP64_SENTINEL ||
      uncompSize === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL
    ) {
      const z = parseZip64Extra(extra, compactSize, uncompSize, localOffset)
      compactSize = z.compactSize
      uncompSize = z.uncompSize
      localOffset = z.localOffset
    }
    if (localOffset === ZIP64_SENTINEL || compactSize === ZIP64_SENTINEL) {
      throw new Error(
        'ZIP ZIP64 incompleto. Exportá JSON y copiá vault/ a mano.',
      )
    }
    out.push({ name, method, compactSize, uncompSize, localOffset })
    off = nameStart + nameLen + extraLen + commentLen
  }
  return out
}

function listZipEntries(zipPath: string): ZipCdEntry[] {
  const st = fs.statSync(zipPath)
  const fd = fs.openSync(zipPath, 'r')
  try {
    return readCentralDirectory(fd, st.size)
  } finally {
    fs.closeSync(fd)
  }
}

function zipRel(name: string): string {
  return name.replaceAll('\\', '/').replace(/^\/+/, '')
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

function limitingWriter(maxBytes: number): Transform {
  let n = 0
  return new Transform({
    transform(chunk, _enc, cb) {
      n += (chunk as Buffer).length
      if (n > maxBytes) {
        cb(new Error('ZIP excedió el tamaño descomprimido máximo'))
        return
      }
      cb(null, chunk)
    },
  })
}

function safeExtractPath(root: string, rel: string): string {
  return resolveContained(root, rel)
}

async function extractEntry(
  zipPath: string,
  entry: ZipCdEntry,
  destAbs: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  if (entry.compactSize === 0) {
    if (entry.uncompSize > 0) {
      throw new Error(`ZIP tamaño declarado inconsistente: ${entry.name}`)
    }
    fs.writeFileSync(destAbs, Buffer.alloc(0))
    return
  }
  const cap = Math.min(
    entry.uncompSize > 0 ? entry.uncompSize : ZIP_LIMITS.maxFileUncomp,
    ZIP_LIMITS.maxFileUncomp,
  )
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
  const limit = limitingWriter(cap)
  try {
    if (entry.method === 0) {
      await pipeline(read, limit, write)
      return
    }
    if (entry.method === 8) {
      await pipeline(read, zlib.createInflateRaw(), limit, write)
      return
    }
  } catch (err) {
    try {
      write.destroy()
      read.destroy()
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(destAbs)
    } catch {
      /* ignore */
    }
    throw err
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
  const entries = listZipEntries(zipPath)
  assertZipBudget(entries)
  let files = 0
  for (const entry of entries) {
    const name = zipRel(entry.name)
    if (!name || name.endsWith('/')) continue
    const destAbs = safeExtractPath(destDir, name)
    await extractEntry(zipPath, entry, destAbs)
    files++
  }
  return { files }
}

function looksLikeBackupJson(abs: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown
    return Boolean(
      raw &&
        typeof raw === 'object' &&
        (raw as { format?: unknown }).format === 'deprocast-backup',
    )
  } catch {
    return false
  }
}

export function findBackupDumpJson(extractRoot: string): string {
  const direct = path.join(extractRoot, 'dump.json')
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
  const walk = (dir: string, depth: number): string[] => {
    if (depth < 0) return []
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files: string[] = []
    for (const ent of ents) {
      const abs = path.join(dir, ent.name)
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
        files.push(abs)
      }
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue
      files.push(...walk(path.join(dir, ent.name), depth - 1))
    }
    return files
  }
  const jsons = walk(extractRoot, 2)
  const named = jsons.find((p) => path.basename(p).toLowerCase() === 'dump.json')
  if (named) return named
  const backup = jsons.find((p) => looksLikeBackupJson(p))
  if (backup) return backup
  throw new Error(
    'El ZIP no contiene dump.json. Usá el ZIP o JSON de Respaldo, no un ZIP suelto del vault.',
  )
}

/** Extrae solo el dump JSON. La media se copia después, archivo por archivo. */
export async function extractDumpJsonFromZip(
  zipPath: string,
  destDir: string,
): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true })
  const entries = listZipEntries(zipPath)
  assertZipBudget(entries)
  const dumpEntry = entries.find((e) => {
    const n = zipRel(e.name)
    return (
      n === 'dump.json' ||
      n.endsWith('/dump.json') ||
      n === 'dump.json.enc' ||
      n.endsWith('/dump.json.enc')
    )
  })
  if (dumpEntry) {
    const abs = path.join(destDir, 'dump.json')
    await extractEntry(zipPath, dumpEntry, abs)
    return abs
  }
  const jsons = entries.filter((e) =>
    zipRel(e.name).toLowerCase().endsWith('.json'),
  )
  for (const entry of jsons) {
    const abs = safeExtractPath(destDir, zipRel(entry.name))
    await extractEntry(zipPath, entry, abs)
    if (looksLikeBackupJson(abs)) return abs
  }
  throw new Error(
    'El ZIP no contiene dump.json. Usá el ZIP o JSON de Respaldo, no un ZIP suelto del vault.',
  )
}

export type MediaCopyOpts = {
  vaultRoot?: string
  feedbackRoot?: string
}

/** Copia vault/feedback desde el ZIP solo si el destino no existe o el hash coincide. */
export async function copyMissingMediaFromZip(
  zipPath: string,
  opts?: MediaCopyOpts,
): Promise<MediaCopyStats> {
  const vaultRoot = opts?.vaultRoot ?? VAULT_DIR
  const feedbackRoot = opts?.feedbackRoot ?? FEEDBACK_DIR
  const stats: MediaCopyStats = { copied: 0, skipped: 0, conflicts: 0, failed: 0 }
  const entries = listZipEntries(zipPath)
  assertZipBudget(entries)
  for (const entry of entries) {
    const name = zipRel(entry.name)
    if (!name || name.endsWith('/')) continue
    let dest: string | null = null
    try {
      if (name === 'vault' || name.startsWith('vault/')) {
        if (name === 'vault') continue
        dest = resolveContained(vaultRoot, name.slice('vault/'.length))
      } else if (name === 'feedback' || name.startsWith('feedback/')) {
        if (name === 'feedback') continue
        dest = resolveContained(feedbackRoot, name.slice('feedback/'.length))
      }
    } catch {
      stats.failed++
      continue
    }
    if (!dest) continue
    if (fs.existsSync(dest)) {
      try {
        const tmp = dest + '.incoming'
        await extractEntry(zipPath, entry, tmp)
        const a = fileFingerprint(dest)
        const b = fileFingerprint(tmp)
        fs.unlinkSync(tmp)
        if (a.size === b.size && a.sha256 === b.sha256) {
          stats.skipped++
        } else {
          stats.conflicts++
        }
      } catch {
        stats.failed++
      }
      continue
    }
    try {
      await extractEntry(zipPath, entry, dest)
      stats.copied++
    } catch {
      stats.failed++
    }
  }
  return stats
}

function copyMissingTree(fromDir: string, toDir: string): MediaCopyStats {
  const stats: MediaCopyStats = { copied: 0, skipped: 0, conflicts: 0, failed: 0 }
  if (!fs.existsSync(fromDir)) return stats
  const files = walkFiles(fromDir)
  for (const file of files) {
    let dest: string
    try {
      dest = resolveContained(toDir, file.rel)
    } catch {
      stats.failed++
      continue
    }
    const src = path.join(fromDir, file.rel)
    if (fs.existsSync(dest)) {
      try {
        const a = fileFingerprint(dest)
        const b = fileFingerprint(src)
        if (a.size === b.size && a.sha256 === b.sha256) stats.skipped++
        else stats.conflicts++
      } catch {
        stats.failed++
      }
      continue
    }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      stats.copied++
    } catch {
      stats.failed++
    }
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
    conflicts: vault.conflicts + feedback.conflicts,
    failed: vault.failed + feedback.failed,
  }
}
