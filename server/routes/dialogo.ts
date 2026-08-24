import { Router } from 'express'
import {
  createDialogoThread,
  getDialogoThread,
  listDashboardPins,
  listDialogoThreads,
  postDialogoMessage,
  setDashboardPins,
  updateDialogoThread,
  type DialogoEntityRef,
} from '../services/dialogo.js'
import { closeDialogoThread } from '../services/quantomoStages.js'

export const dialogoRouter = Router()

function parseEntityRefs(raw: unknown): DialogoEntityRef[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []
  const out: DialogoEntityRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const type = String((item as { type?: unknown }).type ?? '')
    const id = String((item as { id?: unknown }).id ?? '').trim()
    if (
      !['person', 'project', 'agrupacion', 'quantomo', 'dominio'].includes(type) ||
      !id
    ) {
      continue
    }
    out.push({ type: type as DialogoEntityRef['type'], id })
  }
  return out
}

dialogoRouter.get('/threads', (_req, res) => {
  try {
    res.json({ ok: true, threads: listDialogoThreads() })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

dialogoRouter.post('/threads', (req, res) => {
  try {
    const thread = createDialogoThread({
      title: req.body?.title,
      section_key: req.body?.section_key,
      entity_refs: parseEntityRefs(req.body?.entity_refs),
    })
    res.json({ ok: true, thread })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

dialogoRouter.get('/threads/:id', (req, res) => {
  try {
    const detail = getDialogoThread(String(req.params.id))
    if (!detail) {
      res.status(404).json({ error: 'Hilo no encontrado' })
      return
    }
    res.json({ ok: true, ...detail })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

dialogoRouter.patch('/threads/:id', (req, res) => {
  try {
    const thread = updateDialogoThread(String(req.params.id), {
      title: req.body?.title,
      section_key: req.body?.section_key,
      entity_refs: parseEntityRefs(req.body?.entity_refs),
    })
    if (!thread) {
      res.status(404).json({ error: 'Hilo no encontrado' })
      return
    }
    res.json({ ok: true, thread })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

dialogoRouter.post('/threads/:id/close', async (req, res) => {
  try {
    const weight = Number(req.body?.hermetic_weight ?? req.body?.weight)
    const title =
      typeof req.body?.title === 'string' ? req.body.title : undefined
    const result = await closeDialogoThread(String(req.params.id), weight, {
      title,
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('no encontrado')
      ? 404
      : msg.includes('cerrado') || msg.includes('vacío') || msg.includes('peso')
        ? 400
        : 500
    res.status(status).json({ error: msg })
  }
})

dialogoRouter.post('/threads/:id/messages', async (req, res) => {
  try {
    const content = String(req.body?.content ?? '')
    const result = await postDialogoMessage(String(req.params.id), content)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('no encontrado')
      ? 404
      : msg.includes('vacío')
        ? 400
        : 500
    res.status(status).json({ error: msg })
  }
})

dialogoRouter.get('/pins', (_req, res) => {
  try {
    res.json({ ok: true, pins: listDashboardPins() })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

dialogoRouter.put('/pins', (req, res) => {
  try {
    const raw = Array.isArray(req.body?.pins) ? req.body.pins : req.body
    const pins = Array.isArray(raw) ? raw : []
    const saved = setDashboardPins(pins)
    res.json({ ok: true, pins: saved })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
