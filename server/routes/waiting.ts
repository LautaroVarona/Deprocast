import { Router } from 'express'
import { getDb } from '../db.js'
import {
  discardWaitingBulk,
  discardWaitingToRuido,
  listGeneralWaiting,
  resolveWaiting,
  type ResolveWaitingInput,
  type WaitingDestType,
  type WaitingEntityType,
} from '../services/waitingRoom.js'
import { listMasterProfiles } from '../services/personMatchmaker.js'
import { listMasterProjects } from '../services/projectMatchmaker.js'
import { listGeografiaMasters } from '../services/geografia.js'
import { listDominios } from '../services/dominios.js'
import { rows } from '../sql.js'

export const waitingRouter = Router()

const FROM_TYPES: WaitingEntityType[] = ['person', 'project', 'geografia']
const DEST_TYPES: WaitingDestType[] = [
  'person',
  'project',
  'geografia',
  'agrupacion',
  'dominio',
]

waitingRouter.get('/', (_req, res) => {
  const db = getDb()
  const items = listGeneralWaiting(db)
  const withLink = items.filter((i) => i.suggested_match || i.cross_match)
  const agrupaciones = rows<{ id: string; name: string; notes: string | null }>(
    db
      .prepare(
        `SELECT id, name, notes FROM agrupaciones
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(),
  )
  res.json({
    items,
    count: items.length,
    with_link_count: withLink.length,
    orphan_count: items.length - withLink.length,
    masters: {
      persons: listMasterProfiles(db).map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
      })),
      projects: listMasterProjects(db).map((p) => ({
        id: p.id,
        name: p.title,
        category: p.category,
      })),
      geografia: listGeografiaMasters().map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
      })),
      agrupaciones: agrupaciones.map((a) => ({
        id: a.id,
        name: a.name,
        kind: 'agrupacion',
      })),
      dominios: listDominios().map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.is_fixed ? 'fijo' : 'dominio',
      })),
    },
  })
})

waitingRouter.post('/discard', (req, res) => {
  const body = req.body as {
    items?: Array<{ id?: string; from_type?: string }>
    /** Si true, descarta todo lo que está en sala (opcionalmente filtrado). */
    all?: boolean
    only?: 'suggested' | 'orphan' | 'all'
  }

  const db = getDb()
  try {
    let items: Array<{ id: string; from_type: WaitingEntityType }> = []

    if (body.all) {
      const waiting = listGeneralWaiting(db)
      const only = body.only ?? 'all'
      const filtered =
        only === 'suggested'
          ? waiting.filter((i) => i.suggested_match || i.cross_match)
          : only === 'orphan'
            ? waiting.filter((i) => !i.suggested_match && !i.cross_match)
            : waiting
      items = filtered.map((i) => ({
        id: i.id,
        from_type: i.entity_type,
      }))
    } else if (Array.isArray(body.items)) {
      for (const raw of body.items) {
        const id = String(raw.id ?? '').trim()
        const from = raw.from_type as WaitingEntityType
        if (!id || !FROM_TYPES.includes(from)) continue
        items.push({ id, from_type: from })
      }
    }

    if (items.length === 0) {
      res.status(400).json({ error: 'Sin ítems para descartar' })
      return
    }

    const result = discardWaitingBulk(db, items)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al descartar'
    res.status(400).json({ error: msg })
  }
})

waitingRouter.post('/:id/discard', (req, res) => {
  const from = (req.body as { from_type?: string })?.from_type as
    | WaitingEntityType
    | undefined
  if (!from || !FROM_TYPES.includes(from)) {
    res.status(400).json({ error: 'from_type inválido' })
    return
  }
  const db = getDb()
  try {
    const result = discardWaitingToRuido(db, req.params.id, from)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al descartar'
    res.status(400).json({ error: msg })
  }
})

waitingRouter.post('/:id/resolve', (req, res) => {
  const body = req.body as ResolveWaitingInput
  const from = body.from_type as WaitingEntityType
  const action = body.action
  const targets = Array.isArray(body.targets) ? body.targets : []
  const to = (body.to_type ?? targets[0]?.to_type) as WaitingDestType | undefined

  if (!FROM_TYPES.includes(from)) {
    res.status(400).json({ error: 'from_type inválido' })
    return
  }
  if (action !== 'attach' && action !== 'promote') {
    res.status(400).json({ error: 'action inválida' })
    return
  }
  if (action === 'attach') {
    const dests =
      targets.length > 0
        ? targets
        : body.to_type && body.target_id
          ? [{ to_type: body.to_type, target_id: body.target_id }]
          : []
    if (dests.length === 0) {
      res.status(400).json({ error: 'Sin destinos para vincular' })
      return
    }
    for (const d of dests) {
      if (!DEST_TYPES.includes(d.to_type as WaitingDestType)) {
        res.status(400).json({ error: 'to_type inválido' })
        return
      }
    }
  } else {
    if (!to || !DEST_TYPES.includes(to)) {
      res.status(400).json({ error: 'to_type inválido' })
      return
    }
    if (to === 'agrupacion' || to === 'dominio') {
      res.status(400).json({
        error:
          'Promover a agrupación/dominio no está soportado; vinculá a uno existente',
      })
      return
    }
  }

  const db = getDb()
  try {
    const result = resolveWaiting(db, req.params.id, body)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al resolver'
    res.status(400).json({ error: msg })
  }
})
