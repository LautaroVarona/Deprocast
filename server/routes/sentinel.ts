import { Router } from 'express'
import {
  abortInspect,
  acceptSkill,
  agentBundle,
  appendMissionMessage,
  createAgent,
  createMission,
  deleteAgent,
  listAgents,
  patchMission,
  pauseMission,
  rejectSkill,
  renameAgent,
  resumeMission,
} from '../services/sentinel.js'
import { getSentinelBrain } from '../services/appSettings.js'

export const sentinelRouter = Router()

function fail(res: import('express').Response, err: unknown, notFound = 'no encontrada') {
  const msg = err instanceof Error ? err.message : String(err)
  const status = msg.toLowerCase().includes(notFound)
    ? 404
    : msg.includes('vací') ||
        msg.includes('Todavía') ||
        msg.includes('en curso') ||
        msg.includes('pausá') ||
        msg.includes('demasiado')
      ? 400
      : 500
  res.status(status).json({ error: msg })
}

sentinelRouter.get('/agents', (_req, res) => {
  try {
    res.json({ ok: true, agents: listAgents() })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.get('/brain', (_req, res) => {
  try {
    res.json({ ok: true, brain: getSentinelBrain() })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/agents', (_req, res) => {
  try {
    const agent = createAgent()
    res.json({ ok: true, agent })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.get('/agents/:id', (req, res) => {
  try {
    const bundle = agentBundle(String(req.params.id))
    if (!bundle) {
      res.status(404).json({ error: 'Sentinela no encontrada' })
      return
    }
    res.json({ ok: true, ...bundle })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.patch('/agents/:id', (req, res) => {
  try {
    const agent = renameAgent(
      String(req.params.id),
      String(req.body?.name ?? ''),
    )
    res.json({ ok: true, agent })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.delete('/agents/:id', (req, res) => {
  try {
    deleteAgent(String(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/agents/:id/abort', (req, res) => {
  try {
    const agent = abortInspect(String(req.params.id))
    res.json({ ok: true, agent })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/agents/:id/missions', (req, res) => {
  try {
    const resources = Array.isArray(req.body?.resources)
      ? req.body.resources.map((x: unknown) => String(x))
      : undefined
    const mission = createMission(String(req.params.id), {
      instructions: String(req.body?.instructions ?? req.body?.command ?? ''),
      expected_output:
        typeof req.body?.expected_output === 'string'
          ? req.body.expected_output
          : undefined,
      resources,
    })
    res.json({ ok: true, mission })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/missions/:id/messages', (req, res) => {
  try {
    const mission = appendMissionMessage(
      String(req.params.id),
      String(req.body?.content ?? ''),
    )
    res.json({ ok: true, mission })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/missions/:id/pause', (req, res) => {
  try {
    const mission = pauseMission(String(req.params.id))
    res.json({ ok: true, mission })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/missions/:id/resume', (req, res) => {
  try {
    const mission = resumeMission(String(req.params.id))
    res.json({ ok: true, mission })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.patch('/missions/:id', (req, res) => {
  try {
    const mission = patchMission(String(req.params.id), {
      instructions:
        typeof req.body?.instructions === 'string'
          ? req.body.instructions
          : undefined,
      expected_output:
        typeof req.body?.expected_output === 'string'
          ? req.body.expected_output
          : undefined,
    })
    res.json({ ok: true, mission })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/skills/:id/accept', (req, res) => {
  try {
    const weight = Number(req.body?.weight)
    const skill = acceptSkill(String(req.params.id), {
      weight: Number.isFinite(weight) ? weight : undefined,
      promote_ida: Boolean(req.body?.promote_ida),
    })
    res.json({ ok: true, skill })
  } catch (err) {
    fail(res, err)
  }
})

sentinelRouter.post('/skills/:id/reject', (req, res) => {
  try {
    const skill = rejectSkill(String(req.params.id))
    res.json({ ok: true, skill })
  } catch (err) {
    fail(res, err)
  }
})
