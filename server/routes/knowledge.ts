import { Router } from 'express'
import { AppError } from '../errors.js'
import {
  addKnowledgeAnchor,
  captureFromHarvest,
  captureFromUrl,
  createManualKnowledge,
  deleteKnowledge,
  deleteKnowledgeAnchor,
  distillKnowledge,
  findGithubHarvestLinks,
  getKnowledge,
  kickKnowledgeJobs,
  listKnowledge,
  neighborsForKnowledge,
  patchKnowledge,
  refreshKnowledge,
  regenerateUtility,
} from '../services/knowledge.js'
import type { KnowledgeKind } from '../types.js'

export const knowledgeRouter = Router()

function sendErr(res: import('express').Response, err: unknown, log: string) {
  const status = err instanceof AppError ? err.status : 500
  const message = err instanceof Error ? err.message : String(err)
  if (status >= 500) console.error(log, err)
  res.status(status).json({
    error: message,
    code: err instanceof AppError ? err.code : undefined,
  })
}

knowledgeRouter.get('/', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined
    const pulse =
      typeof req.query.pulse === 'string' ? req.query.pulse : undefined
    const limit =
      req.query.limit != null ? Number(req.query.limit) : undefined
    const items = listKnowledge({ q, kind, pulse, limit })
    res.json({ ok: true, items })
  } catch (err) {
    sendErr(res, err, '[knowledge/list]')
  }
})

knowledgeRouter.get('/harvest', (_req, res) => {
  try {
    res.json({ ok: true, links: findGithubHarvestLinks() })
  } catch (err) {
    sendErr(res, err, '[knowledge/harvest]')
  }
})

knowledgeRouter.get('/:id/neighbors', async (req, res) => {
  try {
    const neighbors = await neighborsForKnowledge(String(req.params.id))
    res.json({ ok: true, neighbors })
  } catch (err) {
    sendErr(res, err, '[knowledge/neighbors]')
  }
})

knowledgeRouter.get('/:id', (req, res) => {
  try {
    const item = getKnowledge(String(req.params.id))
    if (!item) {
      res.status(404).json({ error: 'Referente no encontrado' })
      return
    }
    res.json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/get]')
  }
})

knowledgeRouter.post('/', (req, res) => {
  try {
    const body = req.body as {
      url?: string
      kind?: KnowledgeKind
      title?: string
      authors_org?: string
      source_url?: string
      summary?: string
      utility_problem?: string
      architecture_tldr?: string
      use_cases?: string
      notes?: string
      domain_ids?: string[]
      tags?: string[]
      repo?: {
        owner?: string
        repo_name?: string
        stack_tags?: string[]
        last_commit_at?: string | null
        open_issues?: number | null
        stars?: number | null
        archived?: boolean
        license?: string | null
        description_upstream?: string
        default_branch?: string | null
      }
    }
    if (typeof body.url === 'string' && body.url.trim()) {
      const item = captureFromUrl(body.url)
      res.status(202).json({ ok: true, item })
      return
    }
    if (!body.title?.trim()) {
      res.status(400).json({ error: 'Pegá una URL de GitHub o un título' })
      return
    }
    const item = createManualKnowledge({
      kind: body.kind,
      title: body.title,
      authors_org: body.authors_org,
      source_url: body.source_url,
      summary: body.summary,
      utility_problem: body.utility_problem,
      architecture_tldr: body.architecture_tldr,
      use_cases: body.use_cases,
      notes: body.notes,
      domain_ids: body.domain_ids,
      tags: body.tags,
      repo: body.repo,
    })
    res.json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/create]')
  }
})

knowledgeRouter.post('/from-harvest', (req, res) => {
  try {
    const linkId = String((req.body as { link_id?: string }).link_id ?? '')
    if (!linkId) {
      res.status(400).json({ error: 'Falta link_id' })
      return
    }
    const item = captureFromHarvest(linkId)
    res.status(202).json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/from-harvest]')
  }
})

knowledgeRouter.patch('/:id', (req, res) => {
  try {
    const item = patchKnowledge(String(req.params.id), req.body ?? {})
    res.json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/patch]')
  }
})

knowledgeRouter.delete('/:id', (req, res) => {
  try {
    const ok = deleteKnowledge(String(req.params.id))
    if (!ok) {
      res.status(404).json({ error: 'Referente no encontrado' })
      return
    }
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    sendErr(res, err, '[knowledge/delete]')
  }
})

knowledgeRouter.post('/:id/refresh', (req, res) => {
  try {
    const item = refreshKnowledge(String(req.params.id))
    res.status(202).json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/refresh]')
  }
})

knowledgeRouter.post('/:id/utility', async (req, res) => {
  try {
    const item = await regenerateUtility(String(req.params.id))
    res.json({ ok: true, item })
  } catch (err) {
    sendErr(res, err, '[knowledge/utility]')
  }
})

knowledgeRouter.post('/:id/distill', (req, res) => {
  try {
    const weight = (req.body as { weight?: number }).weight
    const result = distillKnowledge(String(req.params.id), weight)
    res.json({ ok: true, ...result })
  } catch (err) {
    sendErr(res, err, '[knowledge/distill]')
  }
})

knowledgeRouter.post('/:id/anchors', (req, res) => {
  try {
    const body = req.body as {
      matrix_id?: string
      row_item_id?: string
      col_item_id?: string
      role?: 'conocimiento' | 'interseccion'
    }
    if (!body.matrix_id || !body.row_item_id || !body.col_item_id) {
      res.status(400).json({ error: 'Falta matriz / fila / columna' })
      return
    }
    const anchor = addKnowledgeAnchor({
      entity_id: String(req.params.id),
      matrix_id: body.matrix_id,
      row_item_id: body.row_item_id,
      col_item_id: body.col_item_id,
      role: body.role,
    })
    res.json({ ok: true, anchor })
  } catch (err) {
    sendErr(res, err, '[knowledge/anchors]')
  }
})

knowledgeRouter.delete('/:id/anchors/:anchorId', (req, res) => {
  try {
    const ok = deleteKnowledgeAnchor(String(req.params.anchorId))
    if (!ok) {
      res.status(404).json({ error: 'Ancla no encontrada' })
      return
    }
    res.json({ ok: true, id: req.params.anchorId })
  } catch (err) {
    sendErr(res, err, '[knowledge/anchors/delete]')
  }
})

knowledgeRouter.post('/kick', (_req, res) => {
  kickKnowledgeJobs()
  res.json({ ok: true })
})
