import { Router } from 'express'
import multer from 'multer'
import type { BookmarkManualTag, ChatSpeakerMap, ChatTipo } from '../types.js'
import {
  assignBlockEntity,
  deleteChatSession,
  exportChatConversations,
  getChatBlockDetail,
  getChatSessionDetail,
  importChatSession,
  listChatSessions,
  previewChatFile,
  processChatSession,
  updateChatBlock,
  updateChatSession,
} from '../services/chatProcess.js'
import {
  getChatQueueStatus,
  startChatProcess,
  stopChatProcess,
} from '../services/chatQueue.js'

export const chatsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 1 },
})

function parseTipo(raw: unknown): ChatTipo | undefined {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'individual' || s === 'grupo') return s
  return undefined
}

function parseStringIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) return p.map(String).filter(Boolean)
    } catch {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }
  return []
}

const EXTRA_ENTITY_KINDS = new Set(['dominio', 'agrupacion', 'geografia'])

function parseLinkedEntities(raw: unknown): BookmarkManualTag[] | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const out: BookmarkManualTag[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = String(o.kind ?? '').trim()
    const id = String(o.id ?? o.entity_id ?? '').trim()
    const name = String(o.name ?? o.entity_name ?? '').trim()
    if (!id || !EXTRA_ENTITY_KINDS.has(kind)) continue
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: kind as BookmarkManualTag['kind'],
      entity_id: id,
      entity_name: name || id,
    })
  }
  return out
}

function parseSpeakerMap(raw: unknown): ChatSpeakerMap[] | undefined {
  let parsed: unknown = raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (!Array.isArray(parsed)) return undefined
  const out: ChatSpeakerMap[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const remitente = String(o.remitente ?? '').trim()
    if (!remitente) continue
    out.push({
      remitente,
      person_id:
        typeof o.person_id === 'string' && o.person_id.trim()
          ? o.person_id.trim()
          : null,
      person_name:
        typeof o.person_name === 'string' && o.person_name.trim()
          ? o.person_name.trim()
          : null,
    })
  }
  return out
}

function parseOptionalId(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const s = String(raw).trim()
  return s || null
}

