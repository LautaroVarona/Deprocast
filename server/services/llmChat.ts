/**
 * Router LLM: Groq | Ollama | Cohere | OpenRouter según app_settings.
 * Groq/Ollama pasan por la cola serial (anti-429). Sentinela cae a Ollama.
 */
import {
  canCallLlm,
  listVisionRoutes,
  resolveLlmRoute,
  type LlmRole,
} from './appSettings.js'
import {
  cohereAssistantMessage,
  cohereChat,
  type CohereChatMessage,
  type CohereToolCall,
  type CohereToolSpec,
} from './providers/cohereChat.js'
import { geminiChat } from './providers/geminiChat.js'
import { groqChat } from './providers/groqChat.js'
import {
  ollamaChat,
  resolveOllamaModel,
} from './providers/ollamaChat.js'
import {
  openrouterChat,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './providers/openrouter.js'
import { enqueueLlm } from './queue.js'

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type LlmMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | LlmContentPart[]
    }
  | { role: 'assistant'; content?: string; tool_calls?: unknown }
  | { role: 'tool'; tool_call_id: string; content: string }

export function isPayloadTooLargeError(err: unknown): boolean {
  const status = (err as { status?: number }).status
  const msg = err instanceof Error ? err.message : String(err)
  return (
    status === 413 ||
    /request too large/i.test(msg) ||
    /tokens per minute \(TPM\)/i.test(msg) ||
    /requested \d+/i.test(msg)
  )
}

function isRetryableCloudError(err: unknown): boolean {
  if (isPayloadTooLargeError(err)) return false
  const status = (err as { status?: number }).status
  const msg = err instanceof Error ? err.message : String(err)
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    /429/.test(msg) ||
    /too many requests/i.test(msg)
  )
}

