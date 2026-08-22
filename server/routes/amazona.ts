import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  AmaCell,
  AmaCycleSlot,
  AmaFlow,
  AmaLinkObjectType,
  AmaLinkTargetKind,
  AmaList,
  AmaListItem,
  AmaListKind,
  AmaMatrix,
  AmaNeoCell,
  AmaPlace,
  AmaPlaceKind,
} from '../types.js'
import {
  KIND_SIZE,
  LINK_OBJECT_TYPES,
  LINK_TARGET_KINDS,
  decorateCell,
  getCycleOffset,
  haversineMeters,
  hydrateList,
  hydrateMatrix,
  isCycleSlot,
  isListKind,
  listLinks,
  listUses,
  mapList,
  mapMatrix,
  mapPlace,
  operationalSlot,
  readCycleState,
  stringifyTags,
  targetExists,
} from '../services/amazona.js'

export const amazonaRouter = Router()

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function countFilled(db: ReturnType<typeof getDb>, listId: string): number {
  const rowN = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ama_list_items
         WHERE list_id = ? AND parent_item_id IS NULL AND trim(label) != ''`,
      )
      .get(listId),
  )
  return rowN?.c ?? 0
}

amazonaRouter.get('/overview', (_req, res) => {
  const db = getDb()
  const n = (sql: string) =>
    row<{ c: number }>(db.prepare(sql).get())?.c ?? 0
  res.json({
    ok: true,
    overview: {
      lists: n(`SELECT COUNT(*) AS c FROM ama_lists`),
      tridentes: n(
        `SELECT COUNT(*) AS c FROM ama_lists WHERE kind = 'tridente'`,
      ),
      listas6: n(`SELECT COUNT(*) AS c FROM ama_lists WHERE kind = 'lista6'`),
      matrices6: n(`SELECT COUNT(*) AS c FROM ama_matrices WHERE order_n = 6`),
      matrices3: n(`SELECT COUNT(*) AS c FROM ama_matrices WHERE order_n = 3`),
      places: n(`SELECT COUNT(*) AS c FROM ama_places`),
      flows: n(`SELECT COUNT(*) AS c FROM ama_flows`),
    },
    cycle: readCycleState(db),
  })
})

amazonaRouter.get('/cycle', (_req, res) => {
  res.json({ ok: true, cycle: readCycleState(getDb()) })
})

amazonaRouter.post('/cycle/advance', (_req, res) => {
  const db = getDb()
  const now = new Date().toISOString()
  readCycleState(db)
  const current = readCycleState(db)
  const next = (current.offset + 1) % 3
  db.prepare(
    `UPDATE ama_cycle_state SET offset = ?, hoy_started_at = ? WHERE id = 'current'`,
  ).run(next, now)
  res.json({ ok: true, cycle: readCycleState(db) })
})

amazonaRouter.get('/lists', (req, res) => {
  const db = getDb()
  const kind = asString(req.query.kind)
  const q = asString(req.query.q).toLowerCase()
  const all = rows<AmaList>(
    db
      .prepare(
        `SELECT * FROM ama_lists
         ORDER BY kind ASC, title COLLATE NOCASE ASC`,
      )
      .all(),
  )
    .map(mapList)
    .filter((list) => (kind && isListKind(kind) ? list.kind === kind : true))
    .filter((list) => {
      if (!q) return true
      return (
        list.title.toLowerCase().includes(q) ||
        list.notes.toLowerCase().includes(q) ||
        (list.tags_list ?? []).some((t) => t.toLowerCase().includes(q))
      )
    })
    .map((list) => ({
      ...list,
      item_count: countFilled(db, list.id),
    }))
  res.json({ ok: true, lists: all })
})

amazonaRouter.post('/lists', (req, res) => {
  const db = getDb()
  const body = req.body as {
    title?: string
    notes?: string
    kind?: AmaListKind
    tags?: unknown
    tridente_a_id?: string
    tridente_b_id?: string
    items?: Array<{ label?: string; notes?: string }>
  }
  const title = asString(body.title)
  if (!title) {
    res.status(400).json({ error: 'Título requerido' })
    return
  }
  const kind = body.kind
  if (!isListKind(kind)) {
    res.status(400).json({ error: 'kind inválido' })
    return
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  const size = KIND_SIZE[kind]
  const composed =
    kind === 'lista6' &&
    asString(body.tridente_a_id) &&
    asString(body.tridente_b_id)

  if (composed) {
    const a = hydrateList(db, asString(body.tridente_a_id))
    const b = hydrateList(db, asString(body.tridente_b_id))
    if (!a || a.kind !== 'tridente' || !b || b.kind !== 'tridente') {
      res.status(400).json({ error: 'Hace falta dos Tridentes' })
      return
    }
    if (a.id === b.id) {
      res.status(400).json({ error: 'Los dos Tridentes tienen que ser distintos' })
      return
    }
    db.prepare(
      `INSERT INTO ama_lists (id, title, notes, size, kind, source, tags, created_at, updated_at)
       VALUES (?, ?, ?, 6, 'lista6', 'composed', ?, ?, ?)`,
    ).run(id, title, asString(body.notes), stringifyTags(body.tags), now, now)
    db.prepare(
      `INSERT INTO ama_lista6_parts (lista6_id, tridente_a_id, tridente_b_id)
       VALUES (?, ?, ?)`,
    ).run(id, a.id, b.id)
  } else {
    db.prepare(
      `INSERT INTO ama_lists (id, title, notes, size, kind, source, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
    ).run(
      id,
      title,
      asString(body.notes),
      size,
      kind,
      stringifyTags(body.tags),
      now,
      now,
    )
    const incoming = Array.isArray(body.items) ? body.items : []
    for (let i = 0; i < size; i++) {
      const slot = incoming[i]
      db.prepare(
        `INSERT INTO ama_list_items (
          id, list_id, position, label, notes, place_id, parent_item_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      ).run(
        randomUUID(),
        id,
        i,
        asString(slot?.label),
        asString(slot?.notes),
        now,
        now,
      )
    }
  }

  const hydrated = hydrateList(db, id)
  res.status(201).json({ ok: true, list: hydrated })
})

amazonaRouter.get('/lists/:id', (req, res) => {
  const hydrated = hydrateList(getDb(), String(req.params.id))
  if (!hydrated) {
    res.status(404).json({ error: 'Lista no encontrada' })
    return
  }
  res.json({
    ok: true,
    list: hydrated,
    links: listLinks(getDb(), 'list', hydrated.id),
  })
})

amazonaRouter.patch('/lists/:id', (req, res) => {
  const db = getDb()
  const existing = hydrateList(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Lista no encontrada' })
    return
  }
  const body = req.body as {
    title?: string
    notes?: string
    tags?: unknown
    tridente_a_id?: string
    tridente_b_id?: string
  }
  const title = body.title != null ? asString(body.title) : existing.title
  const notes = body.notes != null ? asString(body.notes) : existing.notes
  const tags =
    body.tags != null ? stringifyTags(body.tags) : existing.tags
  if (!title) {
    res.status(400).json({ error: 'Título requerido' })
    return
  }
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE ama_lists SET title = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?`,
  ).run(title, notes, tags, now, existing.id)

  if (existing.kind === 'lista6' && (body.tridente_a_id || body.tridente_b_id)) {
    const aId = asString(body.tridente_a_id) || existing.composition?.tridente_a_id
    const bId = asString(body.tridente_b_id) || existing.composition?.tridente_b_id
    if (aId && bId) {
      const a = hydrateList(db, aId)
      const b = hydrateList(db, bId)
      if (!a || a.kind !== 'tridente' || !b || b.kind !== 'tridente') {
        res.status(400).json({ error: 'Hace falta dos Tridentes' })
        return
      }
      db.prepare(`DELETE FROM ama_lista6_parts WHERE lista6_id = ?`).run(
        existing.id,
      )
      db.prepare(
        `INSERT INTO ama_lista6_parts (lista6_id, tridente_a_id, tridente_b_id)
         VALUES (?, ?, ?)`,
      ).run(existing.id, a.id, b.id)
      db.prepare(`UPDATE ama_lists SET source = 'composed', updated_at = ? WHERE id = ?`).run(
        now,
        existing.id,
      )
    }
  }

  res.json({ ok: true, list: hydrateList(db, existing.id) })
})

