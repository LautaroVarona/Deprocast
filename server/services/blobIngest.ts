import { randomUUID } from 'node:crypto'
import { getDb, getTrincheraNotebookId } from '../db.js'
import { row, rows } from '../sql.js'
import { clampTitleWords } from './titleUtils.js'
import { enqueueEmbed } from './embeddings.js'
import { extractFromTranscript } from './cohere.js'
import type { CohereQuantomo } from '../types.js'

export type BlobTagKind = 'person' | 'project' | 'agrupacion' | 'dominio'

export type BlobTag = {
  kind: BlobTagKind
  entity_id: string
  entity_name: string
}

export type BlobView = {
  id: string
  title: string
  content_raw: string
  timestamp_exact: string
  created_at: string
  quantomo_id: string | null
  quantomos: Array<{ id: string; title: string; content: string | null }>
  tags: BlobTag[]
}

function parseTimestamp(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toISOString()
}

function parseTags(raw: unknown): BlobTag[] {
  if (!Array.isArray(raw)) return []
  const out: BlobTag[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind =
      o.kind === 'project'
        ? 'project'
        : o.kind === 'agrupacion'
          ? 'agrupacion'
          : o.kind === 'dominio'
            ? 'dominio'
            : o.kind === 'person'
              ? 'person'
              : null
    const entity_id = String(o.entity_id ?? '').trim()
    const entity_name = String(o.entity_name ?? '').trim()
    if (!kind || !entity_id) continue
    const key = `${kind}:${entity_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, entity_id, entity_name: entity_name || entity_id })
  }
  return out
}

function resolveTagName(
  kind: BlobTagKind,
  entityId: string,
  fallback: string,
): string | null {
  const db = getDb()
  if (kind === 'person') {
    const p = row<{ name: string }>(
      db
        .prepare(
          `SELECT name FROM persons
           WHERE id = ? AND (merged_into IS NULL OR merged_into = '')`,
        )
        .get(entityId),
    )
    return p?.name ?? null
  }
  if (kind === 'project') {
    const p = row<{ title: string }>(
      db
        .prepare(
          `SELECT title FROM projects
           WHERE id = ? AND (merged_into IS NULL OR merged_into = '')`,
        )
        .get(entityId),
    )
    return p?.title ?? null
  }
  if (kind === 'dominio') {
    const d = row<{ name: string }>(
      db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(entityId),
    )
    return d?.name ?? (fallback || null)
  }
  const a = row<{ name: string }>(
    db.prepare(`SELECT name FROM agrupaciones WHERE id = ?`).get(entityId),
  )
  return a?.name ?? (fallback || null)
}

function insertLink(
  entityKind: BlobTagKind,
  entityId: string,
  entryId: string,
  quantomoId: string | null,
  role: string,
  now: string,
): boolean {
  const db = getDb()
  const already = row<{ id: string; quantomo_id: string | null }>(
    db
      .prepare(
        `SELECT id, quantomo_id FROM entity_links
         WHERE entity_kind = ? AND entity_id = ? AND entry_id = ? AND role = ?`,
      )
      .get(entityKind, entityId, entryId, role),
  )
  if (already) {
    if (quantomoId && !already.quantomo_id) {
      db.prepare(
        `UPDATE entity_links SET quantomo_id = ? WHERE id = ?`,
      ).run(quantomoId, already.id)
    }
    return false
  }
  db.prepare(
    `INSERT INTO entity_links (
      id, entity_kind, entity_id, entry_id, quantomo_id, role, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    entityKind,
    entityId,
    entryId,
    quantomoId,
    role,
    now,
  )
  return true
}

/** Primer quántomo del entry (preferido para entity_links.quantomo_id). */
export function primaryQuantomoIdForEntry(entryId: string): string | null {
  const q = row<{ id: string }>(
    getDb()
      .prepare(
        `SELECT id FROM quantomos WHERE entry_id = ? ORDER BY rowid ASC LIMIT 1`,
      )
      .get(entryId),
  )
  return q?.id ?? null
}

/**
 * Sincroniza menciones @ → entity_links (entry + quantomo).
 * - Añade links faltantes
 * - Quita links mentioned/via_agrupacion que ya no están en tags
 * - Rellena quantomo_id si estaba NULL
 */
export function syncEntityMentionTags(
  tags: BlobTag[],
  entryId: string,
  quantomoId?: string | null,
  now = new Date().toISOString(),
): BlobTag[] {
  const db = getDb()
  const qid =
    (quantomoId && String(quantomoId).trim()) ||
    primaryQuantomoIdForEntry(entryId)

  const applied: BlobTag[] = []
  const keepKeys = new Set<string>()
  const keepPersonVia = new Set<string>()

  for (const tag of tags) {
    const name = resolveTagName(tag.kind, tag.entity_id, tag.entity_name)
    if (!name) continue
    insertLink(tag.kind, tag.entity_id, entryId, qid, 'mentioned', now)
    keepKeys.add(`${tag.kind}:${tag.entity_id}`)
    applied.push({ kind: tag.kind, entity_id: tag.entity_id, entity_name: name })

    if (tag.kind !== 'agrupacion') continue
    const members = rows<{ person_id: string }>(
      db
        .prepare(
          `SELECT person_id FROM agrupacion_members WHERE agrupacion_id = ?`,
        )
        .all(tag.entity_id),
    )
    for (const m of members) {
      const personName = resolveTagName('person', m.person_id, '')
      if (!personName) continue
      insertLink(
        'person',
        m.person_id,
        entryId,
        qid,
        'via_agrupacion',
        now,
      )
      keepPersonVia.add(m.person_id)
    }
  }

  const existing = rows<{
    id: string
    entity_kind: string
    entity_id: string
    role: string
  }>(
    db
      .prepare(
        `SELECT id, entity_kind, entity_id, role FROM entity_links
         WHERE entry_id = ? AND role IN ('mentioned', 'via_agrupacion')`,
      )
      .all(entryId),
  )

  const del = db.prepare(`DELETE FROM entity_links WHERE id = ?`)
  for (const link of existing) {
    if (link.role === 'mentioned') {
      const key = `${link.entity_kind}:${link.entity_id}`
      if (!keepKeys.has(key)) del.run(link.id)
      continue
    }
    if (link.role === 'via_agrupacion' && link.entity_kind === 'person') {
      if (!keepPersonVia.has(link.entity_id)) del.run(link.id)
    }
  }

  if (qid) {
    db.prepare(
      `UPDATE entity_links SET quantomo_id = ?
       WHERE entry_id = ? AND (quantomo_id IS NULL OR quantomo_id = '')
         AND role IN ('mentioned', 'via_agrupacion', 'speaker', 'ner')`,
    ).run(qid, entryId)
  }

  return applied
}

export function applyEntityMentionTags(
  tags: BlobTag[],
  entryId: string,
  quantomoId: string | null,
  now: string,
): BlobTag[] {
  return syncEntityMentionTags(tags, entryId, quantomoId, now)
}

/** Link genérico NER/aprobación: siempre intenta asociar quantomo del entry. */
export function ensureEntityEntryLink(opts: {
  entityKind: string
  entityId: string
  entryId: string
  role?: string
  quantomoId?: string | null
  now?: string
}): string {
  const db = getDb()
  const now = opts.now ?? new Date().toISOString()
  const role = opts.role ?? 'mentioned'
  const qid =
    (opts.quantomoId && String(opts.quantomoId).trim()) ||
    primaryQuantomoIdForEntry(opts.entryId)

  const already = row<{ id: string; quantomo_id: string | null }>(
    db
      .prepare(
        `SELECT id, quantomo_id FROM entity_links
         WHERE entity_kind = ? AND entity_id = ? AND entry_id = ?`,
      )
      .get(opts.entityKind, opts.entityId, opts.entryId),
  )
  if (already) {
    if (qid && !already.quantomo_id) {
      db.prepare(`UPDATE entity_links SET quantomo_id = ? WHERE id = ?`).run(
        qid,
        already.id,
      )
    }
    return already.id
  }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO entity_links (
      id, entity_kind, entity_id, entry_id, quantomo_id, role, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, opts.entityKind, opts.entityId, opts.entryId, qid, role, now)
  return id
}

export function listEntryTags(entryId: string): BlobTag[] {
  const db = getDb()
  return rows<{
    entity_kind: string
    entity_id: string
    entity_name: string | null
  }>(
    db
      .prepare(
        `SELECT
           l.entity_kind,
           l.entity_id,
           CASE
             WHEN l.entity_kind = 'person' THEN p.name
             WHEN l.entity_kind = 'project' THEN proj.title
             WHEN l.entity_kind = 'agrupacion' THEN a.name
             WHEN l.entity_kind = 'dominio' THEN d.name
             ELSE l.entity_id
           END AS entity_name
         FROM entity_links l
         LEFT JOIN persons p
           ON l.entity_kind = 'person' AND p.id = l.entity_id
         LEFT JOIN projects proj
           ON l.entity_kind = 'project' AND proj.id = l.entity_id
         LEFT JOIN agrupaciones a
           ON l.entity_kind = 'agrupacion' AND a.id = l.entity_id
         LEFT JOIN dominios d
           ON l.entity_kind = 'dominio' AND d.id = l.entity_id
         WHERE l.entry_id = ? AND l.role = 'mentioned'
         ORDER BY l.created_at ASC`,
      )
      .all(entryId),
  )
    .filter((r) => r.entity_name)
    .map((r) => ({
      kind: r.entity_kind as BlobTagKind,
      entity_id: r.entity_id,
      entity_name: r.entity_name as string,
    }))
}

function distillQuantomo(text: string): CohereQuantomo {
  const firstLine =
    text.split(/\n/).find((l) => l.replace(/@/g, '').trim())?.trim() ||
    'Nota en bruto'
  const title = clampTitleWords(firstLine, 3, 6, 'Nota en bruto')
  const para = (text.split(/\n\s*\n/)[0] ?? text).trim()
  const content =
    para.length > 520 ? `${para.slice(0, 500).trim()}…` : para || title
  return {
    title,
    content,
    hermetic_weight: 7,
    universe: 'nota',
  }
}

function listQuantomos(entryId: string): Array<{
  id: string
  title: string
  content: string | null
}> {
  return rows<{ id: string; title: string; content: string | null }>(
    getDb()
      .prepare(
        `SELECT id, title, content FROM quantomos
         WHERE entry_id = ? AND recognized = 1
         ORDER BY rowid ASC`,
      )
      .all(entryId),
  )
}

function toView(
  e: {
    id: string
    title: string
    content_raw: string
    timestamp_exact: string
    created_at: string
  },
): BlobView {
  const quantomos = listQuantomos(e.id)
  return {
    id: e.id,
    title: e.title,
    content_raw: e.content_raw,
    timestamp_exact: e.timestamp_exact,
    created_at: e.created_at,
    quantomo_id: quantomos[0]?.id ?? null,
    quantomos,
    tags: listEntryTags(e.id),
  }
}

export function listBlobs(limit = 40): BlobView[] {
  const cap = Math.min(Math.max(limit, 1), 100)
  const entries = rows<{
    id: string
    title: string
    content_raw: string | null
    timestamp_exact: string | null
    created_at: string
    quantomo_id: string | null
  }>(
    getDb()
      .prepare(
        `SELECT e.id, e.title, e.content_raw, e.timestamp_exact, e.created_at,
                (SELECT q.id FROM quantomos q WHERE q.entry_id = e.id LIMIT 1)
                  AS quantomo_id
         FROM entries e
         WHERE e.source_type = 'blob'
         ORDER BY e.timestamp_exact DESC, e.created_at DESC
         LIMIT ?`,
      )
      .all(cap),
  )

  return entries.map((e) =>
    toView({
      id: e.id,
      title: e.title,
      content_raw: e.content_raw ?? '',
      timestamp_exact: e.timestamp_exact ?? e.created_at,
      created_at: e.created_at,
    }),
  )
}

export function ingestBlob(input: {
  text: string
  timestamp_exact?: string
  tags?: unknown
}): BlobView {
  const text = input.text.replace(/\r\n/g, '\n').trimEnd()
  if (!text.trim()) {
    throw new Error('texto vacío')
  }

  const now = new Date().toISOString()
  const timestamp = parseTimestamp(input.timestamp_exact, now)
  const tags = parseTags(input.tags)
  const distilled = distillQuantomo(text)
  const title = distilled.title
  const entryId = randomUUID()
  const quantomoId = randomUUID()
  const notebookId = getTrincheraNotebookId()
  const db = getDb()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO entries (
        id, notebook_id, source_type, title, content_raw, vault_path,
        timestamp_exact, status, created_at, title_manual, original_filename
      ) VALUES (?, ?, 'blob', ?, ?, NULL, ?, 'approved', ?, 1, NULL)`,
    ).run(entryId, notebookId, title, text, timestamp, now)

    db.prepare(
      `INSERT INTO quantomos (
        id, entry_id, title, content, hermetic_weight, universe, recognized,
        human_weight, suggested_weight
      ) VALUES (?, ?, ?, ?, ?, 'nota', 0, ?, ?)`,
    ).run(
      quantomoId,
      entryId,
      distilled.title,
      distilled.content,
      distilled.hermetic_weight,
      distilled.hermetic_weight,
      distilled.hermetic_weight,
    )

    applyEntityMentionTags(tags, entryId, quantomoId, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  enqueueEmbed(async () => {
    try {
      const extraction = await extractFromTranscript(text, title, {
        fallback: 'none',
      })
      const extras = extraction.quantomos
        .map((q) => ({
          title: clampTitleWords(q.title, 3, 6, distilled.title),
          content: String(q.content ?? '').trim(),
          hermetic_weight: Number(q.hermetic_weight ?? 7) || 7,
          universe: (q.universe || 'nota').trim() || 'nota',
        }))
        .filter((q) => q.content && q.content !== distilled.content)
      if (extras.length > 0) {
        const conn = getDb()
        conn
          .prepare(
            `UPDATE quantomos SET title = ?, content = ?, hermetic_weight = ?,
                    universe = ?, human_weight = ?, suggested_weight = ?
             WHERE id = ?`,
          )
          .run(
            extras[0]!.title,
            extras[0]!.content,
            extras[0]!.hermetic_weight,
            extras[0]!.universe,
            extras[0]!.hermetic_weight,
            extras[0]!.hermetic_weight,
            quantomoId,
          )
        for (const extra of extras.slice(1)) {
          conn
            .prepare(
              `INSERT INTO quantomos (
                id, entry_id, title, content, hermetic_weight, universe, recognized,
                human_weight, suggested_weight
              ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            )
            .run(
              randomUUID(),
              entryId,
              extra.title,
              extra.content,
              extra.hermetic_weight,
              extra.universe,
              extra.hermetic_weight,
              extra.hermetic_weight,
            )
        }
      }
    } catch (err) {
      console.warn('[blob] extract quantomo:', err)
    }
  })

  return toView({
    id: entryId,
    title,
    content_raw: text,
    timestamp_exact: timestamp,
    created_at: now,
  })
}
