/**
 * Geografía: lugares del corpus + gazetteer administrativo (parent_id recursivo).
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type { Geografia, GeoKind } from '../types.js'
import { buildAcyclicForest } from './descendants.js'

export const GEO_KINDS = [
  'lugar',
  'calle',
  'ciudad',
  'barrio',
  'region',
  'pais',
  'otro',
] as const

const ADMIN_DEPTH: Record<string, number> = {
  comarca: 5,
  provincia: 4,
  comunidad_autonoma: 3,
  nacion: 2,
  continente: 1,
}

export type GeografiaTreeNode = Geografia & { children: GeografiaTreeNode[] }

export type GeografiaMapPayload = {
  node: Geografia
  ancestors: Geografia[]
  children: Geografia[]
  features: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      id: string
      properties: {
        id: string
        name: string
        human_weight: number
        admin_type: string | null
        role: 'self' | 'child'
      }
      geometry: unknown
    }>
  }
  bbox: [number, number, number, number] | null
}

type GeoRow = {
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
  parent_id?: string | null
  admin_type?: string | null
  admin_code?: string | null
  capital_name?: string | null
  iso_country?: string | null
  human_weight?: number | null
  sort_order?: number | null
}

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

function foldName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hydrate(r: GeoRow): Geografia {
  let aliases_list: string[] = []
  try {
    aliases_list = JSON.parse(r.aliases || '[]') as string[]
  } catch {
    aliases_list = []
  }
  const source =
    r.source === 'extractor'
      ? 'extractor'
      : r.source === 'official'
        ? 'official'
        : 'manual'
  return {
    id: r.id,
    name: r.name,
    kind: normalizeGeoKind(r.kind),
    aliases: r.aliases || '[]',
    aliases_list,
    notes: r.notes,
    status: r.status || 'active',
    source,
    merged_into: r.merged_into,
    created_at: r.created_at,
    updated_at: r.updated_at,
    parent_id: r.parent_id ?? null,
    admin_type: r.admin_type ?? null,
    admin_code: r.admin_code ?? null,
    capital_name: r.capital_name ?? null,
    iso_country: r.iso_country ?? null,
    human_weight: Number(r.human_weight ?? 0),
    sort_order: Number(r.sort_order ?? 0),
  }
}

function selectAll(): string {
  return `SELECT * FROM geografia`
}

export function listGeografiaMasters(): Geografia[] {
  return rows<GeoRow>(
    getDb()
      .prepare(
        `${selectAll()}
         WHERE source IN ('manual', 'official')
           AND (status IS NULL OR status = 'active')
           AND (merged_into IS NULL OR merged_into = '')
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function listGeografiaWaiting(): Geografia[] {
  return rows<GeoRow>(
    getDb()
      .prepare(
        `${selectAll()}
         WHERE source = 'extractor'
           AND (status IS NULL OR status IN ('active', 'waiting'))
           AND (merged_into IS NULL OR merged_into = '')
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function listAllGeografia(): Geografia[] {
  return rows<GeoRow>(
    getDb()
      .prepare(
        `${selectAll()}
         WHERE (merged_into IS NULL OR merged_into = '')
           AND (status IS NULL OR status IN ('active', 'waiting'))
         ORDER BY source ASC, sort_order ASC, name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function getGeografia(id: string): Geografia | null {
  const r = row<GeoRow>(
    getDb().prepare(`${selectAll()} WHERE id = ?`).get(id),
  )
  return r ? hydrate(r) : null
}

export function findGeografiaMatch(name: string): Geografia | null {
  const needle = foldName(name)
  if (needle.length < 2) return null
  const pool = listGeografiaMasters()
  const hits: Geografia[] = []
  for (const g of pool) {
    const names = [g.name, ...(g.aliases_list ?? [])]
    if (names.some((n) => foldName(n) === needle)) hits.push(g)
  }
  if (hits.length === 0) return null
  hits.sort(
    (a, b) =>
      (ADMIN_DEPTH[b.admin_type ?? ''] ?? 0) -
      (ADMIN_DEPTH[a.admin_type ?? ''] ?? 0),
  )
  return hits[0] ?? null
}

export function listGeografiaTree(): GeografiaTreeNode[] {
  const all = listGeografiaMasters()
  return buildAcyclicForest(
    all.map((g) => ({ ...g, parent_id: g.parent_id ?? null })),
  ) as GeografiaTreeNode[]
}

function ancestorsOf(id: string): Geografia[] {
  const chain: Geografia[] = []
  let cur = getGeografia(id)
  const seen = new Set<string>()
  while (cur?.parent_id && !seen.has(cur.parent_id)) {
    seen.add(cur.parent_id)
    const p = getGeografia(cur.parent_id)
    if (!p) break
    chain.unshift(p)
    cur = p
  }
  return chain
}

function childrenOf(id: string): Geografia[] {
  return rows<GeoRow>(
    getDb()
      .prepare(
        `${selectAll()}
         WHERE parent_id = ?
           AND (merged_into IS NULL OR merged_into = '')
           AND (status IS NULL OR status = 'active')
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
      )
      .all(id),
  ).map(hydrate)
}

type GeomRow = {
  geografia_id: string
  geojson: string
  bbox_west: number | null
  bbox_south: number | null
  bbox_east: number | null
  bbox_north: number | null
}

function loadGeom(id: string): GeomRow | null {
  return (
    row<GeomRow>(
      getDb()
        .prepare(
          `SELECT geografia_id, geojson, bbox_west, bbox_south, bbox_east, bbox_north
           FROM geografia_geom WHERE geografia_id = ?`,
        )
        .get(id),
    ) ?? null
  )
}

function parseGeom(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function unionBbox(
  boxes: Array<[number, number, number, number]>,
): [number, number, number, number] | null {
  if (boxes.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const b of boxes) {
    w = Math.min(w, b[0])
    s = Math.min(s, b[1])
    e = Math.max(e, b[2])
    n = Math.max(n, b[3])
  }
  if (!Number.isFinite(w)) return null
  return [w, s, e, n]
}

export function getGeografiaMap(id: string): GeografiaMapPayload | null {
  const node = getGeografia(id)
  if (!node) return null
  const ancestors = ancestorsOf(id)
  const children = childrenOf(id)
  const features: GeografiaMapPayload['features']['features'] = []
  const boxes: Array<[number, number, number, number]> = []

  const pushFeat = (g: Geografia, role: 'self' | 'child') => {
    const geomRow = loadGeom(g.id)
    if (!geomRow) return
    const geometry = parseGeom(geomRow.geojson)
    if (!geometry) return
    features.push({
      type: 'Feature',
      id: g.id,
      properties: {
        id: g.id,
        name: g.name,
        human_weight: g.human_weight ?? 0,
        admin_type: g.admin_type ?? null,
        role,
      },
      geometry,
    })
    if (
      geomRow.bbox_west != null &&
      geomRow.bbox_south != null &&
      geomRow.bbox_east != null &&
      geomRow.bbox_north != null
    ) {
      boxes.push([
        geomRow.bbox_west,
        geomRow.bbox_south,
        geomRow.bbox_east,
        geomRow.bbox_north,
      ])
    }
  }

  pushFeat(node, 'self')
  for (const c of children) pushFeat(c, 'child')

  return {
    node,
    ancestors,
    children,
    features: { type: 'FeatureCollection', features },
    bbox: unionBbox(boxes),
  }
}

export function createGeografia(input: {
  name?: unknown
  kind?: unknown
  aliases?: unknown
  notes?: unknown
  source?: 'manual' | 'extractor'
  parent_id?: unknown
}): Geografia {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('name requerido')
  const matched = findGeografiaMatch(name)
  if (matched) return matched
  const kind = normalizeGeoKind(input.kind)
  const aliasesJson = parseAliases(input.aliases)
  const notes =
    input.notes !== undefined ? String(input.notes).trim() || null : null
  const source = input.source === 'extractor' ? 'extractor' : 'manual'
  const parentId =
    input.parent_id != null && String(input.parent_id).trim()
      ? String(input.parent_id).trim()
      : null
  if (parentId && !getGeografia(parentId)) {
    throw new Error('parent_id no encontrado')
  }
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
      id, name, kind, aliases, notes, status, source, parent_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(id, name, kind, aliasesJson, notes, source, parentId, now, now)
  return getGeografia(id)!
}

export function updateGeografia(
  id: string,
  patch: {
    name?: unknown
    kind?: unknown
    aliases?: unknown
    notes?: unknown
    parent_id?: unknown
    human_weight?: unknown
    admin_type?: unknown
    capital_name?: unknown
  },
): Geografia {
  const existing = getGeografia(id)
  if (!existing) throw new Error('Lugar no encontrado')
  const official = existing.source === 'official'
  let name = existing.name
  if (patch.name !== undefined && !official) {
    const next = String(patch.name).trim()
    if (!next) throw new Error('name no puede quedar vacío')
    name = next
  }
  const kind =
    patch.kind !== undefined && !official
      ? normalizeGeoKind(patch.kind)
      : existing.kind
  const aliases =
    patch.aliases !== undefined
      ? parseAliases(patch.aliases)
      : existing.aliases
  const notes =
    patch.notes !== undefined
      ? String(patch.notes).trim() || null
      : existing.notes
  let parentId = existing.parent_id ?? null
  if (patch.parent_id !== undefined && !official) {
    const raw = patch.parent_id
    parentId =
      raw == null || String(raw).trim() === '' ? null : String(raw).trim()
    if (parentId === id) throw new Error('parent_id no puede ser el mismo nodo')
    if (parentId && !getGeografia(parentId)) {
      throw new Error('parent_id no encontrado')
    }
  }
  let weight = existing.human_weight ?? 0
  if (patch.human_weight !== undefined) {
    const n = Number(patch.human_weight)
    if (!Number.isFinite(n)) throw new Error('human_weight inválido')
    weight = Math.max(0, Math.min(12, Math.round(n)))
  }
  const capital =
    patch.capital_name !== undefined && !official
      ? String(patch.capital_name).trim() || null
      : existing.capital_name
  const adminType =
    patch.admin_type !== undefined && !official
      ? String(patch.admin_type).trim() || null
      : existing.admin_type
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE geografia
       SET name = ?, kind = ?, aliases = ?, notes = ?, parent_id = ?,
           human_weight = ?, capital_name = ?, admin_type = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      name,
      kind,
      aliases,
      notes ?? null,
      parentId ?? null,
      weight,
      capital ?? null,
      adminType ?? null,
      now,
      id,
    )
  return getGeografia(id)!
}

export function promoteGeografia(id: string): Geografia {
  const existing = getGeografia(id)
  if (!existing) throw new Error('Lugar no encontrado')
  if (existing.source === 'official') return existing
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
  if (existing.source === 'official') {
    throw new Error('No se puede borrar un nodo oficial del gazetteer')
  }
  const kids = childrenOf(id)
  if (kids.length > 0) {
    throw new Error('El lugar tiene hijos; reasigna o bórralos antes')
  }
  const db = getDb()
  db.prepare(
    `DELETE FROM entity_links WHERE entity_kind = 'geografia' AND entity_id = ?`,
  ).run(id)
  db.prepare(`DELETE FROM geografia_geom WHERE geografia_id = ?`).run(id)
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
