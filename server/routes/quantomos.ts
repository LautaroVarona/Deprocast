import { Router } from 'express'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import {
  chestSnapshot,
  getLatticeView,
  listQuantomosByStage,
  promoteToPre,
  resonateQuantomo,
  sealQuantomo,
  type QuantomoStageRow,
} from '../services/quantomoStages.js'
import type { QuantomoStage } from '../services/lattice72.js'

export const quantomosRouter = Router()

export type QuantomoView = QuantomoStageRow & {
  entry_title: string
  entry_status: string
  timestamp_exact: string | null
  original_filename: string | null
  entry_created_at: string
}

function universeStats(quantomos: QuantomoStageRow[]) {
  const byUniverse = new Map<string, number>()
  let weightSum = 0
  let weightN = 0
  for (const q of quantomos) {
    const u = (q.universe || 'sin universo').trim() || 'sin universo'
    byUniverse.set(u, (byUniverse.get(u) ?? 0) + 1)
    if (typeof q.hermetic_weight === 'number') {
      weightSum += q.hermetic_weight
      weightN += 1
    }
  }
  const universes = [...byUniverse.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    count: quantomos.length,
    avg_weight:
      weightN > 0 ? Math.round((weightSum / weightN) * 100) / 100 : null,
    universes,
  }
}

quantomosRouter.get('/', (req, res) => {
  const stageRaw = String(req.query.stage ?? 'sealed')
  const stage = (
    ['proto', 'pre', 'sealed', 'premium', 'all'].includes(stageRaw)
      ? stageRaw
      : 'sealed'
  ) as QuantomoStage | 'premium' | 'all'
  const quantomos = listQuantomosByStage(stage)
  res.json({
    stage,
    ...universeStats(quantomos),
    quantomos,
  })
})

quantomosRouter.get('/chest', (_req, res) => {
  try {
    res.json({ ok: true, ...chestSnapshot() })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

quantomosRouter.get('/:id/lattice', (req, res) => {
  try {
    res.json({ ok: true, ...getLatticeView(String(req.params.id)) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg.includes('no encontrado') ? 404 : 500).json({ error: msg })
  }
})

quantomosRouter.get('/:id/resonate', (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 8)
    res.json({
      ok: true,
      neighbors: resonateQuantomo(String(req.params.id), limit),
    })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

quantomosRouter.post('/:id/promote-pre', (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      universe?: string | null
      profile?: Record<string, unknown>
      calendar?: Record<string, unknown>
    }
    const quantomo = promoteToPre(String(req.params.id), body)
    res.json({ ok: true, quantomo })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

quantomosRouter.post('/:id/seal', (req, res) => {
  try {
    const quantomo = sealQuantomo(String(req.params.id))
    res.json({ ok: true, quantomo })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

quantomosRouter.get('/:id', (req, res) => {
  const db = getDb()
  const all = listQuantomosByStage('all')
  const quantomo = all.find((q) => q.id === req.params.id)
  if (!quantomo) {
    res.status(404).json({ error: 'Quántomo no encontrado' })
    return
  }

  const siblings = rows<
    Pick<QuantomoStageRow, 'id' | 'title' | 'hermetic_weight' | 'universe' | 'stage'>
  >(
    db
      .prepare(
        `SELECT id, title, hermetic_weight, universe, coalesce(stage, 'proto') AS stage
         FROM quantomos
         WHERE entry_id = ? AND id != ?
         ORDER BY hermetic_weight DESC`,
      )
      .all(quantomo.entry_id, quantomo.id),
  )

  let lattice = null
  try {
    lattice = getLatticeView(quantomo.id)
  } catch {
    lattice = null
  }

  res.json({ quantomo, siblings, lattice })
})
