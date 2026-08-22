import { Router } from 'express'
import {
  createDominio,
  deleteDominio,
  getDominio,
  listDominios,
  updateDominio,
} from '../services/dominios.js'

export const dominiosRouter = Router()

dominiosRouter.get('/', (_req, res) => {
  res.json({ dominios: listDominios() })
})

dominiosRouter.get('/:id', (req, res) => {
  const d = getDominio(String(req.params.id ?? ''))
  if (!d) {
    res.status(404).json({ error: 'Dominio no encontrado' })
    return
  }
  res.json({ dominio: d })
})

dominiosRouter.post('/', (req, res) => {
  try {
    const dominio = createDominio(req.body ?? {})
    res.status(201).json({ ok: true, dominio })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al crear'
    const status = msg.includes('requerido') || msg.includes('existe') ? 400 : 500
    res.status(status).json({ error: msg })
  }
})

dominiosRouter.patch('/:id', (req, res) => {
  try {
    const dominio = updateDominio(String(req.params.id ?? ''), req.body ?? {})
    res.json({ ok: true, dominio })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar'
    const status =
      msg.includes('no encontrado')
        ? 404
        : msg.includes('fijos') ||
            msg.includes('vacío') ||
            msg.includes('existe')
          ? 400
          : 500
    res.status(status).json({ error: msg })
  }
})

dominiosRouter.delete('/:id', (req, res) => {
  try {
    const result = deleteDominio(String(req.params.id ?? ''))
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al borrar'
    const status =
      msg.includes('no encontrado')
        ? 404
        : msg.includes('fijos')
          ? 400
          : 500
    res.status(status).json({ error: msg })
  }
})
