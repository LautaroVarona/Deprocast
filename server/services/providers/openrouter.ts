/**
 * OpenRouter chat (OpenAI-compatible). Usado para Stealth / ox-alpha.
 */
function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

export type OrContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OrMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | OrContentPart[] }
  | { role: 'assistant'; content?: string | null; tool_calls?: unknown }
  | { role: 'tool'; tool_call_id: string; content: string }

export type OrToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type OrToolCall = {
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

export function parseOpenAiToolCalls(data: unknown): OrToolCall[] {
  const root = data as {
    choices?: Array<{ message?: { tool_calls?: unknown } }>
    message?: { tool_calls?: unknown }
    tool_calls?: unknown
  }
  const buckets: unknown[] = []
  const fromChoice = root.choices?.[0]?.message?.tool_calls
  if (Array.isArray(fromChoice)) buckets.push(...fromChoice)
  if (Array.isArray(root.message?.tool_calls))
    buckets.push(...(root.message!.tool_calls as unknown[]))
  if (Array.isArray(root.tool_calls)) buckets.push(...root.tool_calls)

  const out: OrToolCall[] = []
  for (const raw of buckets) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as {
      id?: string
      type?: string
      function?: { name?: string; arguments?: unknown }
      name?: string
      arguments?: unknown
    }
    const name = String(o.function?.name ?? o.name ?? '').trim()
    if (!name) continue
    out.push({
      id: String(o.id ?? '').trim() || `tool_${out.length + 1}`,
      name,
      arguments: parseJsonObject(o.function?.arguments ?? o.arguments),
    })
  }
  return out
}

export function textFromOpenAiChat(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: unknown } }>
    message?: { content?: unknown }
    text?: string
  }
  const content =
    d.choices?.[0]?.message?.content ?? d.message?.content ?? d.text
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
  return ''
}

export async function openrouterChat(opts: {
  apiKey: string
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const referer = env('OPENROUTER_HTTP_REFERER')
  const title = env('OPENROUTER_X_TITLE', 'Deprocast')
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature ?? 0.2,
    messages: opts.messages,
    // Evitar reasoning en el contenido visible (rompe JSON de extracts).
    reasoning: { exclude: true },
  }
  if (opts.tools?.length) body.tools = opts.tools
  if (opts.responseFormat) body.response_format = opts.responseFormat

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    const err = new Error(
      `OpenRouter chat falló (${res.status}): ${errText.slice(0, 400)}`,
    ) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const data = (await res.json()) as unknown
  return {
    text: textFromOpenAiChat(data).trim(),
    toolCalls: parseOpenAiToolCalls(data),
    raw: data,
  }
}
