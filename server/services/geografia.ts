/**
 * Geografía: lugares del corpus (categoría de entidad, junto a personas/proyectos/dominios).
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type { Geografia, GeoKind } from '../types.js'

export const GEO_KINDS = [
  'lugar',
  'calle',
  'ciudad',
  'barrio',
  'region',
  'pais',
  'otro',
] as const

export function normalizeGeoKind(raw: unknown): GeoKind {
  const k = String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
  if ((GEO_KINDS as readonly string[]).includes(k)) return k as GeoKind
  if (k.includes('calle') || k.includes('av') || k.includes('ruta')) return 'calle'
  if (k.includes('barrio') || k.includes('colonia')) return 'barrio'
  if (k.includes('ciudad') || k.includes('pueblo')) return 'ciudad'
  if (k.includes('region') || k.includes('provincia') || k.includes('depto')) {
    return 'region'
  }
  if (k.includes('pais') || k.includes('country')) return 'pais'
  return 'lugar'
}

function parseAliases(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return JSON.stringify(
          parsed.map((a) => String(a).trim()).filter(Boolean),
        )
      }
    } catch {
      const list = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return JSON.stringify(list)
    }
  }
  if (Array.isArray(raw)) {
    return JSON.stringify(raw.map((a) => String(a).trim()).filter(Boolean))
  }
  return '[]'
}

function hydrate(r: {
  id: string
  name: string
  kind: string
  aliases: string | null
  notes: string | null
  status: string | null
  source: string
  merged_into: string | null
  created_at: string
  updated_at: string
}): Geografia {
  let aliases_list: string[] = []
  try {
    aliases_list = JSON.parse(r.aliases || '[]') as string[]
  } catch {
    aliases_list = []
  }
  return {
    id: r.id,
    name: r.name,
    kind: normalizeGeoKind(r.kind),
    aliases: r.aliases || '[]',
    aliases_list,
    notes: r.notes,
    status: r.status || 'active',
    source: r.source === 'extractor' ? 'extractor' : 'manual',
    merged_into: r.merged_into,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export function listGeografiaMasters(): Geografia[] {
  return rows<{
    id: string
    name: string
    kind: string
    aliases: string | null
    notes: string | null
    status: string | null
    source: string
    merged_into: string | null
    created_at: string
    updated_at: string
  }>(
    getDb()
      .prepare(
        `SELECT * FROM geografia
         WHERE source = 'manual'
           AND (status IS NULL OR status = 'active')
           AND (merged_into IS NULL OR merged_into = '')
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function listGeografiaWaiting(): Geografia[] {
  return rows<{
    id: string
    name: string
    kind: string
    aliases: string | null
    notes: string | null
    status: string | null
    source: string
    merged_into: string | null
    created_at: string
    updated_at: string
  }>(
    getDb()
      .prepare(
        `SELECT * FROM geografia
         WHERE source = 'extractor'
           AND (status IS NULL OR status IN ('active', 'waiting'))
           AND (merged_into IS NULL OR merged_into = '')
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function listAllGeografia(): Geografia[] {
  return rows<{
    id: string
    name: string
    kind: string
    aliases: string | null
    notes: string | null
    status: string | null
    source: string
    merged_into: string | null
    created_at: string
    updated_at: string
  }>(
    getDb()
      .prepare(
        `SELECT * FROM geografia
         WHERE (merged_into IS NULL OR merged_into = '')
           AND (status IS NULL OR status IN ('active', 'waiting'))
         ORDER BY source ASC, name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function getGeografia(id: string): Geografia | null {
  const r = row<{
    id: string
    name: string
    kind: string
    aliases: string | null
    notes: string | null
    status: string | null
    source: string
    merged_into: string | null
    created_at: string
    updated_at: string
  }>(getDb().prepare(`SELECT * FROM geografia WHERE id = ?`).get(id))
  return r ? hydrate(r) : null
}

export function createGeografia(input: {
  name?: unknown
  kind?: unknown
  aliases?: unknown
  notes?: unknown
  source?: 'manual' | 'extractor'
}): Geografia {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('name requerido')
  const kind = normalizeGeoKind(input.kind)
  const aliasesJson = parseAliases(input.aliases)
  const notes =
    input.notes !== undefined ? String(input.notes).trim() || null : null
  const source = input.source === 'extractor' ? 'extractor' : 'manual'
  const db = getDb()
  const clash = row<{ id: string }>(
    db
      .prepare(
        `SELECT id FROM geografia
         WHERE name = ? COLLATE NOCASE
           AND (merged_into IS NULL OR merged_into = '')
           AND source = ?`,
      )
      .get(name, source),
  )
  if (clash && source === 'manual') {
    throw new Error('Ya existe un lugar con ese nombre')
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO geografia (
      id, name, kind, aliases, notes, status, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(id, name, kind, aliasesJson, notes, source, now, now)
  return getGeografia(id)!
}

export function updateGeografia(
  id: string,
  patch: { name?: unknown; kind?: unknown; aliases?: unknown; notes?: unknown },
): Geografia {
  const existing = getGeografia(id)
  if (!existing) throw new Error('Lugar no encontrado')
  let name = existing.name
  if (patch.name !== undefined) {
    const next = String(patch.name).trim()
    if (!next) throw new Error('name no puede quedar vacío')
    name = next
  }
  const kind =
    patch.kind !== undefined ? normalizeGeoKind(patch.kind) : existing.kind
  const aliases =
    patch.aliases !== undefined
      ? parseAliases(patch.aliases)
      : existing.aliases
  const notes =
    patch.notes !== undefined
      ? String(patch.notes).trim() || null
      : existing.notes
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE geografia
       SET name = ?, kind = ?, aliases = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(name, kind, aliases, notes, now, id)
  return getGeografia(id)!
}

export function promoteGeografia(id: string): Geografia {
  const existing = getGeografia(id)
  if (!existing) throw new Error('Lugar no encontrado')
  if (existing.source === 'manual' && !existing.merged_into) {
    return existing
  }
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE geografia
       SET source = 'manual', status = 'active', merged_into = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(now, id)
  return getGeografia(id)!
}

export function deleteGeografia(id: string): { id: string } {
  const existing = getGeografia(id)
  if (!existing) throw new Error('Lugar no encontrado')
  const db = getDb()
  db.prepare(
    `DELETE FROM entity_links WHERE entity_kind = 'geografia' AND entity_id = ?`,
  ).run(id)
  db.prepare(`DELETE FROM geografia WHERE id = ?`).run(id)
  return { id }
}

/** Migra persons.kind=geografia (legado) → tabla geografia. */
export function migratePersonGeografiaToTable(database: DatabaseSync): void {
  const legacy = database
    .prepare(
      `SELECT * FROM persons
       WHERE kind = 'geografia'
         AND (merged_into IS NULL OR merged_into = '')`,
    )
    .all() as Array<{
    id: string
    name: string
    aliases: string | null
    notes: string | null
    status: string | null
    source: string
    created_at: string
    updated_at: string
  }>
  if (legacy.length === 0) return

  const insert = database.prepare(
    `INSERT OR IGNORE INTO geografia (
      id, name, kind, aliases, notes, status, source, created_at, updated_at
    ) VALUES (?, ?, 'lugar', ?, ?, ?, ?, ?, ?)`,
  )
  const mark = database.prepare(
    `UPDATE persons SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`,
  )
  const relink = database.prepare(
    `UPDATE entity_links
     SET entity_kind = 'geografia'
     WHERE entity_kind = 'person' AND entity_id = ?`,
  )
  const now = new Date().toISOString()
  let n = 0
  for (const p of legacy) {
    insert.run(
      p.id,
      p.name,
      p.aliases || '[]',
      p.notes,
      p.status || 'active',
      p.source === 'manual' ? 'manual' : 'extractor',
      p.created_at,
      p.updated_at,
    )
    relink.run(p.id)
    mark.run(p.id, now, p.id)
    n++
  }
  if (n > 0) {
    console.log(`[db] migrated ${n} person(geografia) → geografia`)
  }
}
