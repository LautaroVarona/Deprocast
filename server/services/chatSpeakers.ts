import type { ChatMessage, ChatSpeakerMap } from '../types.js'

export const CHAT_AI_DEFAULT_WEIGHT = 4
export const CHAT_HUMAN_DEFAULT_WEIGHT = 7
export const CHAT_BLOCK_PREVIEW_LIMIT = 3

export function parseChatSpeakerMap(
  raw: string | null | undefined,
): ChatSpeakerMap[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ChatSpeakerMap[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const remitente = String(o.remitente ?? '').trim()
      if (!remitente || seen.has(remitente)) continue
      seen.add(remitente)
      const person_id =
        typeof o.person_id === 'string' && o.person_id.trim()
          ? o.person_id.trim()
          : null
      const person_name =
        typeof o.person_name === 'string' && o.person_name.trim()
          ? o.person_name.trim()
          : null
      const is_ai = parseIsAi(o.is_ai)
      const role =
        o.role === 'assistant' || is_ai
          ? 'assistant'
          : o.role === 'human'
            ? 'human'
            : is_ai
              ? 'assistant'
              : 'human'
      const model =
        typeof o.model === 'string' && o.model.trim()
          ? o.model.trim()
          : null
      out.push({ remitente, person_id, person_name, is_ai, role, model })
    }
    return out
  } catch {
    return []
  }
}

function parseIsAi(raw: unknown): boolean {
  if (raw === true || raw === 1) return true
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'ia' || s === 'ai'
  }
  return false
}

export function speakersHaveAi(
  speakers: Array<{ is_ai?: boolean | null }>,
): boolean {
  return speakers.some((s) => Boolean(s.is_ai))
}

export function resolveChatProcessWeight(opts: {
  blockWeight?: number | null
  conversationWeight?: number | null
  suggestedWeight?: number | null
  hasAi: boolean
}): number {
  const chat =
    opts.blockWeight != null && Number.isFinite(Number(opts.blockWeight))
      ? Number(opts.blockWeight)
      : null
  const conv =
    opts.conversationWeight != null &&
    Number.isFinite(Number(opts.conversationWeight))
      ? Number(opts.conversationWeight)
      : null
  const suggested =
    opts.suggestedWeight != null &&
    Number.isFinite(Number(opts.suggestedWeight))
      ? Number(opts.suggestedWeight)
      : null
  let picked: number
  if (chat != null && conv != null) {
    picked = conv * 0.4 + chat * 0.6
  } else {
    picked =
      chat ??
      conv ??
      suggested ??
      (opts.hasAi ? CHAT_AI_DEFAULT_WEIGHT : CHAT_HUMAN_DEFAULT_WEIGHT)
  }
  return Math.max(1, Math.min(12, Math.round(picked)))
}

export function previewMessagesByBlock(
  messages: ChatMessage[],
  perBlock = CHAT_BLOCK_PREVIEW_LIMIT,
): Map<string, ChatMessage[]> {
  const out = new Map<string, ChatMessage[]>()
  for (const m of messages) {
    if (m.is_system) continue
    const bid = m.block_id
    if (!bid) continue
    const list = out.get(bid) ?? []
    if (list.length >= perBlock) continue
    list.push(m)
    out.set(bid, list)
  }
  return out
}
