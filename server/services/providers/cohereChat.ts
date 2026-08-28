/**
 * Cohere Chat v2 adapter — misma forma de respuesta que OpenRouter.
 */
export type CohereContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type CohereChatMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | CohereContentPart[]
    }
  | { role: 'assistant'; content?: string; tool_calls?: unknown }
  | { role: 'tool'; tool_call_id: string; content: string }

export type CohereToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type CohereToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
  }
  return {}
}

export function chatTextFromCohere(data: unknown): string {
  const d = data as {
    message?: { content?: unknown }
    text?: string
  }
  const content = d.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c) {
          return String((c as { text?: string }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return d.text || ''
}

export function parseCohereToolCalls(data: unknown): CohereToolCall[] {
  const root = data as {
    message?: { tool_calls?: unknown; content?: unknown }
    tool_calls?: unknown
  }
  const buckets: unknown[] = []
  const fromMsg = root.message?.tool_calls
  const fromRoot = root.tool_calls
  if (Array.isArray(fromMsg)) buckets.push(...fromMsg)
  if (Array.isArray(fromRoot)) buckets.push(...fromRoot)
  const content = root.message?.content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        item &&
        typeof item === 'object' &&
        ((item as { type?: string }).type === 'tool_call' ||
          (item as { type?: string }).type === 'tool_use')
      ) {
        buckets.push(item)
      }
    }
  }
  const out: CohereToolCall[] = []
  for (const raw of buckets) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as {
      id?: string
      name?: string
      type?: string
      function?: { name?: string; arguments?: unknown }
      arguments?: unknown
    }
    const name = String(o.function?.name ?? o.name ?? '').trim()
    if (!name) continue
    const id = String(o.id ?? '').trim() || `tool_${out.length + 1}`
    out.push({
      id,
      name,
      arguments: parseJsonObject(o.function?.arguments ?? o.arguments),
    })
  }
  return out
}

export function cohereAssistantMessage(data: unknown): unknown {
  const root = data as { message?: unknown }
  return root.message ?? data
}

export async function cohereChat(opts: {
  apiKey: string
  model: string
  messages: CohereChatMessage[]
  temperature?: number
  tools?: CohereToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: CohereToolCall[]; raw: unknown }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature ?? 0.2,
    messages: opts.messages,
  }
  if (opts.tools?.length) body.tools = opts.tools
  if (opts.responseFormat) body.response_format = opts.responseFormat

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    const err = new Error(
      `Cohere chat falló (${res.status}): ${errText.slice(0, 400)}`,
    ) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const data = (await res.json()) as unknown
  return {
    text: chatTextFromCohere(data).trim(),
    toolCalls: parseCohereToolCalls(data),
    raw: data,
  }
}
