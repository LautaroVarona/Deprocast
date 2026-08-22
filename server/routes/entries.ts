import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db.js'
import { row, rowRequired, rows } from '../sql.js'
import { removeFromPipelineQueue, enqueuePipeline } from '../services/pipeline.js'
import { listBlobs } from '../services/blobIngest.js'
import type {
  Entry,
  EntryEntityRaw,
  PendingTask,
  ProposalBundle,
  Quantomo,
  SpeakerAssignment,
  ValidatedFileMetadata,
} from '../types.js'
import { parseManualTags } from '../services/bookmarkProcess.js'

export const entriesRouter = Router()

type CribaBody = {
  content_raw?: unknown
  operator_note?: unknown
  manual_tags?: unknown
  speaker_map?: unknown
  title?: unknown
  timestamp_exact?: unknown
}

function parseSpeakerMapBody(raw: unknown, fallback: string): string {
  if (!Array.isArray(raw)) return fallback
  const mapped: SpeakerAssignment[] = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const speaker = Number(o.speaker)
      if (!Number.isFinite(speaker)) return null
      return {
        speaker,
        person_id:
          typeof o.person_id === 'string' && o.person_id.trim()
            ? o.person_id.trim()
            : null,
        person_name:
          typeof o.person_name === 'string' && o.person_name.trim()
            ? o.person_name.trim()
            : null,
      }
    })
    .filter((s): s is SpeakerAssignment => s != null)
  return JSON.stringify(mapped)
}

function cribaFieldUpdates(entry: Entry, body: CribaBody) {
  const content_raw =
    typeof body.content_raw === 'string' ? body.content_raw : entry.content_raw
  const operator_note =
    typeof body.operator_note === 'string'
      ? body.operator_note
      : (entry.operator_note ?? '')
  let manual_tags = entry.manual_tags ?? '[]'
  if (Array.isArray(body.manual_tags)) {
    manual_tags = JSON.stringify(
      parseManualTags(JSON.stringify(body.manual_tags)),
    )
  }
  const speaker_map = parseSpeakerMapBody(
    body.speaker_map,
    entry.speaker_map ?? '[]',
  )
  let title = entry.title
  let title_manual = entry.title_manual ?? 0
  if (typeof body.title === 'string' && body.title.trim()) {
    const trimmed = body.title.trim()
    if (trimmed !== entry.title) {
      title = trimmed
      title_manual = 1
    }
  }
  let timestamp_exact = entry.timestamp_exact
  if (typeof body.timestamp_exact === 'string' && body.timestamp_exact.trim()) {
    const d = new Date(body.timestamp_exact)
    if (!Number.isNaN(d.getTime())) {
      timestamp_exact = d.toISOString()
    }
  }
  return {
    content_raw,
    operator_note,
    manual_tags,
    speaker_map,
    title,
    title_manual,
    timestamp_exact,
  }
}

function bundleEntry(entry: Entry, withFileMetadata = false): ProposalBundle {
  const db = getDb()
  const quantomos = rows<Quantomo>(
    db
      .prepare(
        `SELECT * FROM quantomos WHERE entry_id = ? ORDER BY hermetic_weight DESC`,
      )
      .all(entry.id),
  )
  const tasks = rows<PendingTask>(
    db
      .prepare(
        `SELECT * FROM pending_tasks WHERE entry_id = ? ORDER BY rowid ASC`,
      )
      .all(entry.id),
  )
  const entities = rows<EntryEntityRaw>(
    db
      .prepare(
        `SELECT * FROM entry_entities_raw WHERE entry_id = ? ORDER BY rowid ASC`,
      )
      .all(entry.id),
  )

  const bundle: ProposalBundle = { ...entry, quantomos, tasks, entities }

  if (withFileMetadata) {
    const meta = row<ValidatedFileMetadata>(
      db
        .prepare(`SELECT * FROM validated_file_metadata WHERE entry_id = ?`)
        .get(entry.id),
    )
    bundle.file_metadata = meta ?? null
  }

  return bundle
}

function collectDescendants(entryId: string): Entry[] {
  const db = getDb()
  const kids = rows<Entry>(
    db.prepare(`SELECT * FROM entries WHERE parent_entry_id = ?`).all(entryId),
  )
  const out: Entry[] = []
  for (const kid of kids) {
    out.push(...collectDescendants(kid.id), kid)
  }
  return out
}