amazonaRouter.delete('/lists/:id', (req, res) => {
  const db = getDb()
  const id = String(req.params.id)
  const existing = hydrateList(db, id)
  if (!existing) {
    res.status(404).json({ error: 'Lista no encontrada' })
    return
  }
  const uses = listUses(db, id)
  if (uses.as_part > 0) {
    res.status(409).json({
      error: 'Esta lista está combinada en una Lista6',
    })
    return
  }
  if (uses.as_axis > 0) {
    res.status(409).json({
      error: 'Esta lista es eje de una matriz AmazonA',
    })
    return
  }
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM ama_links WHERE object_type = 'list' AND object_id = ?`).run(
      id,
    )
    db.prepare(
      `DELETE FROM ama_links WHERE object_type = 'item' AND object_id IN
       (SELECT id FROM ama_list_items WHERE list_id = ?)`,
    ).run(id)
    db.prepare(`DELETE FROM ama_list_items WHERE list_id = ?`).run(id)
    db.prepare(`DELETE FROM ama_lista6_parts WHERE lista6_id = ?`).run(id)
    db.prepare(`DELETE FROM ama_lists WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, id })
})

amazonaRouter.put('/lists/:id/items', (req, res) => {
  const db = getDb()
  const existing = hydrateList(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Lista no encontrada' })
    return
  }
  if (existing.composition) {
    res.status(400).json({
      error: 'Lista6 compuesta: editá los Tridentes de origen',
    })
    return
  }
  const body = req.body as {
    items?: Array<{
      id?: string
      label?: string
      notes?: string
      place_id?: string | null
    }>
  }
  const incoming = Array.isArray(body.items) ? body.items : []
  const now = new Date().toISOString()
  const current = existing.items
  db.exec('BEGIN')
  try {
    for (let i = 0; i < existing.size; i++) {
      const slot = incoming[i]
      const cur = current[i]
      const label = slot ? asString(slot.label) : ''
      const notes = slot ? asString(slot.notes) : ''
      const placeId =
        slot && slot.place_id != null && slot.place_id !== ''
          ? String(slot.place_id)
          : null
      if (cur) {
        db.prepare(
          `UPDATE ama_list_items
           SET label = ?, notes = ?, place_id = ?, position = ?, updated_at = ?
           WHERE id = ?`,
        ).run(label, notes, placeId, i, now, cur.id)
      } else {
        db.prepare(
          `INSERT INTO ama_list_items (
            id, list_id, position, label, notes, place_id, parent_item_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(randomUUID(), existing.id, i, label, notes, placeId, now, now)
      }
    }
    db.prepare(`UPDATE ama_lists SET updated_at = ? WHERE id = ?`).run(
      now,
      existing.id,
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, list: hydrateList(db, existing.id) })
})

amazonaRouter.patch('/items/:id', (req, res) => {
  const db = getDb()
  const item = row<AmaListItem>(
    db.prepare(`SELECT * FROM ama_list_items WHERE id = ?`).get(req.params.id),
  )
  if (!item) {
    res.status(404).json({ error: 'Ítem no encontrado' })
    return
  }
  const body = req.body as {
    label?: string
    notes?: string
    place_id?: string | null
    position?: number
  }
  const label = body.label != null ? asString(body.label) : item.label
  const notes = body.notes != null ? asString(body.notes) : item.notes
  const placeId =
    body.place_id === undefined
      ? item.place_id
      : body.place_id
        ? String(body.place_id)
        : null
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE ama_list_items SET label = ?, notes = ?, place_id = ?, updated_at = ? WHERE id = ?`,
  ).run(label, notes, placeId, now, item.id)
  db.prepare(`UPDATE ama_lists SET updated_at = ? WHERE id = ?`).run(
    now,
    item.list_id,
  )
  const next = row<AmaListItem>(
    db
      .prepare(
        `SELECT i.*, p.name AS place_name
         FROM ama_list_items i
         LEFT JOIN ama_places p ON p.id = i.place_id
         WHERE i.id = ?`,
      )
      .get(item.id),
  )
  res.json({ ok: true, item: next })
})

amazonaRouter.post('/items/:id/children', (req, res) => {
  const db = getDb()
  const parent = row<AmaListItem>(
    db.prepare(`SELECT * FROM ama_list_items WHERE id = ?`).get(req.params.id),
  )
  if (!parent) {
    res.status(404).json({ error: 'Ítem no encontrado' })
    return
  }
  const label = asString((req.body as { label?: string }).label)
  if (!label) {
    res.status(400).json({ error: 'label requerido' })
    return
  }
  const now = new Date().toISOString()
  const pos = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ama_list_items WHERE parent_item_id = ?`,
      )
      .get(parent.id),
  )
  const id = randomUUID()
  db.prepare(
    `INSERT INTO ama_list_items (
      id, list_id, position, label, notes, place_id, parent_item_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    parent.list_id,
    pos?.c ?? 0,
    label,
    asString((req.body as { notes?: string }).notes),
    parent.id,
    now,
    now,
  )
  res.status(201).json({
    ok: true,
    item: row(
      db.prepare(`SELECT * FROM ama_list_items WHERE id = ?`).get(id),
    ),
  })
})

amazonaRouter.delete('/items/:id', (req, res) => {
  const db = getDb()
  const item = row<AmaListItem>(
    db.prepare(`SELECT * FROM ama_list_items WHERE id = ?`).get(req.params.id),
  )
  if (!item) {
    res.status(404).json({ error: 'Ítem no encontrado' })
    return
  }
  if (!item.parent_item_id) {
    res.status(400).json({
      error: 'Los huecos de la lista no se borran; vaciá el label',
    })
    return
  }
  db.prepare(`DELETE FROM ama_links WHERE object_type = 'item' AND object_id = ?`).run(
    item.id,
  )
  db.prepare(`DELETE FROM ama_list_items WHERE id = ?`).run(item.id)
  res.json({ ok: true, id: item.id })
})

amazonaRouter.get('/matrices', (req, res) => {
  const db = getDb()
  const orderRaw = asString(req.query.order_n)
  const orderN = orderRaw ? Number(orderRaw) : null
  const all = rows<AmaMatrix>(
    db
      .prepare(
        `SELECT m.*,
                r.title AS row_title,
                c.title AS col_title,
                (SELECT COUNT(*) FROM ama_cells k
                  WHERE k.matrix_id = m.id AND trim(k.notes) != '') AS cell_notes_count
         FROM ama_matrices m
         JOIN ama_lists r ON r.id = m.row_list_id
         JOIN ama_lists c ON c.id = m.col_list_id
         ORDER BY m.updated_at DESC`,
      )
      .all(),
  )
    .map(mapMatrix)
    .map((m) => ({
      ...m,
      order_n: (m.order_n === 3 ? 3 : 6) as 3 | 6,
    }))
    .filter((m) => (orderN === 3 || orderN === 6 ? m.order_n === orderN : true))
  res.json({ ok: true, matrices: all })
})

function createMatrix(opts: {
  title: string
  notes: string
  order_n: 3 | 6
  row_list_id: string
  col_list_id: string
  tags?: unknown
}): { ok: true; matrix: ReturnType<typeof hydrateMatrix> } | { error: string; status: number } {
  const db = getDb()
  const rowList = hydrateList(db, opts.row_list_id)
  const colList = hydrateList(db, opts.col_list_id)
  if (!rowList || !colList) {
    return { error: 'Listas de eje no encontradas', status: 404 }
  }
  if (rowList.items.length < opts.order_n || colList.items.length < opts.order_n) {
    return {
      error: `Cada eje necesita ${opts.order_n} elementos`,
      status: 400,
    }
  }
  if (opts.order_n === 6 && (rowList.kind !== 'lista6' || colList.kind !== 'lista6')) {
    return { error: 'Una Lista AmazonA se arma con dos Lista6', status: 400 }
  }
  if (opts.order_n === 3 && (rowList.kind !== 'tridente' || colList.kind !== 'tridente')) {
    return { error: 'Un esquema 3×3 se arma con dos Tridentes', status: 400 }
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO ama_matrices (
      id, title, notes, order_n, row_list_id, col_list_id, tags, neo_swapped, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    opts.title,
    opts.notes,
    opts.order_n,
    rowList.id,
    colList.id,
    stringifyTags(opts.tags),
    now,
    now,
  )
  return { ok: true, matrix: hydrateMatrix(db, id) }
}

amazonaRouter.post('/matrices/example', (_req, res) => {
  const db = getDb()
  const existing = row<AmaMatrix>(
    db
      .prepare(
        `SELECT * FROM ama_matrices
         WHERE row_list_id = 'ama-lista6-nodos'
           AND col_list_id = 'ama-lista6-corruptopolis'`,
      )
      .get(),
  )
  if (existing) {
    res.json({ ok: true, matrix: hydrateMatrix(db, existing.id), reused: true })
    return
  }
  const created = createMatrix({
    title: 'Territorio × Poder',
    notes: 'Ejemplo: Nodos Territoriales × Corruptópolis.',
    order_n: 6,
    row_list_id: 'ama-lista6-nodos',
    col_list_id: 'ama-lista6-corruptopolis',
  })
  if ('error' in created) {
    res.status(created.status).json({ error: created.error })
    return
  }
  res.status(201).json(created)
})

amazonaRouter.post('/matrices', (req, res) => {
  const body = req.body as {
    title?: string
    notes?: string
    order_n?: number
    row_list_id?: string
    col_list_id?: string
    tags?: unknown
  }
  const title = asString(body.title)
  if (!title) {
    res.status(400).json({ error: 'Título requerido' })
    return
  }
  const order_n = body.order_n === 3 ? 3 : 6
  const created = createMatrix({
    title,
    notes: asString(body.notes),
    order_n,
    row_list_id: asString(body.row_list_id),
    col_list_id: asString(body.col_list_id),
    tags: body.tags,
  })
  if ('error' in created) {
    res.status(created.status).json({ error: created.error })
    return
  }
  res.status(201).json(created)
})

amazonaRouter.get('/matrices/:id', (req, res) => {
  const matrix = hydrateMatrix(getDb(), String(req.params.id))
  if (!matrix) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  res.json({
    ok: true,
    matrix,
    links: listLinks(getDb(), 'matrix', matrix.id),
  })
})

amazonaRouter.patch('/matrices/:id', (req, res) => {
  const db = getDb()
  const existing = hydrateMatrix(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  const body = req.body as { title?: string; notes?: string; tags?: unknown }
  const title = body.title != null ? asString(body.title) : existing.title
  const notes = body.notes != null ? asString(body.notes) : existing.notes
  const tags = body.tags != null ? stringifyTags(body.tags) : existing.tags
  if (!title) {
    res.status(400).json({ error: 'Título requerido' })
    return
  }
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE ama_matrices SET title = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?`,
  ).run(title, notes, tags, now, existing.id)
  res.json({ ok: true, matrix: hydrateMatrix(db, existing.id) })
})

amazonaRouter.delete('/matrices/:id', (req, res) => {
  const db = getDb()
  const id = String(req.params.id)
  const existing = row<{ id: string }>(
    db.prepare(`SELECT id FROM ama_matrices WHERE id = ?`).get(id),
  )
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM ama_links WHERE object_type = 'matrix' AND object_id = ?`).run(
      id,
    )
    db.prepare(
      `DELETE FROM ama_links WHERE object_type = 'cell' AND object_id IN
       (SELECT id FROM ama_cells WHERE matrix_id = ?)`,
    ).run(id)
    db.prepare(`DELETE FROM ama_cells WHERE matrix_id = ?`).run(id)
    db.prepare(`DELETE FROM ama_neo_cells WHERE matrix_id = ?`).run(id)
    db.prepare(`DELETE FROM ama_matrices WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, id })
})

amazonaRouter.post('/matrices/:id/swap', (req, res) => {
  const db = getDb()
  const existing = hydrateMatrix(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  const cells = rows<AmaCell>(
    db.prepare(`SELECT * FROM ama_cells WHERE matrix_id = ?`).all(existing.id),
  )
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE ama_matrices
       SET row_list_id = ?, col_list_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(existing.col_list_id, existing.row_list_id, now, existing.id)
    db.prepare(`DELETE FROM ama_cells WHERE matrix_id = ?`).run(existing.id)
    for (const cell of cells) {
      db.prepare(
        `INSERT INTO ama_cells (
          id, matrix_id, row_item_id, col_item_id, title, notes, cycle_slot, place_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        cell.id,
        cell.matrix_id,
        cell.col_item_id,
        cell.row_item_id,
        cell.title,
        cell.notes,
        cell.cycle_slot,
        cell.place_id,
        cell.created_at,
        now,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, matrix: hydrateMatrix(db, existing.id) })
})

amazonaRouter.post('/matrices/:id/neo/swap', (req, res) => {
  const db = getDb()
  const existing = hydrateMatrix(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  const next = existing.neo_swapped ? 0 : 1
  db.prepare(
    `UPDATE ama_matrices SET neo_swapped = ?, updated_at = ? WHERE id = ?`,
  ).run(next, new Date().toISOString(), existing.id)
  res.json({ ok: true, matrix: hydrateMatrix(db, existing.id) })
})

amazonaRouter.patch('/matrices/:id/cells', (req, res) => {
  const db = getDb()
  const existing = hydrateMatrix(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  const body = req.body as {
    row_item_id?: string
    col_item_id?: string
    title?: string | null
    notes?: string
    cycle_slot?: AmaCycleSlot | null
    place_id?: string | null
  }
  const rowItemId = asString(body.row_item_id)
  const colItemId = asString(body.col_item_id)
  if (!rowItemId || !colItemId) {
    res.status(400).json({ error: 'row_item_id y col_item_id requeridos' })
    return
  }
  const rowOk = existing.row_list.items.some((i) => i.id === rowItemId)
  const colOk = existing.col_list.items.some((i) => i.id === colItemId)
  if (!rowOk || !colOk) {
    res.status(400).json({ error: 'Ítems fuera de los ejes de esta matriz' })
    return
  }
  const now = new Date().toISOString()
  const current = row<AmaCell>(
    db
      .prepare(
        `SELECT * FROM ama_cells
         WHERE matrix_id = ? AND row_item_id = ? AND col_item_id = ?`,
      )
      .get(existing.id, rowItemId, colItemId),
  )
  const requestedSlot = body.cycle_slot as AmaCycleSlot | null | undefined | string
  const cycleSlot =
    requestedSlot === undefined
      ? current?.cycle_slot ?? null
      : requestedSlot === null || requestedSlot === ''
        ? null
        : isCycleSlot(requestedSlot)
          ? requestedSlot
          : current?.cycle_slot ?? null
  const placeId =
    body.place_id === undefined
      ? current?.place_id ?? null
      : body.place_id
        ? String(body.place_id)
        : null
  const notes = body.notes != null ? asString(body.notes) : current?.notes ?? ''
  const title =
    body.title === undefined
      ? current?.title ?? null
      : body.title === null || asString(body.title) === ''
        ? null
        : asString(body.title)

  const cellId = current?.id ?? randomUUID()
  if (current) {
    db.prepare(
      `UPDATE ama_cells
       SET title = ?, notes = ?, cycle_slot = ?, place_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(title, notes, cycleSlot, placeId, now, current.id)
  } else {
    db.prepare(
      `INSERT INTO ama_cells (
        id, matrix_id, row_item_id, col_item_id, title, notes, cycle_slot, place_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cellId,
      existing.id,
      rowItemId,
      colItemId,
      title,
      notes,
      cycleSlot,
      placeId,
      now,
      now,
    )
  }
  db.prepare(`UPDATE ama_matrices SET updated_at = ? WHERE id = ?`).run(
    now,
    existing.id,
  )
  const offset = getCycleOffset(db)
  const cell = decorateCell(
    row<AmaCell>(
      db
        .prepare(
          `SELECT k.*, p.name AS place_name
           FROM ama_cells k
           LEFT JOIN ama_places p ON p.id = k.place_id
           WHERE k.id = ?`,
        )
        .get(cellId),
    ) as AmaCell,
    offset,
  )
  res.json({ ok: true, cell, matrix: hydrateMatrix(db, existing.id) })
})

amazonaRouter.patch('/matrices/:id/neo', (req, res) => {
  const db = getDb()
  const existing = hydrateMatrix(db, String(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Matriz no encontrada' })
    return
  }
  const body = req.body as {
    title_index?: number
    cycle_slot?: AmaCycleSlot
    notes?: string
  }
  const titleIndex = Number(body.title_index)
  if (![0, 1, 2].includes(titleIndex) || !isCycleSlot(body.cycle_slot)) {
    res.status(400).json({ error: 'title_index (0-2) y cycle_slot requeridos' })
    return
  }
  const notes = asString(body.notes)
  const now = new Date().toISOString()
  const current = row<AmaNeoCell>(
    db
      .prepare(
        `SELECT * FROM ama_neo_cells
         WHERE matrix_id = ? AND title_index = ? AND cycle_slot = ?`,
      )
      .get(existing.id, titleIndex, body.cycle_slot),
  )
  if (current) {
    db.prepare(`UPDATE ama_neo_cells SET notes = ? WHERE id = ?`).run(
      notes,
      current.id,
    )
  } else {
    db.prepare(
      `INSERT INTO ama_neo_cells (id, matrix_id, title_index, cycle_slot, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), existing.id, titleIndex, body.cycle_slot, notes)
  }
  db.prepare(`UPDATE ama_matrices SET updated_at = ? WHERE id = ?`).run(
    now,
    existing.id,
  )
  res.json({ ok: true, matrix: hydrateMatrix(db, existing.id) })
})

amazonaRouter.get('/places', (_req, res) => {
  const db = getDb()
  const places = rows<AmaPlace>(
    db.prepare(`SELECT * FROM ama_places ORDER BY name COLLATE NOCASE ASC`).all(),
  ).map(mapPlace)
  res.json({ ok: true, places })
})

amazonaRouter.post('/places', (req, res) => {
  const db = getDb()
  const body = req.body as {
    name?: string
    notes?: string
    lat?: number
    lng?: number
    kind?: AmaPlaceKind
    tags?: unknown
  }
  const name = asString(body.name)
  if (!name) {
    res.status(400).json({ error: 'Nombre requerido' })
    return
  }
  const kind: AmaPlaceKind =
    body.kind === 'enclave' ||
    body.kind === 'ruta' ||
    body.kind === 'region' ||
    body.kind === 'lugar'
      ? body.kind
      : 'lugar'
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO ama_places (id, name, notes, lat, lng, kind, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    asString(body.notes),
    asNumber(body.lat),
    asNumber(body.lng),
    kind,
    stringifyTags(body.tags),
    now,
    now,
  )
  const place = mapPlace(
    row<AmaPlace>(db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(id)) as AmaPlace,
  )
  res.status(201).json({ ok: true, place })
})

amazonaRouter.post('/places/ping', (req, res) => {
  const db = getDb()
  const body = req.body as {
    lat?: number
    lng?: number
    name?: string
    notes?: string
    snap?: boolean
  }
  const lat = asNumber(body.lat)
  const lng = asNumber(body.lng)
  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat y lng requeridos' })
    return
  }
  const places = rows<AmaPlace>(
    db
      .prepare(
        `SELECT * FROM ama_places WHERE lat IS NOT NULL AND lng IS NOT NULL`,
      )
      .all(),
  )
  let nearest: { place: AmaPlace; meters: number } | null = null
  for (const place of places) {
    if (place.lat == null || place.lng == null) continue
    const meters = haversineMeters(lat, lng, place.lat, place.lng)
    if (!nearest || meters < nearest.meters) nearest = { place, meters }
  }
  const snap = body.snap !== false
  if (snap && nearest && nearest.meters <= 400) {
    res.json({
      ok: true,
      snapped: true,
      meters: Math.round(nearest.meters),
      place: mapPlace(nearest.place),
    })
    return
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  const hh = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const name = asString(body.name) || `Ping ${hh}`
  db.prepare(
    `INSERT INTO ama_places (id, name, notes, lat, lng, kind, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'lugar', '["ping"]', ?, ?)`,
  ).run(id, name, asString(body.notes), lat, lng, now, now)
  const place = mapPlace(
    row<AmaPlace>(db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(id)) as AmaPlace,
  )
  res.status(201).json({
    ok: true,
    snapped: false,
    meters: nearest ? Math.round(nearest.meters) : null,
    place,
  })
})

amazonaRouter.patch('/places/:id', (req, res) => {
  const db = getDb()
  const existing = row<AmaPlace>(
    db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(req.params.id),
  )
  if (!existing) {
    res.status(404).json({ error: 'Lugar no encontrado' })
    return
  }
  const body = req.body as {
    name?: string
    notes?: string
    lat?: number | null
    lng?: number | null
    kind?: AmaPlaceKind
    tags?: unknown
  }
  const name = body.name != null ? asString(body.name) : existing.name
  const notes = body.notes != null ? asString(body.notes) : existing.notes
  const lat = body.lat === undefined ? existing.lat : asNumber(body.lat)
  const lng = body.lng === undefined ? existing.lng : asNumber(body.lng)
  const kind =
    body.kind === 'enclave' ||
    body.kind === 'ruta' ||
    body.kind === 'region' ||
    body.kind === 'lugar'
      ? body.kind
      : existing.kind
  const tags = body.tags != null ? stringifyTags(body.tags) : existing.tags
  if (!name) {
    res.status(400).json({ error: 'Nombre requerido' })
    return
  }
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE ama_places
     SET name = ?, notes = ?, lat = ?, lng = ?, kind = ?, tags = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, notes, lat, lng, kind, tags, now, existing.id)
  const place = mapPlace(
    row<AmaPlace>(
      db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(existing.id),
    ) as AmaPlace,
  )
  res.json({ ok: true, place })
})

amazonaRouter.delete('/places/:id', (req, res) => {
  const db = getDb()
  const id = String(req.params.id)
  const existing = row<{ id: string }>(
    db.prepare(`SELECT id FROM ama_places WHERE id = ?`).get(id),
  )
  if (!existing) {
    res.status(404).json({ error: 'Lugar no encontrado' })
    return
  }
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM ama_flows WHERE from_place_id = ? OR to_place_id = ?`).run(
      id,
      id,
    )
    db.prepare(`UPDATE ama_list_items SET place_id = NULL WHERE place_id = ?`).run(id)
    db.prepare(`UPDATE ama_cells SET place_id = NULL WHERE place_id = ?`).run(id)
    db.prepare(`UPDATE entries SET place_id = NULL WHERE place_id = ?`).run(id)
    db.prepare(`UPDATE map_tags SET place_id = NULL WHERE place_id = ?`).run(id)
    db.prepare(`UPDATE ama_places SET parent_id = NULL WHERE parent_id = ?`).run(id)
    db.prepare(`DELETE FROM ama_links WHERE object_type = 'place' AND object_id = ?`).run(
      id,
    )
    db.prepare(
      `DELETE FROM ama_links WHERE target_kind = 'place' AND target_id = ?`,
    ).run(id)
    db.prepare(`DELETE FROM ama_places WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, id })
})

amazonaRouter.get('/flows', (_req, res) => {
  const db = getDb()
  const offset = getCycleOffset(db)
  const flows = rows<AmaFlow>(
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
  ).map((flow) => ({
    ...flow,
    display_slot: flow.cycle_slot
      ? operationalSlot(flow.cycle_slot, offset)
      : null,
  }))
  res.json({ ok: true, flows })
})

amazonaRouter.post('/flows', (req, res) => {
  const db = getDb()
  const body = req.body as {
    from_place_id?: string
    to_place_id?: string
    recorded_at?: string
    notes?: string
    cycle_slot?: AmaCycleSlot | null
  }
  const fromId = asString(body.from_place_id)
  const toId = asString(body.to_place_id)
  if (!fromId || !toId) {
    res.status(400).json({ error: 'Origen y destino requeridos' })
    return
  }
  const from = row<AmaPlace>(
    db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(fromId),
  )
  const to = row<AmaPlace>(
    db.prepare(`SELECT * FROM ama_places WHERE id = ?`).get(toId),
  )
  if (!from || !to) {
    res.status(404).json({ error: 'Lugar no encontrado' })
    return
  }
  const distance =
    from.lat != null && from.lng != null && to.lat != null && to.lng != null
      ? haversineMeters(from.lat, from.lng, to.lat, to.lng)
      : null
  const now = new Date().toISOString()
  const recorded = asString(body.recorded_at) || now
  const cycleSlot = isCycleSlot(body.cycle_slot) ? body.cycle_slot : null
  const id = randomUUID()
  db.prepare(
    `INSERT INTO ama_flows (
      id, from_place_id, to_place_id, recorded_at, notes, distance_m, cycle_slot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, fromId, toId, recorded, asString(body.notes), distance, cycleSlot, now)
  const offset = getCycleOffset(db)
  const flow = row<AmaFlow>(
    db
      .prepare(
        `SELECT f.*,
                a.name AS from_name, a.lat AS from_lat, a.lng AS from_lng,
                b.name AS to_name, b.lat AS to_lat, b.lng AS to_lng
         FROM ama_flows f
         JOIN ama_places a ON a.id = f.from_place_id
         JOIN ama_places b ON b.id = f.to_place_id
         WHERE f.id = ?`,
      )
      .get(id),
  ) as AmaFlow
  res.status(201).json({
    ok: true,
    flow: {
      ...flow,
      display_slot: flow.cycle_slot
        ? operationalSlot(flow.cycle_slot, offset)
        : null,
    },
  })
})

amazonaRouter.delete('/flows/:id', (req, res) => {
  const db = getDb()
  const id = String(req.params.id)
  const existing = row<{ id: string }>(
    db.prepare(`SELECT id FROM ama_flows WHERE id = ?`).get(id),
  )
  if (!existing) {
    res.status(404).json({ error: 'Flujo no encontrado' })
    return
  }
  db.prepare(`DELETE FROM ama_links WHERE object_type = 'flow' AND object_id = ?`).run(
    id,
  )
  db.prepare(`DELETE FROM ama_flows WHERE id = ?`).run(id)
  res.json({ ok: true, id })
})

amazonaRouter.get('/links', (req, res) => {
  const objectType = asString(req.query.object_type) as AmaLinkObjectType
  const objectId = asString(req.query.object_id)
  if (!LINK_OBJECT_TYPES.includes(objectType) || !objectId) {
    res.status(400).json({ error: 'object_type y object_id requeridos' })
    return
  }
  res.json({ ok: true, links: listLinks(getDb(), objectType, objectId) })
})

amazonaRouter.post('/links', (req, res) => {
  const db = getDb()
  const body = req.body as {
    object_type?: AmaLinkObjectType
    object_id?: string
    target_kind?: AmaLinkTargetKind
    target_id?: string
    role?: string
  }
  const objectType = body.object_type
  const targetKind = body.target_kind
  const objectId = asString(body.object_id)
  const targetId = asString(body.target_id)
  if (
    !objectType ||
    !LINK_OBJECT_TYPES.includes(objectType) ||
    !targetKind ||
    !LINK_TARGET_KINDS.includes(targetKind) ||
    !objectId ||
    !targetId
  ) {
    res.status(400).json({ error: 'Vínculo incompleto' })
    return
  }
  if (!targetExists(db, targetKind, targetId)) {
    res.status(404).json({ error: 'Destino no encontrado' })
    return
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    db.prepare(
      `INSERT INTO ama_links (
        id, object_type, object_id, target_kind, target_id, role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      objectType,
      objectId,
      targetKind,
      targetId,
      asString(body.role) || 'tag',
      now,
    )
  } catch {
    res.status(409).json({ error: 'Ese vínculo ya existe' })
    return
  }
  res.status(201).json({
    ok: true,
    links: listLinks(db, objectType, objectId),
  })
})

amazonaRouter.delete('/links/:id', (req, res) => {
  const db = getDb()
  const existing = row<{
    id: string
    object_type: AmaLinkObjectType
    object_id: string
  }>(db.prepare(`SELECT * FROM ama_links WHERE id = ?`).get(req.params.id))
  if (!existing) {
    res.status(404).json({ error: 'Vínculo no encontrado' })
    return
  }
  db.prepare(`DELETE FROM ama_links WHERE id = ?`).run(existing.id)
  res.json({
    ok: true,
    id: existing.id,
    links: listLinks(db, existing.object_type, existing.object_id),
  })
})
