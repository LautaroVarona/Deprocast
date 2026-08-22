import type { DatabaseSync } from 'node:sqlite'
import { row, rows } from '../sql.js'
import type {
  AmaCell,
  AmaCycleSlot,
  AmaCycleState,
  AmaLink,
  AmaLinkObjectType,
  AmaLinkTargetKind,
  AmaList,
  AmaListHydrated,
  AmaListItem,
  AmaListKind,
  AmaLista6Parts,
  AmaMatrix,
  AmaMatrixHydrated,
  AmaNeoCell,
  AmaPlace,
} from '../types.js'

export const KIND_SIZE: Record<AmaListKind, number> = {
  tridente: 3,
  lista6: 6,
  base12: 12,
  base22: 22,
  base72: 72,
}

export const CYCLE_SLOTS: AmaCycleSlot[] = ['ayer', 'hoy', 'manana']

export const CYCLE_LABEL: Record<AmaCycleSlot, string> = {
  ayer: 'Ayer',
  hoy: 'Hoy',
  manana: 'Mañana',
}

export const TITLE_AXIS = [
  'Lista AmazonA',
  'Lista6 filas',
  'Lista6 columnas',
] as const

export function parseTags(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((t) => String(t).trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function stringifyTags(tags: unknown): string {
  if (typeof tags === 'string') {
    const parts = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return JSON.stringify(parts)
  }
  if (Array.isArray(tags)) {
    return JSON.stringify(tags.map((t) => String(t).trim()).filter(Boolean))
  }
  return '[]'
}

export function isListKind(value: unknown): value is AmaListKind {
  return (
    value === 'tridente' ||
    value === 'lista6' ||
    value === 'base12' ||
    value === 'base22' ||
    value === 'base72'
  )
}

export function isCycleSlot(value: unknown): value is AmaCycleSlot {
  return value === 'ayer' || value === 'hoy' || value === 'manana'
}

export function operationalSlot(
  stored: AmaCycleSlot,
  offset: number,
): AmaCycleSlot {
  const i = CYCLE_SLOTS.indexOf(stored)
  const shift = ((offset % 3) + 3) % 3
  return CYCLE_SLOTS[(i - shift + 3) % 3] as AmaCycleSlot
}

export function getCycleOffset(db: DatabaseSync): number {
  const state = row<{ offset: number }>(
    db.prepare(`SELECT offset FROM ama_cycle_state WHERE id = 'current'`).get(),
  )
  return state?.offset ?? 0
}

export function readCycleState(db: DatabaseSync): AmaCycleState {
  let state = row<{
    id: string
    offset: number
    hoy_started_at: string
  }>(db.prepare(`SELECT * FROM ama_cycle_state WHERE id = 'current'`).get())
  if (!state) {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO ama_cycle_state (id, offset, hoy_started_at) VALUES ('current', 0, ?)`,
    ).run(now)
    state = { id: 'current', offset: 0, hoy_started_at: now }
  }
  const offset = state.offset ?? 0
  return {
    id: 'current',
    offset,
    hoy_started_at: state.hoy_started_at,
    slots: CYCLE_SLOTS.map((id) => ({
      id,
      label: CYCLE_LABEL[id],
      operational: operationalSlot(id, offset),
    })),
  }
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function mapList(raw: AmaList): AmaList {
  return { ...raw, tags_list: parseTags(raw.tags) }
}

export function mapPlace(raw: AmaPlace): AmaPlace {
  return { ...raw, tags_list: parseTags(raw.tags) }
}

export function mapMatrix(raw: AmaMatrix): AmaMatrix {
  return { ...raw, tags_list: parseTags(raw.tags) }
}

function listTopItems(db: DatabaseSync, listId: string): AmaListItem[] {
  return rows<AmaListItem>(
    db
      .prepare(
        `SELECT i.*, p.name AS place_name
         FROM ama_list_items i
         LEFT JOIN ama_places p ON p.id = i.place_id
         WHERE i.list_id = ? AND i.parent_item_id IS NULL
         ORDER BY i.position ASC`,
      )
      .all(listId),
  )
}

function listChildren(db: DatabaseSync, parentId: string): AmaListItem[] {
  return rows<AmaListItem>(
    db
      .prepare(
        `SELECT i.*, p.name AS place_name
         FROM ama_list_items i
         LEFT JOIN ama_places p ON p.id = i.place_id
         WHERE i.parent_item_id = ?
         ORDER BY i.position ASC`,
      )
      .all(parentId),
  )
}

export function withChildren(
  db: DatabaseSync,
  items: AmaListItem[],
): AmaListItem[] {
  return items.map((item) => ({
    ...item,
    children: listChildren(db, item.id),
  }))
}

export function getComposition(
  db: DatabaseSync,
  listId: string,
): AmaLista6Parts | null {
  return (
    row<AmaLista6Parts>(
      db
        .prepare(
          `SELECT p.lista6_id, p.tridente_a_id, p.tridente_b_id,
                  a.title AS tridente_a_title, b.title AS tridente_b_title
           FROM ama_lista6_parts p
           LEFT JOIN ama_lists a ON a.id = p.tridente_a_id
           LEFT JOIN ama_lists b ON b.id = p.tridente_b_id
           WHERE p.lista6_id = ?`,
        )
        .get(listId),
    ) ?? null
  )
}

export function resolveListItems(
  db: DatabaseSync,
  listId: string,
): AmaListItem[] {
  const parts = getComposition(db, listId)
  if (parts) {
    const a = listTopItems(db, parts.tridente_a_id)
    const b = listTopItems(db, parts.tridente_b_id)
    return withChildren(db, [...a, ...b])
  }
  return withChildren(db, listTopItems(db, listId))
}

export function getListRow(db: DatabaseSync, id: string): AmaList | undefined {
  return row<AmaList>(db.prepare(`SELECT * FROM ama_lists WHERE id = ?`).get(id))
}

export function hydrateList(
  db: DatabaseSync,
  id: string,
): AmaListHydrated | null {
  const list = getListRow(db, id)
  if (!list) return null
  return {
    ...mapList(list),
    items: resolveListItems(db, id),
    composition: getComposition(db, id),
  }
}

export function decorateCell(cell: AmaCell, offset: number): AmaCell {
  return {
    ...cell,
    display_slot: cell.cycle_slot
      ? operationalSlot(cell.cycle_slot, offset)
      : null,
  }
}

export function decorateNeo(cell: AmaNeoCell, offset: number): AmaNeoCell {
  return {
    ...cell,
    display_slot: operationalSlot(cell.cycle_slot, offset),
  }
}

export function hydrateMatrix(
  db: DatabaseSync,
  id: string,
): AmaMatrixHydrated | null {
  const matrix = row<AmaMatrix>(
    db
      .prepare(
        `SELECT m.*,
                r.title AS row_title,
                c.title AS col_title
         FROM ama_matrices m
         JOIN ama_lists r ON r.id = m.row_list_id
         JOIN ama_lists c ON c.id = m.col_list_id
         WHERE m.id = ?`,
      )
      .get(id),
  )
  if (!matrix) return null
  const rowList = hydrateList(db, matrix.row_list_id)
  const colList = hydrateList(db, matrix.col_list_id)
  if (!rowList || !colList) return null
  const offset = getCycleOffset(db)
  const cells = rows<AmaCell>(
    db
      .prepare(
        `SELECT k.*, p.name AS place_name
         FROM ama_cells k
         LEFT JOIN ama_places p ON p.id = k.place_id
         WHERE k.matrix_id = ?`,
      )
      .all(id),
  ).map((cell) => decorateCell(cell, offset))
  const neo_cells = rows<AmaNeoCell>(
    db.prepare(`SELECT * FROM ama_neo_cells WHERE matrix_id = ?`).all(id),
  ).map((cell) => decorateNeo(cell, offset))
  return {
    ...mapMatrix(matrix),
    order_n: (matrix.order_n === 3 ? 3 : 6) as 3 | 6,
    row_list: rowList,
    col_list: colList,
    cells,
    neo_cells,
  }
}

export function listUses(
  db: DatabaseSync,
  listId: string,
): { as_part: number; as_axis: number } {
  const asPart = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ama_lista6_parts
         WHERE tridente_a_id = ? OR tridente_b_id = ?`,
      )
      .get(listId, listId),
  )
  const asAxis = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ama_matrices
         WHERE row_list_id = ? OR col_list_id = ?`,
      )
      .get(listId, listId),
  )
  return { as_part: asPart?.c ?? 0, as_axis: asAxis?.c ?? 0 }
}

export function targetExists(
  db: DatabaseSync,
  kind: AmaLinkTargetKind,
  id: string,
): boolean {
  if (kind === 'person') {
    return Boolean(
      row(db.prepare(`SELECT id FROM persons WHERE id = ?`).get(id)),
    )
  }
  if (kind === 'project') {
    return Boolean(
      row(db.prepare(`SELECT id FROM projects WHERE id = ?`).get(id)),
    )
  }
  if (kind === 'agrupacion') {
    return Boolean(
      row(db.prepare(`SELECT id FROM agrupaciones WHERE id = ?`).get(id)),
    )
  }
  return Boolean(
    row(db.prepare(`SELECT id FROM ama_places WHERE id = ?`).get(id)),
  )
}

export function targetLabel(
  db: DatabaseSync,
  kind: AmaLinkTargetKind,
  id: string,
): string {
  if (kind === 'person') {
    return (
      row<{ name: string }>(
        db.prepare(`SELECT name FROM persons WHERE id = ?`).get(id),
      )?.name ?? id
    )
  }
  if (kind === 'project') {
    return (
      row<{ title: string }>(
        db.prepare(`SELECT title FROM projects WHERE id = ?`).get(id),
      )?.title ?? id
    )
  }
  if (kind === 'agrupacion') {
    return (
      row<{ name: string }>(
        db.prepare(`SELECT name FROM agrupaciones WHERE id = ?`).get(id),
      )?.name ?? id
    )
  }
  return (
    row<{ name: string }>(
      db.prepare(`SELECT name FROM ama_places WHERE id = ?`).get(id),
    )?.name ?? id
  )
}

export function listLinks(
  db: DatabaseSync,
  objectType: AmaLinkObjectType,
  objectId: string,
): AmaLink[] {
  const raw = rows<AmaLink>(
    db
      .prepare(
        `SELECT * FROM ama_links
         WHERE object_type = ? AND object_id = ?
         ORDER BY created_at ASC`,
      )
      .all(objectType, objectId),
  )
  return raw.map((link) => ({
    ...link,
    target_label: targetLabel(db, link.target_kind, link.target_id),
  }))
}

export const LINK_OBJECT_TYPES: AmaLinkObjectType[] = [
  'list',
  'item',
  'matrix',
  'cell',
  'place',
  'flow',
]

export const LINK_TARGET_KINDS: AmaLinkTargetKind[] = [
  'person',
  'project',
  'place',
  'agrupacion',
]
