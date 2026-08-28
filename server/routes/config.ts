import { Router } from 'express'
import {
  getProviderConfig,
  updateProviderConfig,
  type ProviderSlot,
} from '../services/appSettings.js'
import { getLocalApiToken } from '../services/localAuth.js'
import {
  cancelJob,
  listDeadJobs,
  requeueDead,
} from '../services/jobs.js'

export const configRouter = Router()

configRouter.get('/providers', (_req, res) => {
  res.json({ ok: true, ...getProviderConfig() })
})

configRouter.get('/local-token', (_req, res) => {
  res.json({ ok: true, token: getLocalApiToken() })
})

configRouter.get('/jobs/dead', (_req, res) => {
  res.json({ ok: true, jobs: listDeadJobs() })
})

configRouter.post('/jobs/:id/retry', (req, res) => {
  const ok = requeueDead(String(req.params.id))
  res.json({ ok })
})

configRouter.post('/jobs/:id/cancel', (req, res) => {
  const ok = cancelJob(String(req.params.id))
  res.json({ ok })
})

configRouter.put('/providers', (req, res) => {
  try {
    const body = req.body as {
      provider?: Partial<Record<ProviderSlot, string>>
      model?: Partial<Record<ProviderSlot, string>>
    }
    const next = updateProviderConfig({
      provider: body.provider,
      model: body.model,
    })
    res.json({ ok: true, ...next })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ ok: false, error: msg })
  }
})
