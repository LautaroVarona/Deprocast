import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb, getTrincheraNotebookId } from '../db.js'
import { rows } from '../sql.js'
import { resolveOriginAttribution } from '../services/originAttribution.js'
import { ingestBlob } from '../services/blobIngest.js'
import { ingestCofre } from '../services/cofreIngest.js'
import { processTranscripts } from '../controllers/ingestController.js'
import {
  decodeMulterOriginalName,
  ingestFileKey,
} from '../services/ingestBatch.js'
import { resolveContained, VAULT_DIR } from '../services/paths.js'

const VAULT_ROOT = VAULT_DIR
const INCOMING = path.join(VAULT_ROOT, '_incoming')

fs.mkdirSync(INCOMING, { recursive: true })

/** Disco, no memoria — los m4a de 100–200 MB no caben en RAM vía multer.memoryStorage. */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(INCOMING, { recursive: true })
      cb(null, INCOMING)
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      const safe = path.basename(original).replace(/[<>:"|?*]/g, '_')
      cb(null, `${randomUUID()}__${safe}`)
    },
  }),
  limits: {
    fileSize: 512 * 1024 * 1024, // 512 MB por archivo
    files: 16,
  },
})

export const ingestRouter = Router()

type CreatedEntry = {
  id: string
  title: string
  title_manual: number
  timestamp_exact: string
  origin_source: string
  status: string
}

function parseBatchTags(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '[]'
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return '[]'
    const tags = parsed.filter(
      (t) =>
        t &&
        typeof t === 'object' &&
        (t.kind === 'person' || t.kind === 'project') &&
        typeof t.entity_id === 'string' &&
        typeof t.entity_name === 'string',
    )
    return JSON.stringify(tags)
  } catch {
    return '[]'
  }
}

type ExistingBatchRow = CreatedEntry & {
  original_filename: string | null
  vault_path: string | null
}

function vaultFileSize(vaultPath: string | null): number | null {
  if (!vaultPath) return null
  try {
    const abs = path.isAbsolute(vaultPath)
      ? vaultPath
      : path.resolve(process.cwd(), vaultPath)
    return fs.statSync(abs).size
  } catch {
    return null
  }
}

function ingestDiskFile(
  file: Express.Multer.File,
  now: Date,
  batch: { batchId: string; manualTags: string; operatorNote: string },
): CreatedEntry {
  const db = getDb()
  const notebookId = getTrincheraNotebookId()
  const entryId = randomUUID()

  const originalName = decodeMulterOriginalName(file.originalname)
  const title = originalName.replace(/\.[^.]+$/, '')
  const safeName = path.basename(originalName).replace(/[<>:"|?*]/g, '_')

  const dir = resolveContained(VAULT_ROOT, entryId)
  fs.mkdirSync(dir, { recursive: true })
  const absVault = path.join(dir, safeName)

  fs.renameSync(file.path, absVault)

  const vaultPath = path
    .relative(process.cwd(), absVault)
    .split(path.sep)
    .join('/')

  const origin = resolveOriginAttribution({
    filename: originalName,
    fileMtime: null,
    uploadNow: now,
    defaultYear: 2026,
  })

  db.prepare(`
    INSERT INTO entries (
      id, notebook_id, source_type, title, content_raw,
      vault_path, timestamp_exact, status, created_at, title_manual,
      original_filename, batch_id, manual_tags, operator_note
    ) VALUES (?, ?, 'audio', ?, NULL, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)
  `).run(
    entryId,
    notebookId,
    title,
    vaultPath,
    origin.timestampExact,
    now.toISOString(),
    originalName,
    batch.batchId,
    batch.manualTags,
    batch.operatorNote,
  )

  console.log(
    `[ingest] «${originalName}» → ${entryId} (${Math.round(file.size / 1024)} KB)`,
  )

  return {
    id: entryId,
    title,
    title_manual: 0,
    timestamp_exact: origin.timestampExact,
    origin_source: origin.source,
    status: 'queued',
  }
}

function cleanupTemps(files: Express.Multer.File[] | undefined): void {
  if (!files) return
  for (const file of files) {
    try {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
    } catch {
      /* ignore */
    }
  }
}

ingestRouter.post('/audio', (req, res) => {
  upload.array('files', 16)(req, res, (err: unknown) => {
    if (err) {
      console.error('[ingest] multer:', err)
      const message =
        err instanceof multer.MulterError
          ? err.code === 'LIMIT_FILE_SIZE'
            ? 'Archivo demasiado grande (máx. 512 MB)'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Error al subir archivos'
      res.status(400).json({ error: message })
      return
    }

    const files = req.files as Express.Multer.File[] | undefined
    try {
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No se recibieron archivos' })
        return
      }

      const body = req.body as {
        batch_id?: unknown
        manual_tags?: unknown
        operator_note?: unknown
      }
      const batchId =
        typeof body.batch_id === 'string' && body.batch_id.trim()
          ? body.batch_id.trim()
          : randomUUID()
      const db = getDb()
      const existing = rows<ExistingBatchRow>(
        db
          .prepare(
            `SELECT id, title, title_manual, timestamp_exact, status,
                    original_filename, vault_path
             FROM entries WHERE batch_id = ?`,
          )
          .all(batchId),
      )
      const byKey = new Map<string, CreatedEntry>()
      for (const e of existing) {
        const name = e.original_filename
        const size = vaultFileSize(e.vault_path)
        if (!name || size == null) continue
        byKey.set(ingestFileKey({ name, size }), {
          id: e.id,
          title: e.title,
          title_manual: e.title_manual,
          timestamp_exact: e.timestamp_exact,
          origin_source: 'batch',
          status: e.status,
        })
      }
      const incoming = files.map((file) => ({
        name: decodeMulterOriginalName(file.originalname),
        size: file.size,
        file,
      }))

      const manualTags = parseBatchTags(body.manual_tags)
      const operatorNote =
        typeof body.operator_note === 'string' ? body.operator_note : ''

      const now = new Date()
      const created: CreatedEntry[] = []
      const reused: CreatedEntry[] = []
      const errors: Array<{ file: string; error: string }> = []
      db.exec('BEGIN')
      try {
        for (const item of incoming) {
          const key = ingestFileKey({ name: item.name, size: item.size })
          const prev = byKey.get(key)
          if (prev) {
            console.log(
              `[ingest] «${item.name}» ya en lote ${batchId.slice(0, 8)} → ${prev.id} (idempotente)`,
            )
            reused.push(prev)
            continue
          }
          try {
            const entry = ingestDiskFile(item.file, now, {
              batchId,
              manualTags,
              operatorNote,
            })
            created.push(entry)
            byKey.set(key, entry)
          } catch (fileErr) {
            errors.push({
              file: item.name,
              error:
                fileErr instanceof Error ? fileErr.message : String(fileErr),
            })
          }
        }
        if (created.length === 0 && reused.length === 0 && errors.length > 0) {
          db.exec('ROLLBACK')
          res.status(400).json({ error: 'Ningún archivo se pudo ingerir', errors })
          return
        }
        db.exec('COMMIT')
      } catch (txErr) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* ignore */
        }
        throw txErr
      }

      const entries = [...created, ...reused]
      if (created.length > 0 || reused.length > 0) {
        console.log(
          `[ingest] lote ${batchId.slice(0, 8)}: +${created.length} nuevo(s)` +
            (reused.length > 0 ? `, ${reused.length} ya existía(n)` : ''),
        )
      }
      if (errors.length > 0) {
        res.status(207).json({
          ok: true,
          entries,
          errors,
          idempotent: created.length === 0,
        })
        return
      }
      res.json({
        ok: true,
        entries,
        idempotent: created.length === 0 && reused.length > 0,
      })
    } catch (e) {
      console.error('[ingest]', e)
      res.status(500).json({ error: 'Error al ingerir audio' })
    } finally {
      cleanupTemps(files)
    }
  })
})

