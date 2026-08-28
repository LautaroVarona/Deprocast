import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { closeDb, initDb } from './db.js'
import { recoverOrphanedProcessing } from './services/pipeline.js'
import { recoverExpiredLeases } from './services/jobs.js'
import { ingestRouter } from './routes/ingest.js'
import { entriesRouter } from './routes/entries.js'
import { pipelineRouter } from './routes/pipeline.js'
import { proposalsRouter } from './routes/proposals.js'
import { personsRouter } from './routes/persons.js'
import { projectsRouter } from './routes/projects.js'
import { waitingRouter } from './routes/waiting.js'
import { quantomosRouter } from './routes/quantomos.js'
import { graphRouter } from './routes/graph.js'
import { sandboxesRouter } from './routes/sandboxes.js'
import { bookmarksRouter } from './routes/bookmarks.js'
import { agrupacionesRouter } from './routes/agrupaciones.js'
import { dominiosRouter } from './routes/dominios.js'
import { geografiaRouter } from './routes/geografia.js'
import { notebooksRouter } from './routes/notebooks.js'
import { chatsRouter } from './routes/chats.js'
import { linksRouter } from './routes/links.js'
import { entitiesRouter } from './routes/entities.js'
import { backupRouter } from './routes/backup.js'
import { runRouter } from './routes/run.js'
import { feedbackRouter } from './routes/feedback.js'
import { calendarRouter } from './routes/calendar.js'
import { amazonaRouter } from './routes/amazona.js'
import { mapRouter } from './routes/map.js'
import { deprocastRouter } from './routes/deprocast.js'
import { dialogoRouter } from './routes/dialogo.js'
import { sentinelRouter } from './routes/sentinel.js'
import { liveRouter } from './routes/live.js'
import { configRouter } from './routes/config.js'
import { attachLiveWsProxy } from './liveWs.js'
import { capabilities, validateEnv } from './config.js'
import {
  corsOrigin,
  getLocalApiToken,
  localAuthMiddleware,
} from './services/localAuth.js'
import { beginMaintenance } from './services/maintenance.js'
import { publicError } from './errors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PORT = Number(process.env.PORT || 3001)
let ready = false

const envCheck = validateEnv()
if (!envCheck.ok) {
  console.error('[deprocast] env inválido:', envCheck.errors.join('; '))
  process.exit(1)
}

initDb()
recoverOrphanedProcessing()
try {
  const n = recoverExpiredLeases()
  if (n > 0) console.warn(`[jobs] reencolados ${n} lease(s) expirados`)
} catch {
  /* tabla puede no existir en boot parcial */
}

const token = getLocalApiToken()
const caps = capabilities()

const app = express()
app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json({ limit: '25mb' }))

app.use((req, _res, next) => {
  const id = String(req.header('x-request-id') || `${Date.now().toString(36)}`)
  req.headers['x-request-id'] = id
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'deprocast-server',
    groq: caps.groq,
    ollama: true,
    cohere: caps.cohere,
    openrouter: caps.openrouter,
    deepgram: caps.deepgram,
    perplexity: caps.perplexity,
  })
})

app.get('/api/ready', (_req, res) => {
  if (!ready) {
    res.status(503).json({ ok: false, ready: false })
    return
  }
  res.json({ ok: true, ready: true })
})

app.use(localAuthMiddleware)

app.use('/api/ingest', ingestRouter)
app.use('/api/entries', entriesRouter)
app.use('/api/pipeline', pipelineRouter)
app.use('/api/proposals', proposalsRouter)
app.use('/api/persons', personsRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/waiting', waitingRouter)
app.use('/api/quantomos', quantomosRouter)
app.use('/api/graph', graphRouter)
app.use('/api/sandboxes', sandboxesRouter)
app.use('/api/bookmarks', bookmarksRouter)
app.use('/api/agrupaciones', agrupacionesRouter)
app.use('/api/dominios', dominiosRouter)
app.use('/api/geografia', geografiaRouter)
app.use('/api/notebooks', notebooksRouter)
app.use('/api/chats', chatsRouter)
app.use('/api/links', linksRouter)
app.use('/api/entities', entitiesRouter)
app.use('/api/backup', backupRouter)
app.use('/api/run', runRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/amazona', amazonaRouter)
app.use('/api/map', mapRouter)
app.use('/api/deprocast', deprocastRouter)
app.use('/api/dialogo', dialogoRouter)
app.use('/api/sentinela', sentinelRouter)
app.use('/api/live', liveRouter)
app.use('/api/config', configRouter)

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const pub = publicError(err)
    console.error('[deprocast]', err)
    res.status(pub.status).json(pub.body)
  },
)

const server = app.listen(PORT, '127.0.0.1', () => {
  ready = true
  console.log(`[deprocast] server listening on http://127.0.0.1:${PORT}`)
  console.log(`[deprocast] Cohere configured: ${caps.cohere}`)
  console.log(`[deprocast] OpenRouter configured: ${caps.openrouter}`)
  console.log('[deprocast] local token ready (no se imprime el valor)')
})

const closeLive = attachLiveWsProxy(server, () => token)

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[deprocast] puerto ${PORT} ocupado. Cerrá el proceso anterior o matá el PID en ese puerto.`,
    )
  } else {
    console.error('[deprocast] listen error:', err)
  }
  process.exit(1)
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  ready = false
  console.warn(`[deprocast] shutdown ${signal}`)
  try {
    await beginMaintenance(`shutdown:${signal}`)
  } catch {
    /* ignore */
  }
  try {
    closeLive()
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    setTimeout(resolve, 8000)
  })
  closeDb()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
