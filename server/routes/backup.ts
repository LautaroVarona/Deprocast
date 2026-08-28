import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import {
  backupSummary,
  dumpBackup,
  mergeBackupFromJson,
  restoreBackupToStagingFile,
  commitStagedRestore,
  serializeBackupCsv,
  serializeBackupJson,
  serializeBackupXml,
  type BackupApplyResult,
} from '../services/backup.js'
import { maybeDecryptDumpFile, maybeEncryptDump } from '../services/backupCrypto.js'
import { parseBackupFormat } from '../../shared/httpSchemas.js'
import { ZIP_LIMITS } from '../services/zipLimits.js'
import {
  copyMissingMediaFromZip,
  extractDumpJsonFromZip,
  streamBackupZip,
} from '../services/backupZip.js'
import { withMaintenance } from '../services/maintenance.js'
import { copyBackupFilename, getCurrentRun, toBackupRunMeta } from '../services/run.js'
import {
  FEEDBACK_STAGING_DIR,
  VAULT_STAGING_DIR,
  cleanupRestoreStaging,
  swapPath,
} from '../services/restoreSwap.js'
import { FEEDBACK_DIR, VAULT_DIR } from '../services/paths.js'

export const backupRouter = Router()

const TMP_DIR = path.resolve(process.cwd(), 'data', 'tmp-backup')
const ZIP_MAX_BYTES = ZIP_LIMITS.maxUploadBytes

fs.mkdirSync(TMP_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TMP_DIR, { recursive: true })
      cb(null, TMP_DIR)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin'
      cb(null, `${Date.now()}-${randomUUID()}${ext}`)
    },
  }),
  limits: { fileSize: ZIP_MAX_BYTES, files: 1 },
})

