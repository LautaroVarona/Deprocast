import { Router } from 'express'
import {
  createIda,
  createIdaCard,
  deleteIda,
  deleteIdaCard,
  exportIdaMarkdown,
  getIda,
  getIdaMatrix,
  hydrateNeighbors,
  listDueIdaCards,
  listIda,
  listIdaCards,
  listPowerNotes,
  reviewIdaCard,
  shouldEmbedIda,
  updateIda,
  updateIdaCard,
  upsertPowerNote,
} from '../services/deprocast.js'
import { proposeIdaCards } from '../services/cohere.js'
import {
  embedIdaItem,
  enqueueEmbed,
  searchSimilar,
  similarToStored,
} from '../services/embeddings.js'
import {
  assimilateFinding,
  assimilatePending,
  buildResearchPrompt,
  deleteResearchPack,
  discardFinding,
  discardPending,
  fractalizeFinding,
  getResearchPackDetail,
  ingestResearchJson,
  listResearchPacks,
  startResearchRun,
} from '../services/research.js'
import type { DeproPowerStatus } from '../types.js'
import { AppError } from '../errors.js'

export const deprocastRouter = Router()

function maybeEmbed(item: ReturnType<typeof createIda>): void {
  if (shouldEmbedIda(item)) {
    enqueueEmbed(() => embedIdaItem(item.id))
  }
}

deprocastRouter.get('/catalog', (_req, res) => {
  try {
    res.json({
      ok: true,
      power_notes: listPowerNotes(),
      ida: listIda(false),
      ida_matrix: getIdaMatrix(),
    })
  } catch (err) {
    console.error('[deprocast/catalog]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo leer el catálogo',
    })
  }
})

deprocastRouter.patch('/powers/:index', (req, res) => {
  try {
    const index = Number(req.params.index)
    const statusRaw = req.body?.status
    let status: DeproPowerStatus | null | undefined
    if (statusRaw === null) status = null
    else if (statusRaw === undefined) status = undefined
    else status = statusRaw as DeproPowerStatus
    const note = upsertPowerNote(index, {
      notes: req.body?.notes,
      status,
    })
    res.json({ ok: true, note })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo guardar'
    const bad = message.includes('inválido')
    console.error('[deprocast/powers]', err)
    res.status(bad ? 400 : 500).json({ error: message })
  }
})

deprocastRouter.get('/research/packs', (req, res) => {
  try {
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined
    res.json({ ok: true, packs: listResearchPacks({ status }) })
  } catch (err) {
    console.error('[deprocast/research/packs]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudieron listar packs',
    })
  }
})

deprocastRouter.get('/research/packs/:id', (req, res) => {
  try {
    const detail = getResearchPackDetail(String(req.params.id))
    if (!detail) {
      res.status(404).json({ error: 'Pack no encontrado' })
      return
    }
    res.json({ ok: true, ...detail })
  } catch (err) {
    console.error('[deprocast/research/pack]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo leer el pack',
    })
  }
})

deprocastRouter.post('/research/prompt', (req, res) => {
  try {
    const result = buildResearchPrompt(req.body?.topic)
    res.json({ ok: true, ...result })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'No se pudo generar el prompt'
    console.error('[deprocast/research/prompt]', err)
    res.status(400).json({ error: message })
  }
})

deprocastRouter.post('/research/ingest', (req, res) => {
  try {
    const detail = ingestResearchJson(req.body ?? {})
    res.status(201).json({ ok: true, ...detail })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'No se pudo ingerir el payload'
    console.error('[deprocast/research/ingest]', err)
    res.status(400).json({ error: message })
  }
})

deprocastRouter.post('/research/run', (req, res) => {
  try {
    const pack = startResearchRun(req.body ?? {})
    res.status(201).json({ ok: true, pack })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo investigar'
    const status = err instanceof AppError ? err.status : 400
    console.error('[deprocast/research/run]', err)
    res.status(status).json({ error: message })
  }
})

