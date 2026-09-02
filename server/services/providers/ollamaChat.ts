/**
 * Ollama local (fallback / cerebro Sentinela).
 * POST /api/chat — texto + tools OpenAI-compatibles.
 */
import {
  parseOpenAiToolCalls,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './openrouter.js'

export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_URL ?? 'http://localhost:11434')
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/\/+$/, '')
}

export function defaultOllamaModel(): string {
  return (process.env.OLLAMA_MODEL ?? 'llama3').replace(/^["']|["']$/g, '').trim()
}

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const base = (baseUrl ?? ollamaBaseUrl()).replace(/\/+$/, '')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4_000)
  try {
    const res = await fetch(`${base}/api/tags`, { signal: ac.signal })
    if (!res.ok) return []
    const data = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>
    }
    return (data.models ?? [])
      .map((m) => String(m.name || m.model || '').trim())
      .filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Elige un tag instalado. `llama3` no casa con `llama3.1`, sí con `llama3:latest`. */
export function pickOllamaModel(
  installed: string[],
  preferred: string,
): string | null {
  if (!installed.length) return null
  const pref = preferred.trim().toLowerCase()
  if (!pref) return installed[0] ?? null
  const exact = installed.find((n) => n.toLowerCase() === pref)
  if (exact) return exact
  const tagged = installed.find((n) => {
    const low = n.toLowerCase()
    return low === `${pref}:latest` || low.startsWith(`${pref}:`)
  })
  if (tagged) return tagged
  return installed[0] ?? null
}

export async function resolveOllamaModel(
  preferred?: string,
  baseUrl?: string,
): Promise<string | null> {
  const installed = await listOllamaModels(baseUrl)
  return pickOllamaModel(installed, preferred ?? defaultOllamaModel())
}

function contentToText(content: OrMessage['content'] | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

function imagesFromContent(content: OrMessage['content'] | undefined): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (!('image_url' in part)) continue
    const url = String(
      (part as { image_url?: { url?: string } }).image_url?.url ?? '',
    )
    const m = url.match(/^data:[^;]+;base64,(.+)$/s)
    if (m?.[1]) out.push(m[1])
  }
  return out
}

function toOllamaMessages(messages: OrMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_name:
          (m as { name?: string }).name ||
          (m as { tool_name?: string }).tool_name,
      }
    }
    const row: Record<string, unknown> = {
      role: m.role,
      content: contentToText(m.content),
    }
    const images = imagesFromContent(m.content)
    if (images.length) row.images = images
    if ('tool_calls' in m && m.tool_calls) {
      row.tool_calls = m.tool_calls
    }
    return row
  })
}

export async function ollamaChat(opts: {
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  baseUrl?: string
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  const base = (opts.baseUrl ?? ollamaBaseUrl()).replace(/\/+$/, '')
  const endpoint = `${base}/api/chat`
  const body: Record<string, unknown> = {
    model: opts.model || defaultOllamaModel(),
    stream: false,
    messages: toOllamaMessages(opts.messages),
    options: { temperature: opts.temperature ?? 0.2 },
  }
  if (opts.tools?.length) body.tools = opts.tools

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 120_000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const err = new Error(
        `Ollama chat falló (${res.status}): ${errText.slice(0, 400)}`,
      ) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    const data = (await res.json()) as {
      message?: {
        content?: unknown
        tool_calls?: unknown
      }
    }
    const message = data.message ?? {}
    const text =
      typeof message.content === 'string' ? message.content : ''
    const raw = {
      choices: [{ message }],
      message,
    }
    return {
      text: text.trim(),
      toolCalls: parseOpenAiToolCalls(raw),
      raw: data,
    }
  } finally {
    clearTimeout(timer)
  }
}
