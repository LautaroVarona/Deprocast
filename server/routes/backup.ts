import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import {
  backupSummary,
  dumpBackup,
  mergeBackupFromJson,
  restoreBackupFromJson,
  serializeBackupCsv,
  serializeBackupJson,
  serializeBackupXml,
  type BackupApplyResult,
} from '../services/backup.js'
import {
  copyMissingMedia,
  extractZip,
  findBackupDumpJson,
  streamBackupZip,
} from '../services/backupZip.js'
import { copyBackupFilename, getCurrentRun, toBackupRunMeta } from '../services/run.js'

export const backupRouter = Router()

const TMP_DIR = path.resolve(process.cwd(), 'data', 'tmp-backup')
const ZIP_MAX_BYTES = 8 * 1024 * 1024 * 1024

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
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown
  } catch {
    throw new Error('El archivo no es JSON válido')
  }
}

async function loadDumpFromUpload(file: Express.Multer.File): Promise<{
  dump: unknown
  extractDir: string | null
}> {
  const name = (file.originalname || file.filename || '').toLowerCase()
  const isZip = name.endsWith('.zip')
  const isJson = name.endsWith('.json')
  if (!isZip && !isJson) {
    throw new Error('Solo se acepta JSON o ZIP de respaldo')
  }
  if (isJson) {
    return { dump: parseJsonFile(file.path), extractDir: null }
  }
  const extractDir = path.join(TMP_DIR, `extract-${randomUUID()}`)
  await extractZip(file.path, extractDir)
  const dumpPath = findBackupDumpJson(extractDir)
  return { dump: parseJsonFile(dumpPath), extractDir }
}

function applyUpload(
  mode: 'replace' | 'merge',
  dump: unknown,
  extractDir: string | null,
): BackupApplyResult {
  const result =
    mode === 'merge' ? mergeBackupFromJson(dump) : restoreBackupFromJson(dump)
  if (extractDir) {
    result.media = copyMissingMedia(extractDir)
  }
  return result
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
  const format = String(req.query.format || 'json').toLowerCase()
  if (
    format !== 'json' &&
    format !== 'csv' &&
    format !== 'xml' &&
    format !== 'zip'
  ) {
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
    const body = serializeBackupJson(dump)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${base}.json"`,
    )
    res.send(body)
  } catch (err) {
    console.error('[backup/export]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Export fallido',
    })
  }
})

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
        const result = applyUpload(mode, loaded.dump, extractDir)
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

backupRouter.post('/restore', upload.single('file'), handleImport('replace'))
backupRouter.post('/merge', upload.single('file'), handleImport('merge'))
