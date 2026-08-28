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
}

export function resolveGroqChatModel(raw: string): string {
  const id = raw.trim()
  return MODEL_ALIASES[id] ?? id
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
  try {
    const completion = await client.chat.completions.create({
      model: resolveGroqChatModel(opts.model),
      temperature: opts.temperature ?? 0.2,
      messages: opts.messages as Groq.Chat.ChatCompletionMessageParam[],
      ...(opts.tools?.length
        ? { tools: opts.tools as Groq.Chat.ChatCompletionTool[] }
        : {}),
      ...(opts.responseFormat
        ? { response_format: opts.responseFormat }
        : {}),
    })
    const raw = completion as unknown
    return {
      text: textFromOpenAiChat(raw),
      toolCalls: parseOpenAiToolCalls(raw),
      raw,
    }
  } catch (err) {
    const status = (err as { status?: number }).status
    const msg = err instanceof Error ? err.message : String(err)
    const wrapped = new Error(
      `Groq chat falló${status ? ` (${status})` : ''}: ${msg.slice(0, 400)}`,
    ) as Error & { status?: number }
    wrapped.status = status
    throw wrapped
  }
}