deprocastRouter.post('/research/findings/:id/assimilate', (req, res) => {
  try {
    const result = assimilateFinding(String(req.params.id), req.body ?? {})
    res.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo asimilar'
    const missing = message.includes('no encontrado')
    console.error('[deprocast/research/assimilate]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.post('/research/findings/:id/discard', (req, res) => {
  try {
    const finding = discardFinding(String(req.params.id))
    res.json({ ok: true, finding })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo descartar'
    const missing = message.includes('no encontrado')
    console.error('[deprocast/research/discard]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.post('/research/findings/:id/fractalize', (req, res) => {
  try {
    const result = fractalizeFinding(String(req.params.id))
    res.status(201).json({ ok: true, ...result })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'No se pudo fractalizar'
    const missing = message.includes('no encontrado')
    console.error('[deprocast/research/fractalize]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.post('/research/packs/:id/assimilate-pending', (req, res) => {
  try {
    const result = assimilatePending(String(req.params.id), req.body ?? {})
    res.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo asimilar'
    const missing = message.includes('no encontrado')
    console.error('[deprocast/research/assimilate-pending]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.post('/research/packs/:id/discard-pending', (req, res) => {
  try {
    const result = discardPending(String(req.params.id))
    res.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo purgar'
    const missing = message.includes('no encontrado')
    console.error('[deprocast/research/discard-pending]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.delete('/research/packs/:id', (req, res) => {
  try {
    const id = String(req.params.id)
    const ok = deleteResearchPack(id)
    if (!ok) {
      res.status(404).json({ error: 'Pack no encontrado' })
      return
    }
    res.json({ ok: true, id })
  } catch (err) {
    console.error('[deprocast/research/delete]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo borrar',
    })
  }
})

deprocastRouter.get('/ida', (req, res) => {
  try {
    const archived = String(req.query.archived ?? '') === '1'
    res.json({ ok: true, items: listIda(archived) })
  } catch (err) {
    console.error('[deprocast/ida/list]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo listar IDA',
    })
  }
})

deprocastRouter.get('/ida/due', (_req, res) => {
  try {
    res.json({ ok: true, cards: listDueIdaCards() })
  } catch (err) {
    console.error('[deprocast/ida/due]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo leer la cola',
    })
  }
})

deprocastRouter.get('/ida/export', (_req, res) => {
  try {
    res.json({ ok: true, markdown: exportIdaMarkdown() })
  } catch (err) {
    console.error('[deprocast/ida/export]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo exportar',
    })
  }
})

deprocastRouter.post('/ida', (req, res) => {
  try {
    const item = createIda(req.body ?? {})
    maybeEmbed(item)
    res.status(201).json({ ok: true, item })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo crear'
    console.error('[deprocast/ida/create]', err)
    res.status(400).json({ error: message })
  }
})

deprocastRouter.patch('/ida/cards/:cardId', (req, res) => {
  try {
    const card = updateIdaCard(String(req.params.cardId), req.body ?? {})
    res.json({ ok: true, card })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo actualizar'
    const missing = message.includes('no encontrada')
    console.error('[deprocast/ida/cards/update]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.post('/ida/cards/:cardId/review', (req, res) => {
  try {
    const card = reviewIdaCard(String(req.params.cardId), req.body?.grade)
    res.json({ ok: true, card })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo registrar'
    const missing = message.includes('no encontrada')
    console.error('[deprocast/ida/cards/review]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.delete('/ida/cards/:cardId', (req, res) => {
  try {
    const ok = deleteIdaCard(String(req.params.cardId))
    if (!ok) {
      res.status(404).json({ error: 'Card no encontrada' })
      return
    }
    res.json({ ok: true, id: req.params.cardId })
  } catch (err) {
    console.error('[deprocast/ida/cards/delete]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo borrar',
    })
  }
})

deprocastRouter.get('/ida/:id/neighbors', async (req, res) => {
  try {
    const id = String(req.params.id)
    const item = getIda(id)
    if (!item) {
      res.status(404).json({ error: 'Ficha IDA no encontrada' })
      return
    }
    let hits = similarToStored('ida_item', id, {
      types: ['ida_item', 'quantomo'],
      limit: 12,
    })
    if (hits.length === 0) {
      const q = `${item.title}\n${item.body}`.trim()
      if (q) {
        const searched = await searchSimilar(q, {
          types: ['ida_item', 'quantomo'],
          limit: 12,
        })
        hits = searched.filter(
          (h) => !(h.object_type === 'ida_item' && h.object_id === id),
        )
      }
    }
    res.json({ ok: true, neighbors: hydrateNeighbors(hits) })
  } catch (err) {
    console.error('[deprocast/ida/neighbors]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudieron buscar vecinos',
    })
  }
})

deprocastRouter.post('/ida/:id/propose-cards', async (req, res) => {
  try {
    const item = getIda(String(req.params.id))
    if (!item) {
      res.status(404).json({ error: 'Ficha IDA no encontrada' })
      return
    }
    const cards = await proposeIdaCards(item.title, item.body)
    res.json({ ok: true, cards })
  } catch (err) {
    console.error('[deprocast/ida/propose-cards]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudieron proponer cards',
    })
  }
})

deprocastRouter.get('/ida/:id/cards', (req, res) => {
  try {
    const item = getIda(String(req.params.id))
    if (!item) {
      res.status(404).json({ error: 'Ficha IDA no encontrada' })
      return
    }
    res.json({ ok: true, cards: listIdaCards(item.id) })
  } catch (err) {
    console.error('[deprocast/ida/cards]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudieron listar cards',
    })
  }
})

deprocastRouter.post('/ida/:id/cards', (req, res) => {
  try {
    const card = createIdaCard(String(req.params.id), req.body ?? {})
    res.status(201).json({ ok: true, card })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo crear'
    const missing = message.includes('no encontrada')
    console.error('[deprocast/ida/cards/create]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.patch('/ida/:id', (req, res) => {
  try {
    const item = updateIda(String(req.params.id), req.body ?? {})
    maybeEmbed(item)
    res.json({ ok: true, item })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo actualizar'
    const missing = message.includes('no encontrada')
    console.error('[deprocast/ida/update]', err)
    res.status(missing ? 404 : 400).json({ error: message })
  }
})

deprocastRouter.delete('/ida/:id', (req, res) => {
  try {
    const ok = deleteIda(String(req.params.id))
    if (!ok) {
      res.status(404).json({ error: 'Ficha IDA no encontrada' })
      return
    }
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    console.error('[deprocast/ida/delete]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo borrar',
    })
  }
})
