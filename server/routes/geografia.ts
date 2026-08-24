import { Router } from 'express'
import {
  createGeografia,
  deleteGeografia,
  getGeografia,
  getGeografiaMap,
  listAllGeografia,
  listGeografiaMasters,
  listGeografiaTree,
  listGeografiaWaiting,
  promoteGeografia,
  updateGeografia,
} from '../services/geografia.js'

export const geografiaRouter = Router()

geografiaRouter.get('/', (_req, res) => {
  const masters = listGeografiaMasters()
  const waiting = listGeografiaWaiting()
  res.json({
    places: masters,
    masters,
    waiting,
    waiting_count: waiting.length,
    all: listAllGeografia(),
  })
})

geografiaRouter.get('/tree', (_req, res) => {
  res.json({ tree: listGeografiaTree() })
})

geografiaRouter.get('/:id/map', (req, res) => {
  const payload = getGeografiaMap(String(req.params.id ?? ''))
  if (!payload) {
    res.status(404).json({ error: 'Lugar no encontrado' })
    return
  }
  res.json(payload)
})

geografiaRouter.get('/:id', (req, res) => {
  const place = getGeografia(String(req.params.id ?? ''))
  if (!place) {
    res.status(404).json({ error: 'Lugar no encontrado' })
    return
  }
  res.json({ place })
})

geografiaRouter.post('/', (req, res) => {
  try {
    const place = createGeografia({ ...(req.body ?? {}), source: 'manual' })
    res.status(201).json({ ok: true, place })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al crear'
    const status =
      msg.includes('requerido') || msg.includes('existe') ? 400 : 500
    res.status(status).json({ error: msg })
  }
})

geografiaRouter.patch('/:id', (req, res) => {
  try {
    const place = updateGeografia(String(req.params.id ?? ''), req.body ?? {})
    res.json({ ok: true, place })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar'
    const status =
      msg.includes('no encontrado')
        ? 404
        : msg.includes('vacío')
          ? 400
          : 500
    res.status(status).json({ error: msg })
  }
})

geografiaRouter.post('/:id/promote', (req, res) => {
  try {
    const place = promoteGeografia(String(req.params.id ?? ''))
    res.json({ ok: true, place })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al promover'
    const status = msg.includes('no encontrado') ? 404 : 400
    res.status(status).json({ error: msg })
  }
})

geografiaRouter.delete('/:id', (req, res) => {
  try {
    const result = deleteGeografia(String(req.params.id ?? ''))
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al borrar'
    const status = msg.includes('no encontrado')
      ? 404
      : msg.includes('oficial')
        ? 409
        : 500
    res.status(status).json({ error: msg })
  }
})