function purgeEntryRows(entryId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM validated_file_metadata WHERE entry_id = ?`).run(
    entryId,
  )
  const quantomoIds = rows<{ id: string }>(
    db.prepare(`SELECT id FROM quantomos WHERE entry_id = ?`).all(entryId),
  )
  for (const q of quantomoIds) {
    db.prepare(
      `DELETE FROM embeddings WHERE object_type = 'quantomo' AND object_id = ?`,
    ).run(q.id)
  }
  db.prepare(`DELETE FROM quantomos WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM pending_tasks WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entry_entities_raw WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entity_proposals WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entity_links WHERE entry_id = ?`).run(entryId)
  db.prepare(
    `DELETE FROM embeddings WHERE object_type = 'entry' AND object_id = ?`,
  ).run(entryId)
  db.prepare(
    `DELETE FROM embeddings WHERE object_type = 'entry_chunk' AND object_id LIKE ?`,
  ).run(`${entryId}:%`)
  db.prepare(`DELETE FROM entries WHERE id = ?`).run(entryId)
}

function deleteEntryCascade(entryId: string, entry: Entry): void {
  const db = getDb()
  const family = [...collectDescendants(entryId), entry]
  for (const e of family) removeFromPipelineQueue(e.id)

  db.exec('BEGIN')
  try {
    for (const e of family) purgeEntryRows(e.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  for (const e of family) {
    if (!e.vault_path) continue
    try {
      const abs = path.resolve(process.cwd(), e.vault_path)
      const dir = path.dirname(abs)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[entries] vault cleanup failed:', err)
    }
  }
}

entriesRouter.get('/queued', (_req, res) => {
  const queued = rows<Entry>(
    getDb()
      .prepare(
        `SELECT * FROM entries WHERE status IN ('queued', 'processing', 'pending_extract') ORDER BY created_at ASC`,
      )
      .all(),
  )
  res.json({ entries: queued })
})

entriesRouter.get('/criba', (_req, res) => {
  const entries = rows<Entry>(
    getDb()
      .prepare(
        `SELECT * FROM entries
         WHERE status = 'pending_criba' AND source_type = 'audio'
         ORDER BY created_at ASC`,
      )
      .all(),
  )
  res.json({ entries })
})

/** Elimina todas las cargas activas (queued + processing) y las saca del pipeline. */
entriesRouter.delete('/queued', (_req, res) => {
  const db = getDb()
  const active = rows<Entry>(
    db
      .prepare(
        `SELECT * FROM entries WHERE status IN ('queued', 'processing', 'pending_extract')`,
      )
      .all(),
  )

  for (const entry of active) {
    deleteEntryCascade(entry.id, entry)
  }

  res.json({ ok: true, deleted: active.length })
})

entriesRouter.get('/blobs', (req, res) => {
  const limitRaw = Number(req.query.limit ?? 40)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 40
  res.json({ blobs: listBlobs(limit) })
})

entriesRouter.get('/validated', (_req, res) => {
  const entries = rows<Entry>(
    getDb()
      .prepare(
        `SELECT * FROM entries WHERE status = 'approved' ORDER BY timestamp_exact DESC, created_at DESC`,
      )
      .all(),
  )

  res.json({ entries: entries.map((e) => bundleEntry(e, true)) })
})

entriesRouter.patch('/timestamp', (req, res) => {
  const { entryId, timestamp_exact } = req.body as {
    entryId?: string
    timestamp_exact?: string
  }

  if (!entryId || !timestamp_exact) {
    res.status(400).json({ error: 'entryId y timestamp_exact son requeridos' })
    return
  }

  const result = getDb()
    .prepare(`UPDATE entries SET timestamp_exact = ? WHERE id = ?`)
    .run(timestamp_exact, entryId)

  if (result.changes === 0) {
    res.status(404).json({ error: 'Entrada no encontrada' })
    return
  }

  const entry = rowRequired<Entry>(
    getDb().prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )

  res.json({ ok: true, entry })
})

entriesRouter.patch('/title', (req, res) => {
  const { entryId, title } = req.body as {
    entryId?: string
    title?: string
  }

  const trimmed = title?.trim()
  if (!entryId || !trimmed) {
    res.status(400).json({ error: 'entryId y title son requeridos' })
    return
  }

  const result = getDb()
    .prepare(
      `UPDATE entries SET title = ?, title_manual = 1 WHERE id = ?`,
    )
    .run(trimmed, entryId)

  if (result.changes === 0) {
    res.status(404).json({ error: 'Entrada no encontrada' })
    return
  }

  const entry = rowRequired<Entry>(
    getDb().prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )

  res.json({ ok: true, entry })
})

entriesRouter.patch('/:entryId/criba', (req, res) => {
  const entryId = req.params.entryId
  if (!entryId) {
    res.status(400).json({ error: 'entryId requerido' })
    return
  }
  const db = getDb()
  const entry = row<Entry>(
    db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )
  if (!entry) {
    res.status(404).json({ error: 'Entrada no encontrada' })
    return
  }
  if (entry.status !== 'pending_criba') {
    res.status(409).json({ error: 'La entrada no está en criba' })
    return
  }

  const next = cribaFieldUpdates(entry, req.body as CribaBody)

  db.prepare(
    `UPDATE entries SET
       content_raw = ?, operator_note = ?, manual_tags = ?, speaker_map = ?,
       title = ?, title_manual = ?, timestamp_exact = ?
     WHERE id = ?`,
  ).run(
    next.content_raw,
    next.operator_note,
    next.manual_tags,
    next.speaker_map,
    next.title,
    next.title_manual,
    next.timestamp_exact,
    entryId,
  )

  const updated = rowRequired<Entry>(
    db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )
  res.json({ ok: true, entry: updated })
})

entriesRouter.post('/:entryId/weight', async (req, res) => {
  const entryId = req.params.entryId
  const weight = Number((req.body as { weight?: unknown }).weight)
  if (!entryId || !Number.isFinite(weight) || weight < 1 || weight > 12) {
    res.status(400).json({ error: 'peso 1–12 requerido' })
    return
  }
  const db = getDb()
  const entry = row<Entry>(
    db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )
  if (!entry) {
    res.status(404).json({ error: 'Entrada no encontrada' })
    return
  }
  if (entry.status !== 'pending_criba') {
    res.status(409).json({ error: 'La entrada no está en criba' })
    return
  }

  const next = cribaFieldUpdates(entry, req.body as CribaBody)

  db.prepare(
    `UPDATE entries SET
       human_weight = ?, status = 'pending_extract',
       content_raw = ?, operator_note = ?, manual_tags = ?, speaker_map = ?,
       title = ?, title_manual = ?, timestamp_exact = ?
     WHERE id = ?`,
  ).run(
    Math.round(weight),
    next.content_raw,
    next.operator_note,
    next.manual_tags,
    next.speaker_map,
    next.title,
    next.title_manual,
    next.timestamp_exact,
    entryId,
  )

  try {
    await enqueuePipeline([entryId])
  } catch (err) {
    console.error('[entries/weight] enqueue', err)
  }

  const updated = rowRequired<Entry>(
    db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )
  res.json({ ok: true, entry: updated })
})

entriesRouter.get('/:entryId/media', (req, res) => {
  const entryId = req.params.entryId
  if (!entryId) {
    res.status(400).json({ error: 'entryId requerido' })
    return
  }
  const entry = row<Entry>(
    getDb().prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )
  if (!entry?.vault_path) {
    res.status(404).json({ error: 'Audio no encontrado' })
    return
  }
  const abs = path.resolve(process.cwd(), entry.vault_path)
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: 'Archivo ausente en vault' })
    return
  }
  res.sendFile(abs)
})

entriesRouter.delete('/:entryId', (req, res) => {
  const entryId = req.params.entryId
  if (!entryId) {
    res.status(400).json({ error: 'entryId requerido' })
    return
  }

  const db = getDb()
  const entry = row<Entry>(
    db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId),
  )

  if (!entry) {
    res.status(404).json({ error: 'Entrada no encontrada' })
    return
  }

  deleteEntryCascade(entryId, entry)
  res.json({ ok: true, entryId })
})