function messageText(content: LlmMessage['content'] | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
  }
  return ''
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[cortado ${text.length - max} chars]`
}

function clipMessages(messages: LlmMessage[], maxChars: number): LlmMessage[] {
  let budget = maxChars
  return messages.map((m) => {
    const text = messageText(m.content)
    if (!text) return m
    const cap =
      m.role === 'system' ? Math.min(3_200, budget) : Math.min(1_800, budget)
    if (text.length <= cap) {
      budget = Math.max(0, budget - text.length)
      return m
    }
    budget = Math.max(0, budget - cap)
    return { ...m, content: clipText(text, Math.max(280, cap)) }
  })
}

const GROQ_RETRY_CHARS = 6_000
const GROQ_COMPACT_MODEL = 'openai/gpt-oss-20b'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type LlmToolSpec = CohereToolSpec
export type LlmToolCall = CohereToolCall | OrToolCall

export { canCallLlm }

type LlmRoute = {
  provider: string
  model: string
  apiKey: string
}

export async function llmChat(opts: {
  role: LlmRole
  messages: LlmMessage[]
  temperature?: number
  tools?: LlmToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{
  text: string
  toolCalls: LlmToolCall[]
  raw: unknown
  rawAssistant: unknown
  provider: string
  model: string
}> {
  const route = resolveLlmRoute(opts.role)
  const run = async (): Promise<{
    text: string
    toolCalls: LlmToolCall[]
    raw: unknown
    rawAssistant: unknown
    provider: string
    model: string
  }> => {
    if (opts.role === 'vision') {
      const routes = listVisionRoutes()
      const chain = routes.length > 0 ? routes : [route]
      let lastErr: unknown
      let geminiQuota = false
      for (const candidate of chain) {
        if (geminiQuota && candidate.provider === 'gemini') continue
        try {
          const result = await dispatchLlm(candidate, opts)
          if (candidate.provider !== route.provider) {
            console.warn(
              `[llm] visión ${route.provider} → ${candidate.provider} (${candidate.model})`,
            )
          }
          return result
        } catch (err) {
          lastErr = err
          const status = (err as Error & { status?: number }).status
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(
            `[llm] visión ${candidate.provider}/${candidate.model} falló: ${msg.slice(0, 180)}`,
          )
          if (candidate.provider === 'gemini' && status === 429) {
            geminiQuota = true
          }
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error('Ningún proveedor de visión respondió')
    }
    try {
      return await dispatchLlm(route, opts)
    } catch (err) {
      if (opts.role !== 'sentinel' || route.provider === 'ollama') throw err

      let lastErr = err
      let payload = opts

      if (isPayloadTooLargeError(err)) {
        payload = {
          ...opts,
          messages: clipMessages(opts.messages, GROQ_RETRY_CHARS),
        }
        console.warn(
          `[llm] sentinela ${route.provider} 413 payload → recorte y reintento`,
        )
        try {
          return await dispatchLlm(route, payload)
        } catch (retryErr) {
          lastErr = retryErr
        }
        if (
          isPayloadTooLargeError(lastErr) &&
          route.provider === 'groq' &&
          route.model !== GROQ_COMPACT_MODEL
        ) {
          console.warn(
            `[llm] sentinela Groq 413 TPM → ${GROQ_COMPACT_MODEL} (más headroom)`,
          )
          try {
            return await dispatchLlm(
              { ...route, model: GROQ_COMPACT_MODEL },
              payload,
            )
          } catch (compactErr) {
            lastErr = compactErr
          }
        }
      }

      const retryable =
        isRetryableCloudError(lastErr) || isPayloadTooLargeError(lastErr)
      if (!retryable) throw lastErr

      const ollamaModel = await resolveOllamaModel()
      if (!ollamaModel) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
        console.warn(
          `[llm] sentinela: Ollama sin modelo instalado; no hay fallback (${msg.slice(0, 160)})`,
        )
        throw lastErr
      }

      const kind = isPayloadTooLargeError(lastErr)
        ? '413'
        : isRetryableCloudError(lastErr)
          ? '429/5xx'
          : 'caída'
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      console.warn(
        `[llm] sentinela ${route.provider} ${kind}: ${msg.slice(0, 200)} → Ollama (${ollamaModel})`,
      )
      return dispatchLlm(
        {
          provider: 'ollama',
          model: ollamaModel,
          apiKey: '',
        },
        payload,
      )
    }
  }

  if (
    opts.role === 'vision' ||
    route.provider === 'groq' ||
    route.provider === 'ollama'
  ) {
    return enqueueLlm(run)
  }

  const delayMs = Number(env('COHERE_REQUEST_DELAY_MS', '2000')) || 0
  if (delayMs > 0) await delay(delayMs)
  return run()
}

async function dispatchLlm(
  route: LlmRoute,
  opts: {
    messages: LlmMessage[]
    temperature?: number
    tools?: LlmToolSpec[]
    responseFormat?: { type: 'json_object' }
  },
): Promise<{
  text: string
  toolCalls: LlmToolCall[]
  raw: unknown
  rawAssistant: unknown
  provider: string
  model: string
}> {
  if (route.provider !== 'ollama' && !route.apiKey) {
    const keyName =
      route.provider === 'openrouter'
        ? 'OPENROUTER_API_KEY'
        : route.provider === 'groq'
          ? 'GROQ_API_KEY'
          : route.provider === 'gemini'
            ? 'GEMINI_API_KEY'
            : 'COHERE_API_KEY'
    throw new Error(`Falta ${keyName} en .env (proveedor ${route.provider})`)
  }

  if (route.provider === 'ollama') {
    const result = await ollamaChat({
      model: route.model,
      messages: opts.messages as OrMessage[],
      temperature: opts.temperature,
      tools: opts.tools as OrToolSpec[] | undefined,
    })
    const rawAssistant =
      (result.raw as { message?: unknown })?.message ?? result.raw
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
      rawAssistant,
      provider: 'ollama',
      model: route.model,
    }
  }

  if (route.provider === 'gemini') {
    const result = await geminiChat({
      apiKey: route.apiKey,
      model: route.model,
      messages: opts.messages as OrMessage[],
      temperature: opts.temperature,
      tools: opts.tools as OrToolSpec[] | undefined,
      responseFormat: opts.responseFormat ?? { type: 'json_object' },
    })
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
      rawAssistant: result.raw,
      provider: 'gemini',
      model: route.model,
    }
  }

  if (route.provider === 'groq') {
    const result = await groqChat({
      apiKey: route.apiKey,
      model: route.model,
      messages: opts.messages as OrMessage[],
      temperature: opts.temperature,
      tools: opts.tools as OrToolSpec[] | undefined,
      responseFormat: opts.responseFormat,
    })
    const rawAssistant =
      (result.raw as { choices?: Array<{ message?: unknown }> })?.choices?.[0]
        ?.message ?? result.raw
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
      rawAssistant,
      provider: route.provider,
      model: route.model,
    }
  }

  if (route.provider === 'openrouter') {
    const result = await openrouterChat({
      apiKey: route.apiKey,
      model: route.model,
      messages: opts.messages as OrMessage[],
      temperature: opts.temperature,
      tools: opts.tools as OrToolSpec[] | undefined,
      responseFormat: opts.responseFormat,
    })
    const rawAssistant =
      (result.raw as { choices?: Array<{ message?: unknown }> })?.choices?.[0]
        ?.message ?? result.raw
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      raw: result.raw,
      rawAssistant,
      provider: route.provider,
      model: route.model,
    }
  }

  const result = await cohereChat({
    apiKey: route.apiKey,
    model: route.model,
    messages: opts.messages as CohereChatMessage[],
    temperature: opts.temperature,
    tools: opts.tools,
    responseFormat: opts.responseFormat,
  })
  return {
    text: result.text,
    toolCalls: result.toolCalls,
    raw: result.raw,
    rawAssistant: cohereAssistantMessage(result.raw),
    provider: 'cohere',
    model: route.model,
  }
}
