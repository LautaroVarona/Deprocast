/**
 * Google Gemini (visión / JSON nativo).
 * Keys: GEMINI_API_KEY | GOOGLE_API_KEY | GOOGLE_GENERATIVE_AI_API_KEY
 */
import {
  parseOpenAiToolCalls,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './openrouter.js'

const MODEL_ALIASES: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-3.6-flash',
  'gemini-2.0-flash-001': 'gemini-3.6-flash',
  'gemini-1.5-flash': 'gemini-3.6-flash',
  'gemini-1.5-flash-latest': 'gemini-3.6-flash',
  'gemini-1.5-flash-001': 'gemini-3.6-flash',
}

const deadUntil = new Map<string, number>()

export function resolveGeminiModel(raw: string): string {
  const id = raw.replace(/^models\//, '').trim() || 'gemini-3.6-flash'
  return MODEL_ALIASES[id] ?? id
}

export function geminiApiKey(): string {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ]
  for (const k of keys) {
    const v = (k ?? '').replace(/^["']|["']$/g, '').trim()
    if (v) return v
  }
  return ''
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }

function partsFromMessages(messages: OrMessage[]): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      parts.push({ text: String(m.content ?? '') })
      continue
    }
    const content = m.content
    if (typeof content === 'string') {
      if (content.trim()) parts.push({ text: content })
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      if ('text' in part && typeof (part as { text?: string }).text === 'string') {
        parts.push({ text: (part as { text: string }).text })
      }
      if ('image_url' in part) {
        const url = String(
          (part as { image_url?: { url?: string } }).image_url?.url ?? '',
        )
        const match = url.match(/^data:([^;]+);base64,(.+)$/s)
        if (match) {
          parts.push({
            inline_data: { mime_type: match[1] || 'image/jpeg', data: match[2] },
          })
        }
      }
    }
  }
  return parts
}

function textFromGemini(data: unknown): string {
  const d = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
    }>
  }
  const parts = d.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((p) => String(p.text ?? ''))
    .join('')
    .trim()
}

function retryDelayMs(res: Response, body: string): number {
  const h = res.headers.get('retry-after')
  if (h) {
    const sec = Number(h)
    if (Number.isFinite(sec) && sec > 0) return Math.min(120_000, sec * 1000)
  }
  const m = body.match(/retryDelay"\s*:\s*"(\d+)s"/i)
  if (m) return Math.min(120_000, Number(m[1]) * 1000)
  return 25_000
}

export async function geminiChat(opts: {
  apiKey: string
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  const model = resolveGeminiModel(opts.model)
  const dead = deadUntil.get(model) ?? 0
  if (dead > Date.now()) {
    const err = new Error(
      `Gemini ${model} no disponible hasta ${new Date(dead).toISOString()}`,
    ) as Error & { status?: number }
    err.status = 404
    throw err
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: partsFromMessages(opts.messages) }],
    generationConfig: {
      temperature: opts.temperature ?? 1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  const once = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const rawText = await res.text()
    return { res, rawText }
  }

  let { res, rawText } = await once()
  for (let n = 0; n < 3 && res.status === 429; n++) {
    const wait = retryDelayMs(res, rawText) * (n + 1)
    console.warn(`[gemini] 429 ${model}, espera ${Math.round(wait / 1000)}s…`)
    await new Promise((r) => setTimeout(r, wait))
    ;({ res, rawText } = await once())
  }

  let parsed: unknown = rawText
  try {
    parsed = JSON.parse(rawText) as unknown
  } catch {
    /* texto crudo */
  }

  if (!res.ok) {
    if (res.status === 404) {
      deadUntil.set(model, Date.now() + 6 * 60 * 60 * 1000)
    }
    const err = new Error(
      `Gemini chat falló (${res.status}): ${rawText.slice(0, 400)}`,
    ) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const text = textFromGemini(parsed)
  if (!text) {
    const block = (parsed as { promptFeedback?: { blockReason?: string } })
      ?.promptFeedback?.blockReason
    throw new Error(
      `Gemini no devolvió texto${block ? ` (bloqueo: ${block})` : ''}`,
    )
  }
  return {
    text,
    toolCalls: parseOpenAiToolCalls(parsed),
    raw: parsed,
  }
}
