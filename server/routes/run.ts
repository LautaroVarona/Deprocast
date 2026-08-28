import { Router } from 'express'
import {
  getCurrentRun,
  newUserRun,
  startRun,
} from '../services/run.js'
import { withMaintenance } from '../services/maintenance.js'
import { aiRateLimit } from '../services/localAuth.js'

export const runRouter = Router()

runRouter.get('/', (_req, res) => {
  try {
    res.json({ ok: true, run: getCurrentRun() })
  } catch (err) {
    console.error('[run/get]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'No se pudo leer la RUN',
    })
  }
})

runRouter.post('/start', aiRateLimit, (req, res) => {
  try {
    const run = startRun(req.body?.name)
    res.status(201).json({ ok: true, run })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo iniciar la RUN'
    const conflict = message.includes('Ya hay una RUN')
    console.error('[run/start]', err)
    res.status(conflict ? 409 : 400).json({ error: message })
  }
})

runRouter.post('/new-user', (req, res) => {
  void (async () => {
    try {
      const result = await withMaintenance('new-user', () =>
        newUserRun({
          confirmDestroy: req.body?.confirm_destroy,
          operatorName: req.body?.operator_name,
          newName: req.body?.new_name,
        }),
      )
      res.json({
        ok: true,
        filename: result.filename,
        backup_path: result.backup_path,
        dump: result.dump,
        run: result.run,
      })
    } catch (err) {
      console.error('[run/new-user]', err)
      res.status(400).json({
        error: err instanceof Error ? err.message : 'NUEVO USUARIO fallido',
      })
    }
  })()
})