function parseOptionalWeight(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

chatsRouter.get('/', (_req, res) => {
  try {
    const sessions = listChatSessions()
    res.json({ ok: true, sessions })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.post('/preview', upload.single('file'), (req, res) => {
  try {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'Falta archivo .txt' })
      return
    }
    const parsed = previewChatFile(file.buffer, file.originalname || 'chat.txt')
    res.json({
      ok: true,
      preview: {
        suggested_name: parsed.suggested_name,
        tipo_auto: parsed.tipo_auto,
        participantes: parsed.participantes,
        message_count: parsed.messages.length,
        system_count: parsed.system_count,
        media_count: parsed.media_count,
        link_count: parsed.link_count,
        first_ts: parsed.first_ts,
        last_ts: parsed.last_ts,
        origin_hash: parsed.origin_hash,
      },
    })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.post('/import', upload.single('file'), (req, res) => {
  try {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'Falta archivo .txt' })
      return
    }
    const result = importChatSession({
      buffer: file.buffer,
      filename: file.originalname || 'chat.txt',
      nombre_chat: req.body?.nombre_chat
        ? String(req.body.nombre_chat)
        : undefined,
      tipo: parseTipo(req.body?.tipo),
      person_ids: parseStringIds(req.body?.person_ids),
      project_ids: parseStringIds(req.body?.project_ids),
      speaker_map: parseSpeakerMap(req.body?.speaker_map),
      primary_person_id: parseOptionalId(req.body?.primary_person_id),
      primary_project_id: parseOptionalId(req.body?.primary_project_id),
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    const e = err as Error & { status?: number; session?: unknown }
    if (e.status === 409) {
      res.status(409).json({
        error: e.message,
        session: e.session,
      })
      return
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.post('/process/start', (req, res) => {
  try {
    const sessionId = req.body?.session_id
      ? String(req.body.session_id)
      : undefined
    const blockId = req.body?.block_id
      ? String(req.body.block_id)
      : undefined
    const result = startChatProcess({ sessionId, blockId })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.post('/process/stop', (_req, res) => {
  res.json({ ok: true, ...stopChatProcess() })
})

chatsRouter.get('/process/status', (_req, res) => {
  res.json({ ok: true, ...getChatQueueStatus() })
})

chatsRouter.get('/export', (_req, res) => {
  try {
    const payload = exportChatConversations()
    res.json({ ok: true, ...payload })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.get('/:id', (req, res) => {
  try {
    const detail = getChatSessionDetail(req.params.id)
    if (!detail) {
      res.status(404).json({ error: 'Sesión no encontrada' })
      return
    }
    res.json({ ok: true, ...detail })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.get('/:id/export', (req, res) => {
  try {
    const payload = exportChatConversations(req.params.id)
    if (payload.count === 0) {
      res.status(404).json({ error: 'Sesión no encontrada' })
      return
    }
    res.json({ ok: true, ...payload })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.delete('/:id', (req, res) => {
  try {
    const result = deleteChatSession(req.params.id)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status =
      (err as { status?: number }).status ??
      (msg.includes('no encontrada')
        ? 404
        : msg.includes('destilando')
          ? 409
          : 500)
    res.status(status).json({ error: msg })
  }
})

chatsRouter.patch('/:id', (req, res) => {
  try {
    const session = updateChatSession(req.params.id, {
      nombre_chat:
        req.body?.nombre_chat != null
          ? String(req.body.nombre_chat)
          : undefined,
      tipo: parseTipo(req.body?.tipo),
      speaker_map: parseSpeakerMap(req.body?.speaker_map),
      person_ids:
        req.body?.person_ids !== undefined
          ? parseStringIds(req.body.person_ids)
          : undefined,
      project_ids:
        req.body?.project_ids !== undefined
          ? parseStringIds(req.body.project_ids)
          : undefined,
      primary_person_id: parseOptionalId(req.body?.primary_person_id),
      primary_project_id: parseOptionalId(req.body?.primary_project_id),
      human_weight: parseOptionalWeight(req.body?.human_weight),
    })
    res.json({ ok: true, session })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg.includes('no encontrada') ? 404 : 500).json({ error: msg })
  }
})

chatsRouter.post('/:id/process', async (req, res) => {
  const t0 = Date.now()
  console.log('[chats/process] start', req.params.id)
  try {
    const limitRaw = req.body?.limit ?? req.query?.limit
    const limit =
      limitRaw != null && String(limitRaw).trim() !== ''
        ? Number(limitRaw)
        : 1
    const blockId = req.body?.block_id
      ? String(req.body.block_id)
      : undefined
    const result = await processChatSession(req.params.id, {
      limit: Number.isFinite(limit) ? limit : 1,
      blockId,
    })
    console.log('[chats/process] done', req.params.id, Date.now() - t0, 'ms')
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[chats/process] error', msg)
    const status = msg.includes('no encontrada')
      ? 404
      : msg.includes('ya se está procesando')
        ? 409
        : 500
    res.status(status).json({ error: msg })
  }
})

chatsRouter.get('/:id/blocks/:blockId', (req, res) => {
  try {
    const detail = getChatBlockDetail(req.params.id, req.params.blockId)
    if (!detail) {
      res.status(404).json({ error: 'Bloque no encontrado' })
      return
    }
    res.json({ ok: true, ...detail })
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

chatsRouter.patch('/:id/blocks/:blockId', (req, res) => {
  try {
    const block = updateChatBlock(req.params.id, req.params.blockId, {
      person_ids:
        req.body?.person_ids !== undefined
          ? parseStringIds(req.body.person_ids)
          : undefined,
      project_ids:
        req.body?.project_ids !== undefined
          ? parseStringIds(req.body.project_ids)
          : undefined,
      entities:
        req.body?.entities !== undefined
          ? parseLinkedEntities(req.body.entities)
          : undefined,
      human_weight: parseOptionalWeight(req.body?.human_weight),
      notes:
        req.body?.notes !== undefined ? String(req.body.notes) : undefined,
      links:
        req.body?.links !== undefined
          ? parseStringIds(req.body.links)
          : undefined,
    })
    res.json({ ok: true, block })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg.includes('no encontrado') ? 404 : 500).json({ error: msg })
  }
})

chatsRouter.post('/:id/blocks/:blockId/process', async (req, res) => {
  try {
    const result = await processChatSession(req.params.id, {
      blockId: req.params.blockId,
      limit: 1,
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('no encontrada')
      ? 404
      : msg.includes('ya se está procesando')
        ? 409
        : 500
    res.status(status).json({ error: msg })
  }
})

chatsRouter.post('/:id/blocks/:blockId/entities', (req, res) => {
  try {
    const typeRaw = String(req.body?.type ?? '')
    const type = typeRaw === 'project' ? 'project' : 'person'
    const actionRaw = String(req.body?.action ?? 'link')
    const action =
      actionRaw === 'create' || actionRaw === 'reject' ? actionRaw : 'link'
    const entity = assignBlockEntity(req.params.id, req.params.blockId, {
      name: String(req.body?.name ?? ''),
      type,
      action,
      entity_id: req.body?.entity_id ? String(req.body.entity_id) : undefined,
      create_name: req.body?.create_name
        ? String(req.body.create_name)
        : undefined,
    })
    res.json({ ok: true, entity })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('no encontrado') || msg.includes('no está')
      ? 404
      : msg.includes('requerid')
        ? 400
        : 500
    res.status(status).json({ error: msg })
  }
})
