import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type { Dominio } from '../types.js'

/** Semillas fijas: no se borran ni se renombran. */
export const FIXED_DOMINIOS: Array<{
  id: string
  name: string
  notes: string
}> = [
  {
    id: 'dom-salud',
    name: 'Salud',
    notes: 'Soma, nutrición, carga, sueño, estudios clínicos.',
  },
  {
    id: 'dom-finanzas',
    name: 'Finanzas',
    notes: 'Hechos económicos, libro mayor, liquidez, tributario.',
  },
  {
    id: 'dom-derecho',
    name: 'Derecho',
    notes: 'Norma, fuero, plazos, expedientes, pactos.',
  },
  {
    id: 'dom-tecnologia',
    name: 'Tecnología',
    notes: 'Software, pipelines, agentes, herramientas, código.',
  },
  {
    id: 'dom-arte',
    name: 'Arte',
    notes: 'Obra, relato, estética, práctica creativa.',
  },
]

export function seedDominios(database: DatabaseSync): void {
  const now = new Date().toISOString()
  const insert = database.prepare(
    `INSERT OR IGNORE INTO dominios (
      id, name, notes, is_fixed, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?)`,
  )
  for (const d of FIXED_DOMINIOS) {
    insert.run(d.id, d.name, d.notes, now, now)
  }
}

function hydrate(r: {
  id: string
  name: string
  notes: string | null
  is_fixed: number
  created_at: string
  updated_at: string
}): Dominio {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    is_fixed: r.is_fixed ? 1 : 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export function listDominios(): Dominio[] {
  return rows<{
    id: string
    name: string
    notes: string | null
    is_fixed: number
    created_at: string
    updated_at: string
  }>(
    getDb()
      .prepare(
        `SELECT * FROM dominios
         ORDER BY is_fixed DESC, name COLLATE NOCASE ASC`,
      )
      .all(),
  ).map(hydrate)
}

export function getDominio(id: string): Dominio | null {
  const r = row<{
    id: string
    name: string
    notes: string | null
    is_fixed: number
    created_at: string
    updated_at: string
  }>(getDb().prepare(`SELECT * FROM dominios WHERE id = ?`).get(id))
  return r ? hydrate(r) : null
}

export function createDominio(input: {
  name?: unknown
  notes?: unknown
}): Dominio {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('name requerido')
  const notes =
    input.notes !== undefined ? String(input.notes).trim() || null : null
  const db = getDb()
  const clash = row<{ id: string }>(
    db
      .prepare(`SELECT id FROM dominios WHERE name = ? COLLATE NOCASE`)
      .get(name),
  )
  if (clash) throw new Error('Ya existe un dominio con ese nombre')
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO dominios (id, name, notes, is_fixed, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(id, name, notes, now, now)
  return getDominio(id)!
}

export function updateDominio(
  id: string,
  patch: { name?: unknown; notes?: unknown },
): Dominio {
  const existing = getDominio(id)
  if (!existing) throw new Error('Dominio no encontrado')
  let name = existing.name
  if (patch.name !== undefined) {
    if (existing.is_fixed) {
      throw new Error('Los dominios fijos no se renombran')
    }
    const next = String(patch.name).trim()
    if (!next) throw new Error('name no puede quedar vacío')
    const clash = row<{ id: string }>(
      getDb()
        .prepare(
          `SELECT id FROM dominios WHERE name = ? COLLATE NOCASE AND id != ?`,
        )
        .get(next, id),
    )
    if (clash) throw new Error('Ya existe un dominio con ese nombre')
    name = next
  }
  const notes =
    patch.notes !== undefined
      ? String(patch.notes).trim() || null
      : existing.notes
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE dominios SET name = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, notes, now, id)
  return getDominio(id)!
}

/** Quita el id de domain_ids en fichas IDA. */
function scrubIdaDomainRefs(domainId: string): void {
  const db = getDb()
  const items = rows<{ id: string; domain_ids: string }>(
    db.prepare(`SELECT id, domain_ids FROM depro_ida_items`).all(),
  )
  const update = db.prepare(
    `UPDATE depro_ida_items SET domain_ids = ?, updated_at = ? WHERE id = ?`,
  )
  const now = new Date().toISOString()
  for (const item of items) {
    let ids: string[] = []
    try {
      const parsed = JSON.parse(item.domain_ids || '[]') as unknown
      if (Array.isArray(parsed)) {
        ids = parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      ids = []
    }
    if (!ids.includes(domainId)) continue
    update.run(
      JSON.stringify(ids.filter((x) => x !== domainId)),
      now,
      item.id,
    )
  }
}

export function deleteDominio(id: string): { id: string } {
  const existing = getDominio(id)
  if (!existing) throw new Error('Dominio no encontrado')
  if (existing.is_fixed) {
    throw new Error('Los dominios fijos no se pueden borrar')
  }
  scrubIdaDomainRefs(id)
  getDb().prepare(`DELETE FROM dominios WHERE id = ?`).run(id)
  return { id }
}

/** Filtra a IDs que existen en la tabla dominios. */
export function normalizeDomainIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const wanted = [
    ...new Set(
      raw
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ]
  if (wanted.length === 0) return []
  const existing = new Set(listDominios().map((d) => d.id))
  return wanted.filter((id) => existing.has(id))
}
