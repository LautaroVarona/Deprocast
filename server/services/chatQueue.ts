/**
 * Cola in-memory de destilado de chats cribados → entry + quántomo + links.
 * Mismo patrón que bookmarkQueue: start responde al toque; drain en background.
 */
import { getDb } from '../db.js'
import { row } from '../sql.js'
import type { ChatSession } from '../types.js'
import {
  listProcessableChatBlocks,
  processChatSession,
  reopenFailedChatBlocks,
  sessionSpeakersReady,
} from './chatProcess.js'
import { canCallLlm } from './appSettings.js'
import { waitWhile } from './wait.js'

export type ChatQueueItem = {
  session_id: string
  block_id: string
}

export type ChatQueueItemResult = {
  block_id: string
  session_id: string
  entry_id: string
  quantomo_id: string
  title: string
}

export type ChatQueueStatus = {
  running: boolean
  stop_requested: boolean
  target: number
  done: number
  remaining: number
  skipped: number
  current_id: string | null
  current_title: string | null
  last_item: ChatQueueItemResult | null
  errors: Array<{ id: string; error: string }>
  started_at: string | null
  finished_at: string | null
}

let running = false
let stopRequested = false
let drainGen = 0
let queue: ChatQueueItem[] = []
let currentId: string | null = null
let currentTitle: string | null = null
let target = 0
let done = 0
let skipped = 0
let lastItem: ChatQueueItemResult | null = null
let errors: Array<{ id: string; error: string }> = []
let startedAt: string | null = null
let finishedAt: string | null = null

function snapshot(): ChatQueueStatus {
  return {
    running,
    stop_requested: stopRequested,
    target,
    done,
    remaining: queue.length + (currentId ? 1 : 0),
    skipped,
    current_id: currentId,
    current_title: currentTitle,
    last_item: lastItem,
    errors: errors.slice(-40),
    started_at: startedAt,
    finished_at: finishedAt,
  }
}

export function getChatQueueStatus(): ChatQueueStatus {
  return snapshot()
}

export function startChatProcess(opts?: {
  sessionId?: string
  blockId?: string
}): ChatQueueStatus & { queued: number; message: string } {
  const sessionId = opts?.sessionId?.trim() || undefined
  const blockId = opts?.blockId?.trim() || undefined

  if (sessionId) {
    const db = getDb()
    const session = row<ChatSession>(
      db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
    )
    if (!session) {
      return {
        ...snapshot(),
        queued: 0,
        message: 'Sesión no encontrada',
      }
    }
    if (!sessionSpeakersReady(session)) {
      return {
        ...snapshot(),
        queued: 0,
        message: 'Asigná todos los hablantes antes de destilar',
      }
    }
  }

  const reopened = reopenFailedChatBlocks(sessionId)

  if (!canCallLlm('fast')) {
    return {
      ...snapshot(),
      queued: 0,
      message:
        'Configurá Groq, Cohere u OpenRouter: los quántomos se destilan con LLM',
    }
  }

  const items = listProcessableChatBlocks({ sessionId, blockId })
  const known = new Set(queue.map((q) => q.block_id))
  if (currentId) known.add(currentId)
  const fresh = items.filter((i) => !known.has(i.block_id))

  if (fresh.length === 0 && !running) {
    return {
      ...snapshot(),
      queued: 0,
      message: sessionId
        ? 'Nada listo: cribá (voto) o ya está destilado con LLM'
        : 'Nada listo para destilar',
    }
  }

  for (const item of fresh) {
    queue.push({ session_id: item.session_id, block_id: item.block_id })
  }

  if (running) {
    target += fresh.length
    return {
      ...snapshot(),
      queued: fresh.length,
      message: `Sumado a cola activa: +${fresh.length}`,
    }
  }

  target = queue.length
  done = 0
  skipped = 0
  errors = []
  lastItem = null
  currentTitle = null
  stopRequested = false
  startedAt = new Date().toISOString()
  finishedAt = null
  running = true
  void drain()

  return {
    ...snapshot(),
    running: true,
    queued: queue.length,
    message: [
      `Destilando ${queue.length} chat(s) con LLM`,
      reopened ? `· reabiertos ${reopened} con error` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

export function stopChatProcess(): ChatQueueStatus {
  if (!running) return snapshot()
  stopRequested = true
  queue = []
  return snapshot()
}

export async function waitChatIdle(ms: number): Promise<void> {
  await waitWhile(() => running, ms)
}

async function drain(): Promise<void> {
  const gen = ++drainGen
  running = true
  stopRequested = false
  console.log(`[chat-queue] drain start gen=${gen} n=${queue.length}`)

  try {
    while (queue.length > 0) {
      if (gen !== drainGen) return
      if (stopRequested) {
        queue = []
        break
      }

      const item = queue.shift()!
      currentId = item.block_id
      currentTitle = item.block_id.slice(0, 8)

      try {
        const result = await processChatSession(item.session_id, {
          blockId: item.block_id,
          limit: 1,
        })
        done += 1
        const first = result.items[0]
        if (first) {
          lastItem = {
            block_id: first.block_id,
            session_id: item.session_id,
            entry_id: first.entry_id,
            quantomo_id: first.quantomo_id,
            title: first.title,
          }
          currentTitle = first.title
        } else if (result.errors[0]) {
          skipped += 1
          errors.push({
            id: item.block_id,
            error: result.errors[0].error,
          })
        } else {
          skipped += 1
        }
      } catch (err) {
        skipped += 1
        done += 1
        errors.push({
          id: item.block_id,
          error: err instanceof Error ? err.message : String(err),
        })
        if (errors.length > 80) errors = errors.slice(-80)
        console.error(`[chat-queue] ${item.block_id}:`, err)
      } finally {
        currentId = null
      }
    }
  } finally {
    if (gen === drainGen) {
      running = false
      stopRequested = false
      currentId = null
      finishedAt = new Date().toISOString()
      console.log(
        `[chat-queue] drain end gen=${gen} done=${done} skipped=${skipped}` +
          (errors[0] ? ` lastError=${errors[errors.length - 1]?.error}` : ''),
      )
    }
  }
}
