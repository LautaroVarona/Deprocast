/**
 * Groq chat (OpenAI-compatible via groq-sdk).
 */
import Groq from 'groq-sdk'
import {
  parseOpenAiToolCalls,
  textFromOpenAiChat,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './openrouter.js'

const MODEL_ALIASES: Record<string, string> = {
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'qwen/qwen3.6-27b',
  'meta-llama/llama-4-maverick-17b-128e-instruct': 'qwen/qwen3.6-27b',
}

export function resolveGroqChatModel(raw: string): string {
  const id = raw.trim()
  return MODEL_ALIASES[id] ?? id
}

function withNoThink(messages: OrMessage[]): OrMessage[] {
  return messages.map((m, i) => {
    if (i !== 0 && m.role !== 'user') return m
    if (m.role !== 'user') return m
    const prefix = '/no_think\n'
    if (typeof m.content === 'string') {
      if (m.content.startsWith('/no_think')) return m
      return { ...m, content: prefix + m.content }
    }
    if (!Array.isArray(m.content)) return m
    const parts = m.content.map((p, idx) => {
      if (idx === 0 && p && typeof p === 'object' && 'text' in p) {
        const t = String((p as { text?: string }).text ?? '')
        if (t.startsWith('/no_think')) return p
        return { ...p, text: prefix + t }
      }
      return p
    })
    return { ...m, content: parts }
  })
}

export async function groqChat(opts: {
  apiKey: string
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  const client = new Groq({ apiKey: opts.apiKey })
  const model = resolveGroqChatModel(opts.model)
  const qwenThink = /qwen/i.test(model)
  const messages = qwenThink
    ? withNoThink(opts.messages)
    : opts.messages
  const payload = {
    model,
    temperature: opts.temperature ?? 0.2,
    max_completion_tokens: 8192,
    messages: messages as Groq.Chat.ChatCompletionMessageParam[],
    ...(opts.tools?.length
      ? { tools: opts.tools as Groq.Chat.ChatCompletionTool[] }
      : {}),
    ...(opts.responseFormat && !qwenThink
      ? { response_format: opts.responseFormat }
      : {}),
  }
  try {
    const completion = await client.chat.completions.create({
      ...payload,
      ...(qwenThink ? { reasoning_effort: 'none' as const } : {}),
    } as Parameters<typeof client.chat.completions.create>[0])
    const raw = completion as unknown
    return {
      text: textFromOpenAiChat(raw),
      toolCalls: parseOpenAiToolCalls(raw),
      raw,
    }
  } catch (err) {
    const status = (err as { status?: number }).status
    const msg = err instanceof Error ? err.message : String(err)
    if (qwenThink && status === 400 && /reasoning_effort/i.test(msg)) {
      try {
        const completion = await client.chat.completions.create(
          payload as Parameters<typeof client.chat.completions.create>[0],
        )
        const raw = completion as unknown
        return {
          text: textFromOpenAiChat(raw),
          toolCalls: parseOpenAiToolCalls(raw),
          raw,
        }
      } catch (err2) {
        const status2 = (err2 as { status?: number }).status
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        const wrapped = new Error(
          `Groq chat falló${status2 ? ` (${status2})` : ''}: ${msg2.slice(0, 400)}`,
        ) as Error & { status?: number }
        wrapped.status = status2
        throw wrapped
      }
    }
    const wrapped = new Error(
      `Groq chat falló${status ? ` (${status})` : ''}: ${msg.slice(0, 400)}`,
    ) as Error & { status?: number }
    wrapped.status = status
    throw wrapped
  }
}
