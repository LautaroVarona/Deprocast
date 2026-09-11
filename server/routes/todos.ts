import { Router } from 'express'
import { AppError } from '../errors.js'
import {
  acceptSuggestedTodo,
  exportTodoistShape,
  getSuggestedTodo,
  listSuggestedTodos,
  patchSuggestedTodo,
  regenerateSuggestedTodos,
} from '../services/suggestedTodos.js'

export const todosRouter = Router()

function sendErr(res: import('express').Response, err: unknown, log: string) {
  const status = err instanceof AppError ? err.status : 500
  const message = err instanceof Error ? err.message : String(err)
  if (status >= 500) console.error(log, err)
  res.status(status).json({
    error: message,
    code: err instanceof AppError ? err.code : undefined,
  })
}

todosRouter.get('/', (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const horizon =
      typeof req.query.horizon === 'string' ? req.query.horizon : undefined
    const from = typeof req.query.from === 'string' ? req.query.from : undefined
    const to = typeof req.query.to === 'string' ? req.query.to : undefined
    const todos = listSuggestedTodos({ status, horizon, from, to })
    res.json({ ok: true, todos })
  } catch (err) {
    sendErr(res, err, '[todos/list]')
  }
})

todosRouter.get('/export', (req, res) => {
  try {
    const shape = typeof req.query.shape === 'string' ? req.query.shape : 'todoist'
    if (shape !== 'todoist') {
      res.status(400).json({ error: 'shape no soportado' })
      return
    }
    res.json({ ok: true, ...exportTodoistShape() })
  } catch (err) {
    sendErr(res, err, '[todos/export]')
  }
})

todosRouter.post('/regenerate', async (req, res) => {
  try {
    const useLlm = req.body?.use_llm !== false
    const result = await regenerateSuggestedTodos({ useLlm })
    res.json({ ok: true, ...result })
  } catch (err) {
    sendErr(res, err, '[todos/regenerate]')
  }
})

todosRouter.post('/:id/accept', (req, res) => {
  try {
    const todo = acceptSuggestedTodo(String(req.params.id ?? ''), {
      create_calendar_hold: req.body?.create_calendar_hold === true,
      export_todoist_shape: req.body?.export_todoist_shape === true,
    })
    res.json({ ok: true, todo })
  } catch (err) {
    sendErr(res, err, '[todos/accept]')
  }
})

todosRouter.post('/:id/dismiss', (req, res) => {
  try {
    const id = String(req.params.id ?? '')
    if (!getSuggestedTodo(id)) {
      res.status(404).json({ error: 'Tarea sugerida no encontrada' })
      return
    }
    const todo = patchSuggestedTodo(id, { status: 'dismissed' })
    res.json({ ok: true, todo })
  } catch (err) {
    sendErr(res, err, '[todos/dismiss]')
  }
})

todosRouter.post('/:id/done', (req, res) => {
  try {
    const id = String(req.params.id ?? '')
    if (!getSuggestedTodo(id)) {
      res.status(404).json({ error: 'Tarea sugerida no encontrada' })
      return
    }
    const todo = patchSuggestedTodo(id, { status: 'done' })
    res.json({ ok: true, todo })
  } catch (err) {
    sendErr(res, err, '[todos/done]')
  }
})

todosRouter.patch('/:id', (req, res) => {
  try {
    const id = String(req.params.id ?? '')
    if (!getSuggestedTodo(id)) {
      res.status(404).json({ error: 'Tarea sugerida no encontrada' })
      return
    }
    const todo = patchSuggestedTodo(id, {
      status: typeof req.body?.status === 'string' ? req.body.status : undefined,
      acceptance: req.body?.acceptance,
    })
    res.json({ ok: true, todo })
  } catch (err) {
    sendErr(res, err, '[todos/patch]')
  }
})
