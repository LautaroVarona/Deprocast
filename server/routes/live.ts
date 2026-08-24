import { Router } from 'express'

export const liveRouter = Router()

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

/**
 * Config live (sin JWT). El audio va por WS proxy /api/live/stream
 * porque muchas API keys no tienen permiso Member para /auth/grant.
 */
liveRouter.get('/config', (_req, res) => {
  const apiKey = env('DEEPGRAM_API_KEY')
  if (!apiKey) {
    res.status(503).json({
      error: 'DEEPGRAM_API_KEY no configurada. Directo no puede escuchar.',
    })
    return
  }

  res.json({
    model: env('DEEPGRAM_MODEL', 'nova-3'),
    language: env('DEEPGRAM_LANGUAGE', 'es'),
    stream_path: '/api/live/stream',
    diarize: true,
  })
})