function rmQuiet(target: string | null | undefined) {
  if (!target) return
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function parseJsonFile(abs: string): unknown {
  try {
    return JSON.parse(maybeDecryptDumpFile(abs)) as unknown
  } catch (err) {
    if (err instanceof Error && /cifrado|frase|Firma/.test(err.message)) throw err
    throw new Error('El archivo no es JSON válido')
  }
}

function sniffUpload(abs: string): {
  size: number
  kind: 'json' | 'zip' | 'empty' | 'other'
} {
  const st = fs.statSync(abs)
  const size = st.size
  if (!st.isFile() || size < 4) return { size, kind: 'empty' }
  const buf = Buffer.alloc(Math.min(16, size))
  const fd = fs.openSync(abs, 'r')
  try {
    fs.readSync(fd, buf, 0, buf.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  let i = 0
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3
  const c = buf[i]
  if (c === 0x7b || c === 0x5b) return { size, kind: 'json' }
  if (buf[0] === 0x50 && buf[1] === 0x4b) return { size, kind: 'zip' }
  return { size, kind: 'other' }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function loadDumpFromUpload(file: Express.Multer.File): Promise<{
  dump: unknown
  zipPath: string | null
  extractDir: string | null
}> {
  const original = file.originalname || file.filename || 'archivo'
  const sniffed = sniffUpload(file.path)
  console.log(
    `[backup] upload "${original}" ${formatBytes(sniffed.size)} kind=${sniffed.kind}`,
  )
  if (sniffed.kind === 'empty') {
    throw new Error(
      `El archivo llegó vacío o incompleto (${original}, ${formatBytes(sniffed.size)}). Esperá a que termine de copiarse (OneDrive/USB) o usá el JSON de Respaldo.`,
    )
  }
  if (sniffed.kind === 'json') {
    return { dump: parseJsonFile(file.path), zipPath: null, extractDir: null }
  }
  if (sniffed.kind !== 'zip') {
    throw new Error(
      `No es un JSON ni un ZIP de Deprocast (${original}, ${formatBytes(sniffed.size)}). En Respaldo exportá JSON o ZIP.`,
    )
  }
  const extractDir = path.join(TMP_DIR, `extract-${randomUUID()}`)
  const dumpPath = await extractDumpJsonFromZip(file.path, extractDir)
  return { dump: parseJsonFile(dumpPath), zipPath: file.path, extractDir }
}

function applyMediaStatus(
  applied: BackupApplyResult,
  media: BackupApplyResult['media'],
): void {
  applied.media = media
  if (media.failed > 0 && media.copied === 0) {
    applied.mediaStatus = 'failed'
  } else if (media.failed > 0 || media.conflicts > 0) {
    applied.mediaStatus = 'partial'
  } else if (media.copied > 0 || media.skipped > 0) {
    applied.mediaStatus = 'ok'
  } else {
    applied.mediaStatus = 'skipped'
  }
}

function shouldSwapMedia(media: BackupApplyResult['media']): boolean {
  return media.copied > 0 || media.skipped > 0 || media.conflicts > 0
}

function applyUpload(
  mode: 'replace' | 'merge',
  dump: unknown,
): BackupApplyResult {
  if (mode !== 'merge') {
    throw new Error('replace usa restoreBackupToStagingFile')
  }
  return mergeBackupFromJson(dump)
}

function handleImport(mode: 'replace' | 'merge') {
  return (req: Request, res: Response) => {
    void (async () => {
      const file = req.file
      if (!file) {
        res.status(400).json({
          error:
            mode === 'merge'
              ? 'Enviar un JSON o ZIP de respaldo'
              : 'Enviar un archivo JSON o ZIP de respaldo',
        })
        return
      }
      let extractDir: string | null = null
      try {
        const loaded = await loadDumpFromUpload(file)
        extractDir = loaded.extractDir
        const result = await withMaintenance(`backup-${mode}`, async () => {
          if (mode === 'replace') {
            cleanupRestoreStaging()
            const applied = restoreBackupToStagingFile(loaded.dump)
            if (loaded.zipPath) {
              try {
                applied.media = await copyMissingMediaFromZip(loaded.zipPath, {
                  vaultRoot: VAULT_STAGING_DIR,
                  feedbackRoot: FEEDBACK_STAGING_DIR,
                })
                applyMediaStatus(applied, applied.media)
              } catch (err) {
                console.error('[backup/replace/media-staging]', err)
                cleanupRestoreStaging()
                throw err instanceof Error
                  ? err
                  : new Error('Media de restore inválida')
              }
            }
            commitStagedRestore()
            applied.dbCommitted = true
            if (loaded.zipPath && shouldSwapMedia(applied.media)) {
              try {
                if (fs.existsSync(VAULT_STAGING_DIR)) {
                  swapPath(VAULT_STAGING_DIR, VAULT_DIR)
                }
                if (fs.existsSync(FEEDBACK_STAGING_DIR)) {
                  swapPath(FEEDBACK_STAGING_DIR, FEEDBACK_DIR)
                }
              } catch (err) {
                console.error('[backup/replace/media-swap]', err)
                applied.mediaStatus = 'failed'
              }
            }
            cleanupRestoreStaging()
            return applied
          }

          const applied = applyUpload('merge', loaded.dump)
          applied.dbCommitted = true
          if (loaded.zipPath) {
            try {
              applied.media = await copyMissingMediaFromZip(loaded.zipPath)
              applyMediaStatus(applied, applied.media)
            } catch (err) {
              console.error(`[backup/${mode}/media]`, err)
              applied.mediaStatus = 'failed'
              applied.media = {
                copied: 0,
                skipped: 0,
                conflicts: 0,
                failed: 1,
              }
            }
          }
          return applied
        })
        res.json(result)
      } catch (err) {
        console.error(`[backup/${mode}]`, err)
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : mode === 'merge'
                ? 'Fusión fallida'
                : 'Restore fallido',
        })
      } finally {
        rmQuiet(file.path)
        rmQuiet(extractDir)
      }
    })()
  }
}

backupRouter.get('/summary', (_req, res) => {
  try {
    const run = toBackupRunMeta(getCurrentRun())
    res.json({ ok: true, ...backupSummary(run) })
  } catch (err) {
    console.error('[backup/summary]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo leer el resumen',
    })
  }
})

backupRouter.get('/', (req, res) => {
  let format: ReturnType<typeof parseBackupFormat>
  try {
    format = parseBackupFormat(req.query.format)
  } catch {
    res.status(400).json({ error: 'format debe ser json, csv, xml o zip' })
    return
  }
  try {
    const current = getCurrentRun()
    const base = copyBackupFilename(current).replace(/\.json$/, '')
    if (format === 'zip' && req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.zip"`,
      )
      res.end()
      return
    }
    const dump = dumpBackup({
      purpose: 'copy',
      run: toBackupRunMeta(current),
      includeMedia: format === 'zip',
    })
    if (format === 'csv') {
      const body = serializeBackupCsv(dump)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.csv"`,
      )
      res.send(body)
      return
    }
    if (format === 'xml') {
      const body = serializeBackupXml(dump)
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.xml"`,
      )
      res.send(body)
      return
    }
    if (format === 'zip') {
      streamBackupZip(dump, `${base}.zip`, res)
      return
    }
    const enc = maybeEncryptDump(serializeBackupJson(dump))
    res.setHeader(
      'Content-Type',
      enc.encrypted ? 'application/octet-stream' : 'application/json; charset=utf-8',
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${base}${enc.encrypted ? '.json.enc' : '.json'}"`,
    )
    res.send(enc.body)
  } catch (err) {
    console.error('[backup/export]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Export fallido',
    })
  }
})

backupRouter.post('/restore', upload.single('file'), handleImport('replace'))
backupRouter.post('/merge', upload.single('file'), handleImport('merge'))
