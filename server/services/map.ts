import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { row, rows } from '../sql.js'
import type {
  AmaFlow,
  AmaPlace,
  MapLayer,
  MapLayerKind,
  MapOccupancyCounts,
  MapOccupancyItem,
  MapOverview,
  MapSystem,
  MapTag,
} from '../types.js'
import {
  haversineMeters,
  mapPlace,
  targetExists,
  targetLabel,
} from './amazona.js'
import { cellAt, diskAround, H3_RES_URBAN, moonPhase } from './h3geo.js'
import { DEFAULT_LAYER_SPECS } from './mapSeed.js'

const DEFAULT_SYSTEM_ID = 'map-sys-pghqg'
const LAYER_KINDS: MapLayerKind[] = [
  'basemap',
  'fisico',
  'h3',
  'occupancy',
  'amazona',
  'aristas',
  'chronos',
  'tags',
  'custom',
]

function emptyCounts(placeId: string): MapOccupancyCounts {
  return {
    place_id: placeId,
    persons: 0,
    projects: 0,
    agrupaciones: 0,
    entries: 0,
    amazona_items: 0,
    amazona_cells: 0,
    tags: 0,
    total: 0,
  }
}

function bump(
  bag: Map<string, MapOccupancyCounts>,
  placeId: string,
  field: Exclude<keyof MapOccupancyCounts, 'place_id' | 'total'>,
  n: number,
): void {
  if (!placeId || n <= 0) return
  const cur = bag.get(placeId) ?? emptyCounts(placeId)
  cur[field] += n
  bag.set(placeId, cur)
}