ingestRouter.post('/cofre', (req, res) => {
  upload.single('audio')(req, res, (err: unknown) => {
    if (err) {
      console.error('[ingest/cofre] multer:', err)
      const message =
        err instanceof multer.MulterError
          ? err.code === 'LIMIT_FILE_SIZE'
            ? 'Archivo demasiado grande (máx. 512 MB)'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Error al subir el Cofre'
      res.status(400).json({ error: message })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'Falta el archivo audio' })
      return
    }

    const body = req.body as { manifest?: unknown }
    const manifestRaw =
      typeof body.manifest === 'string' ? body.manifest : ''
    if (!manifestRaw.trim()) {
      try {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
      } catch {
        /* ignore */
      }
      res.status(400).json({ error: 'Falta el campo manifest' })
      return
    }

    void ingestCofre({
      audioPath: file.path,
      originalFilename: Buffer.from(file.originalname, 'latin1').toString(
        'utf8',
      ),
      manifestRaw,
    })
      .then((entry) => {
        res.json({ ok: true, ...entry })
      })
      .catch((e: unknown) => {
        console.error('[ingest/cofre]', e)
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
        } catch {
          /* ignore */
        }
        const message =
          e instanceof Error ? e.message : 'Error al ingerir El Cofre'
        res.status(500).json({ error: message })
      })
  })
})

ingestRouter.post('/blob', (req, res) => {
  const body = req.body as {
    text?: unknown
    timestamp_exact?: unknown
    tags?: unknown
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'texto requerido' })
    return
  }

  try {
    const timestamp_exact =
      typeof body.timestamp_exact === 'string' ? body.timestamp_exact : undefined
    const blob = ingestBlob({ text, timestamp_exact, tags: body.tags })
    res.json({ ok: true, blob })
  } catch (e) {
    console.error('[ingest] blob:', e)
    const message = e instanceof Error ? e.message : 'Error al guardar la nota'
    res.status(500).json({ error: message })
  }
})

ingestRouter.post('/cognitive', async (req, res) => {
  const body = req.body as {
    transcripts?: unknown
    title?: unknown
  }
  const raw = body.transcripts
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: 'transcripts[] requerido' })
    return
  }
  const transcripts = raw.map((item, index) => {
    if (typeof item === 'string') {
      return {
        title:
          typeof body.title === 'string' && index === 0
            ? body.title
            : `Nota ${index + 1}`,
        transcript: item,
      }
    }
    if (item && typeof item === 'object') {
      const o = item as { id?: unknown; title?: unknown; transcript?: unknown }
      return {
        id: typeof o.id === 'string' ? o.id : undefined,
        title: typeof o.title === 'string' ? o.title : `Nota ${index + 1}`,
        transcript: String(o.transcript ?? ''),
      }
    }
    return { title: `Nota ${index + 1}`, transcript: String(item ?? '') }
  })

  try {
    const items = await processTranscripts(transcripts)
    res.json({ ok: true, status: 'pending_review', items })
  } catch (e) {
    console.error('[ingest/cognitive]', e)
    const message =
      e instanceof Error ? e.message : 'Error en el motor cognitivo'
    res.status(500).json({ error: message })
  }
})
