import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  BookmarkManualTag,
  SpeakerAssignment,
} from '../types.js'
import { parseManualTags } from './bookmarkProcess.js'
import {
  primaryQuantomoIdForEntry,
  syncEntityMentionTags,
  type BlobTag,
} from './blobIngest.js'

export function maxQuantomosForWeight(weight: number): number {
  const w = Math.max(1, Math.min(12, Math.round(weight)))
  if (w <= 3) return 1
  if (w <= 6) return 2
  if (w <= 9) return 3
  if (w === 10) return 4
  if (w === 11) return 5
  return 6
}

export function parseSpeakerMap(
  raw: string | null | undefined,
): SpeakerAssignment[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: SpeakerAssignment[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const speaker = Number(o.speaker)
      if (!Number.isFinite(speaker)) continue
      const person_id =
        typeof o.person_id === 'string' && o.person_id.trim()
          ? o.person_id.trim()
          : null
      const person_name =
        typeof o.person_name === 'string' && o.person_name.trim()
          ? o.person_name.trim()
          : null
      out.push({ speaker, person_id, person_name })
    }
    return out
  } catch {
    return []
  }
}

function toBlobTags(tags: BookmarkManualTag[]): BlobTag[] {
  const out: BlobTag[] = []
  for (const tag of tags) {
    if (
      tag.kind !== 'person' &&
      tag.kind !== 'project' &&
      tag.kind !== 'agrupacion' &&
      tag.kind !== 'dominio'
    ) {
      continue
    }
    out.push({
      kind: tag.kind,
      entity_id: tag.entity_id,
      entity_name: tag.entity_name,
    })
  }
  return out
}

function geoTags(tags: BookmarkManualTag[]): BookmarkManualTag[] {
  return tags.filter((t) => t.kind === 'geografia')
}

/** Vincula manual_tags del audio al entry + quántomo (sync completo). */
export function applyEntryManualTagsAsLinks(
  db: DatabaseSync,
  manualTagsRaw: string | null | undefined,
  entryId: string,
  quantomoId: string | null,
): number {
  const parsed = parseManualTags(manualTagsRaw)
  const qid = quantomoId || primaryQuantomoIdForEntry(entryId)
  const applied = syncEntityMentionTags(toBlobTags(parsed), entryId, qid)
  const geo = applyTagLinks(db, geoTags(parsed), entryId, qid, 'mentioned')
  return applied.length + geo
}

export function applySpeakerLinks(
  db: DatabaseSync,
  speakerMapRaw: string | null | undefined,
  entryId: string,
  quantomoId: string | null,
): number {
  const qid = quantomoId || primaryQuantomoIdForEntry(entryId)
  const mapped = parseSpeakerMap(speakerMapRaw)
    .filter((s) => s.person_id)
    .map(
      (s): BookmarkManualTag => ({
        kind: 'person',
        entity_id: s.person_id!,
        entity_name: s.person_name || s.person_id!,
      }),
    )
  return applyTagLinks(db, mapped, entryId, qid, 'speaker')
}

function applyTagLinks(
  db: DatabaseSync,
  tags: BookmarkManualTag[],
  entryId: string,
  quantomoId: string | null,
  role: string,
): number {
  if (tags.length === 0) return 0
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO entity_links (
      id, entity_kind, entity_id, entry_id, quantomo_id, role, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateQ = db.prepare(
    `UPDATE entity_links SET quantomo_id = ? WHERE id = ? AND (quantomo_id IS NULL OR quantomo_id = '')`,
  )
  let linked = 0
  for (const tag of tags) {
    if (tag.kind === 'person') {
      const exists = db
        .prepare(`SELECT id FROM persons WHERE id = ?`)
        .get(tag.entity_id)
      if (!exists) continue
    } else if (tag.kind === 'project') {
      const exists = db
        .prepare(`SELECT id FROM projects WHERE id = ?`)
        .get(tag.entity_id)
      if (!exists) continue
    } else if (tag.kind === 'dominio') {
      const exists = db
        .prepare(`SELECT id FROM dominios WHERE id = ?`)
        .get(tag.entity_id)
      if (!exists) continue
    } else if (tag.kind === 'agrupacion') {
      const exists = db
        .prepare(`SELECT id FROM agrupaciones WHERE id = ?`)
        .get(tag.entity_id)
      if (!exists) continue
    } else if (tag.kind === 'geografia') {
      const exists = db
        .prepare(`SELECT id FROM geografia WHERE id = ?`)
        .get(tag.entity_id)
      if (!exists) continue
    } else {
      continue
    }
    const already = db
      .prepare(
        `SELECT id, quantomo_id FROM entity_links
         WHERE entity_kind = ? AND entity_id = ? AND entry_id = ? AND role = ?`,
      )
      .get(tag.kind, tag.entity_id, entryId, role) as
      | { id: string; quantomo_id: string | null }
      | undefined
    if (already) {
      if (quantomoId && !already.quantomo_id) {
        updateQ.run(quantomoId, already.id)
      }
      continue
    }
    insert.run(
      randomUUID(),
      tag.kind,
      tag.entity_id,
      entryId,
      quantomoId,
      role,
      now,
    )
    linked += 1
  }
  return linked
}

export function findRuidoPersonId(
  db: DatabaseSync,
): { id: string; name: string } | null {
  const byKind = db
    .prepare(
      `SELECT id, name FROM persons
       WHERE kind = 'ruido'
         AND (merged_into IS NULL OR merged_into = '')
       ORDER BY CASE WHEN lower(name) = 'ruido' THEN 0 ELSE 1 END, created_at
       LIMIT 1`,
    )
    .get() as { id: string; name: string } | undefined
  if (byKind) return byKind
  const byName = db
    .prepare(
      `SELECT id, name FROM persons
       WHERE lower(name) = 'ruido'
         AND (merged_into IS NULL OR merged_into = '')
       LIMIT 1`,
    )
    .get() as { id: string; name: string } | undefined
  return byName ?? null
}