export function listSystems(db: DatabaseSync): MapSystem[] {
  return rows<MapSystem>(
    db
      .prepare(
        `SELECT * FROM map_systems ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(),
  )
}

export function getSystem(
  db: DatabaseSync,
  id: string,
): MapSystem | undefined {
  return row<MapSystem>(
    db.prepare(`SELECT * FROM map_systems WHERE id = ?`).get(id),
  )
}

export function listLayers(db: DatabaseSync, systemId: string): MapLayer[] {
  return rows<MapLayer>(
    db
      .prepare(
        `SELECT * FROM map_layers WHERE system_id = ? ORDER BY z_index ASC`,
      )
      .all(systemId),
  )
}

export function listZones(db: DatabaseSync): AmaPlace[] {
  return rows<AmaPlace>(
    db
      .prepare(
        `SELECT * FROM ama_places
         ORDER BY
           CASE role
             WHEN 'nucleo' THEN 0
             WHEN 'sector' THEN 1
             WHEN 'ruta' THEN 2
             ELSE 3
           END,
           name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(mapPlace)
}

export function listMapFlows(db: DatabaseSync): AmaFlow[] {
  return rows<AmaFlow>(
    db
      .prepare(
        `SELECT f.*,
                a.name AS from_name, a.lat AS from_lat, a.lng AS from_lng,
                b.name AS to_name, b.lat AS to_lat, b.lng AS to_lng
         FROM ama_flows f
         JOIN ama_places a ON a.id = f.from_place_id
         JOIN ama_places b ON b.id = f.to_place_id
         ORDER BY f.recorded_at DESC`,
      )
      .all(),
  )
}

export function listTags(db: DatabaseSync, systemId: string): MapTag[] {
  return rows<MapTag>(
    db
      .prepare(
        `SELECT t.*, p.name AS place_name
         FROM map_tags t
         LEFT JOIN ama_places p ON p.id = t.place_id
         WHERE t.system_id = ?
         ORDER BY t.created_at DESC`,
      )
      .all(systemId),
  ).map((tag) => ({
    ...tag,
    target_label:
      tag.target_kind && tag.target_id
        ? tag.target_kind === 'entry'
          ? row<{ title: string }>(
              db
                .prepare(`SELECT title FROM entries WHERE id = ?`)
                .get(tag.target_id),
            )?.title ?? tag.target_id
          : tag.target_kind === 'person' ||
              tag.target_kind === 'project' ||
              tag.target_kind === 'agrupacion' ||
              tag.target_kind === 'place'
            ? targetLabel(db, tag.target_kind, tag.target_id)
            : tag.target_id
        : null,
  }))
}

export function occupancyCounts(db: DatabaseSync): MapOccupancyCounts[] {
  const bag = new Map<string, MapOccupancyCounts>()

  for (const r of rows<{ place_id: string; c: number }>(
    db
      .prepare(
        `SELECT place_id, COUNT(*) AS c FROM entries
         WHERE place_id IS NOT NULL GROUP BY place_id`,
      )
      .all(),
  )) {
    bump(bag, r.place_id, 'entries', r.c)
  }

  for (const r of rows<{ place_id: string; kind: string; c: number }>(
    db
      .prepare(
        `SELECT object_id AS place_id, target_kind AS kind, COUNT(*) AS c
         FROM ama_links
         WHERE object_type = 'place'
         GROUP BY object_id, target_kind`,
      )
      .all(),
  )) {
    if (r.kind === 'person') bump(bag, r.place_id, 'persons', r.c)
    else if (r.kind === 'project') bump(bag, r.place_id, 'projects', r.c)
    else if (r.kind === 'agrupacion') bump(bag, r.place_id, 'agrupaciones', r.c)
  }

  for (const r of rows<{ place_id: string; c: number }>(
    db
      .prepare(
        `SELECT place_id, COUNT(*) AS c FROM ama_list_items
         WHERE place_id IS NOT NULL GROUP BY place_id`,
      )
      .all(),
  )) {
    bump(bag, r.place_id, 'amazona_items', r.c)
  }

  for (const r of rows<{ place_id: string; c: number }>(
    db
      .prepare(
        `SELECT target_id AS place_id, COUNT(*) AS c FROM ama_links
         WHERE target_kind = 'place' GROUP BY target_id`,
      )
      .all(),
  )) {
    bump(bag, r.place_id, 'amazona_items', r.c)
  }

  for (const r of rows<{ place_id: string; c: number }>(
    db
      .prepare(
        `SELECT place_id, COUNT(*) AS c FROM ama_cells
         WHERE place_id IS NOT NULL GROUP BY place_id`,
      )
      .all(),
  )) {
    bump(bag, r.place_id, 'amazona_cells', r.c)
  }

  for (const r of rows<{ place_id: string; c: number }>(
    db
      .prepare(
        `SELECT place_id, COUNT(*) AS c FROM map_tags
         WHERE place_id IS NOT NULL GROUP BY place_id`,
      )
      .all(),
  )) {
    bump(bag, r.place_id, 'tags', r.c)
  }

  return [...bag.values()].map((c) => ({
    ...c,
    total:
      c.persons +
      c.projects +
      c.agrupaciones +
      c.entries +
      c.amazona_items +
      c.amazona_cells +
      c.tags,
  }))
}

export function occupancyDetail(
  db: DatabaseSync,
  placeId: string,
): MapOccupancyItem[] {
  const items: MapOccupancyItem[] = []

  for (const r of rows<{
    id: string
    target_id: string
    target_kind: 'person' | 'project' | 'agrupacion'
  }>(
    db
      .prepare(
        `SELECT id, target_id, target_kind FROM ama_links
         WHERE object_type = 'place' AND object_id = ?
           AND target_kind IN ('person', 'project', 'agrupacion')`,
      )
      .all(placeId),
  )) {
    items.push({
      kind: r.target_kind,
      id: r.target_id,
      label: targetLabel(db, r.target_kind, r.target_id),
      link_id: r.id,
    })
  }

  for (const r of rows<{
    id: string
    title: string
    source_type: string
    status: string
  }>(
    db
      .prepare(
        `SELECT id, title, source_type, status FROM entries
         WHERE place_id = ? ORDER BY created_at DESC LIMIT 80`,
      )
      .all(placeId),
  )) {
    items.push({
      kind: 'entry',
      id: r.id,
      label: r.title,
      subtitle: `${r.source_type} · ${r.status}`,
    })
  }

  for (const r of rows<{ id: string; label: string; list_title: string }>(
    db
      .prepare(
        `SELECT i.id, i.label, l.title AS list_title
         FROM ama_list_items i
         JOIN ama_lists l ON l.id = i.list_id
         WHERE i.place_id = ?
         ORDER BY l.title COLLATE NOCASE ASC`,
      )
      .all(placeId),
  )) {
    items.push({
      kind: 'item',
      id: r.id,
      label: r.label || r.id,
      subtitle: r.list_title,
    })
  }

  for (const r of rows<{ id: string; title: string | null; notes: string }>(
    db
      .prepare(
        `SELECT id, title, notes FROM ama_cells WHERE place_id = ?`,
      )
      .all(placeId),
  )) {
    items.push({
      kind: 'cell',
      id: r.id,
      label: r.title?.trim() || 'Celda AmazonA',
      subtitle: r.notes.slice(0, 80) || undefined,
    })
  }

  for (const r of rows<{ id: string; label: string; notes: string }>(
    db
      .prepare(
        `SELECT id, label, notes FROM map_tags WHERE place_id = ?
         ORDER BY created_at DESC`,
      )
      .all(placeId),
  )) {
    items.push({
      kind: 'tag',
      id: r.id,
      label: r.label,
      subtitle: r.notes || undefined,
    })
  }

  return items
}

export function nearestPlace(
  db: DatabaseSync,
  lat: number,
  lng: number,
  maxMeters = 700,
): AmaPlace | null {
  const places = listZones(db).filter(
    (p) => p.lat != null && p.lng != null,
  )
  let best: { place: AmaPlace; meters: number } | null = null
  for (const place of places) {
    const meters = haversineMeters(lat, lng, place.lat as number, place.lng as number)
    if (!best || meters < best.meters) best = { place, meters }
  }
  if (!best || best.meters > maxMeters) return null
  return best.place
}

export function createSystem(
  db: DatabaseSync,
  body: {
    name: string
    notes?: string
    center_lat: number
    center_lng: number
    zoom?: number
    pitch?: number
    bearing?: number
    copy_from?: string | null
  },
): MapSystem {
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO map_systems (
      id, name, notes, center_lat, center_lng, zoom, pitch, bearing, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.name,
    body.notes ?? '',
    body.center_lat,
    body.center_lng,
    body.zoom ?? 13,
    body.pitch ?? 45,
    body.bearing ?? 0,
    now,
    now,
  )
  const sourceId = body.copy_from || DEFAULT_SYSTEM_ID
  const sourceLayers = listLayers(db, sourceId)
  const specs =
    sourceLayers.length > 0
      ? sourceLayers.map((layer) => ({
          kind: layer.kind,
          title: layer.title,
          z: layer.z_index,
          opacity: layer.opacity,
          visible: layer.visible,
        }))
      : DEFAULT_LAYER_SPECS.map((layer) => ({
          kind: layer.kind,
          title: layer.title,
          z: layer.z,
          opacity: layer.opacity,
          visible: 1,
        }))
  for (const spec of specs) {
    db.prepare(
      `INSERT INTO map_layers (
        id, system_id, kind, title, visible, opacity, z_index, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      randomUUID(),
      id,
      spec.kind,
      spec.title,
      spec.visible,
      spec.opacity,
      spec.z,
      now,
      now,
    )
  }
  return getSystem(db, id) as MapSystem
}

export function patchSystem(
  db: DatabaseSync,
  id: string,
  body: Partial<
    Pick<
      MapSystem,
      'name' | 'notes' | 'center_lat' | 'center_lng' | 'zoom' | 'pitch' | 'bearing'
    >
  >,
): MapSystem | undefined {
  const existing = getSystem(db, id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE map_systems
     SET name = ?, notes = ?, center_lat = ?, center_lng = ?,
         zoom = ?, pitch = ?, bearing = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    body.name ?? existing.name,
    body.notes ?? existing.notes,
    body.center_lat ?? existing.center_lat,
    body.center_lng ?? existing.center_lng,
    body.zoom ?? existing.zoom,
    body.pitch ?? existing.pitch,
    body.bearing ?? existing.bearing,
    now,
    id,
  )
  return getSystem(db, id)
}

export function deleteSystem(db: DatabaseSync, id: string): boolean {
  if (id === DEFAULT_SYSTEM_ID) return false
  if (!getSystem(db, id)) return false
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM map_tags WHERE system_id = ?`).run(id)
    db.prepare(`DELETE FROM map_layers WHERE system_id = ?`).run(id)
    db.prepare(`DELETE FROM map_systems WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}

export function patchLayer(
  db: DatabaseSync,
  id: string,
  body: { visible?: number; opacity?: number; title?: string },
): MapLayer | undefined {
  const existing = row<MapLayer>(
    db.prepare(`SELECT * FROM map_layers WHERE id = ?`).get(id),
  )
  if (!existing) return undefined
  const now = new Date().toISOString()
  const visible =
    body.visible == null ? existing.visible : body.visible ? 1 : 0
  const opacity =
    body.opacity == null
      ? existing.opacity
      : Math.max(0, Math.min(1, Number(body.opacity)))
  db.prepare(
    `UPDATE map_layers
     SET visible = ?, opacity = ?, title = ?, updated_at = ?
     WHERE id = ?`,
  ).run(visible, opacity, body.title ?? existing.title, now, id)
  return row<MapLayer>(
    db.prepare(`SELECT * FROM map_layers WHERE id = ?`).get(id),
  )
}

export function createTag(
  db: DatabaseSync,
  body: {
    system_id: string
    lat: number
    lng: number
    label: string
    notes?: string
    place_id?: string | null
    layer_id?: string | null
    target_kind?: string | null
    target_id?: string | null
  },
): MapTag {
  const now = new Date().toISOString()
  const id = randomUUID()
  const snapped =
    body.place_id || nearestPlace(db, body.lat, body.lng)?.id || null
  db.prepare(
    `INSERT INTO map_tags (
      id, system_id, layer_id, lat, lng, h3_index, place_id,
      label, notes, target_kind, target_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.system_id,
    body.layer_id ?? null,
    body.lat,
    body.lng,
    cellAt(body.lat, body.lng),
    snapped,
    body.label,
    body.notes ?? '',
    body.target_kind ?? null,
    body.target_id ?? null,
    now,
    now,
  )
  return listTags(db, body.system_id).find((t) => t.id === id) as MapTag
}

export function deleteTag(db: DatabaseSync, id: string): boolean {
  const existing = row<{ id: string }>(
    db.prepare(`SELECT id FROM map_tags WHERE id = ?`).get(id),
  )
  if (!existing) return false
  db.prepare(`DELETE FROM map_tags WHERE id = ?`).run(id)
  return true
}

export function occupy(
  db: DatabaseSync,
  body: {
    place_id: string
    kind: 'person' | 'project' | 'agrupacion' | 'entry'
    id: string
  },
): { ok: true } | { error: string; status: number } {
  const place = row<{ id: string }>(
    db.prepare(`SELECT id FROM ama_places WHERE id = ?`).get(body.place_id),
  )
  if (!place) return { error: 'Zona no encontrada', status: 404 }
  if (body.kind === 'entry') {
    const entry = row<{ id: string }>(
      db.prepare(`SELECT id FROM entries WHERE id = ?`).get(body.id),
    )
    if (!entry) return { error: 'Ingesta no encontrada', status: 404 }
    db.prepare(`UPDATE entries SET place_id = ? WHERE id = ?`).run(
      body.place_id,
      body.id,
    )
    return { ok: true }
  }
  if (!targetExists(db, body.kind, body.id)) {
    return { error: 'Entidad no encontrada', status: 404 }
  }
  try {
    db.prepare(
      `INSERT INTO ama_links (
        id, object_type, object_id, target_kind, target_id, role, created_at
      ) VALUES (?, 'place', ?, ?, ?, 'ocupa', ?)`,
    ).run(randomUUID(), body.place_id, body.kind, body.id, new Date().toISOString())
  } catch {
    return { error: 'Ese vínculo ya existe', status: 409 }
  }
  return { ok: true }
}

export function unoccupy(
  db: DatabaseSync,
  body: {
    place_id: string
    kind: 'person' | 'project' | 'agrupacion' | 'entry'
    id: string
  },
): boolean {
  if (body.kind === 'entry') {
    db.prepare(
      `UPDATE entries SET place_id = NULL WHERE id = ? AND place_id = ?`,
    ).run(body.id, body.place_id)
    return true
  }
  const info = db
    .prepare(
      `DELETE FROM ama_links
       WHERE object_type = 'place' AND object_id = ?
         AND target_kind = ? AND target_id = ?`,
    )
    .run(body.place_id, body.kind, body.id)
  return Number(info.changes ?? 0) > 0
}

export function searchEntries(
  db: DatabaseSync,
  q: string,
): Array<{
  id: string
  title: string
  status: string
  source_type: string
  place_id: string | null
}> {
  const needle = `%${q.trim()}%`
  return rows(
    db
      .prepare(
        `SELECT id, title, status, source_type, place_id
         FROM entries
         WHERE title LIKE ? OR ifnull(content_raw, '') LIKE ?
         ORDER BY created_at DESC
         LIMIT 12`,
      )
      .all(needle, needle),
  )
}

export function isLayerKind(value: unknown): value is MapLayerKind {
  return typeof value === 'string' && LAYER_KINDS.includes(value as MapLayerKind)
}

export function buildOverview(
  db: DatabaseSync,
  systemId?: string,
): MapOverview | { error: string } {
  const systems = listSystems(db)
  const chosen =
    (systemId ? getSystem(db, systemId) : undefined) ??
    getSystem(db, DEFAULT_SYSTEM_ID) ??
    systems[0]
  if (!chosen) return { error: 'No hay sistemas de mapa' }
  return {
    system: chosen,
    systems,
    layers: listLayers(db, chosen.id),
    zones: listZones(db),
    tags: listTags(db, chosen.id),
    occupancy: occupancyCounts(db),
    flows: listMapFlows(db),
    moon: moonPhase(),
  }
}

export function h3Radar(
  lat: number,
  lng: number,
  res: number,
  k: number,
): { cell: string; disk: string[]; resolution: number } {
  const safeRes = res === 7 ? 7 : H3_RES_URBAN
  const result = diskAround(lat, lng, safeRes, k)
  return { ...result, resolution: safeRes }
}

export { DEFAULT_SYSTEM_ID }
