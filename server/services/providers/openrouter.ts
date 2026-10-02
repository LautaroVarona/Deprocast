/**
 * OpenRouter chat (OpenAI-compatible). Usado para Stealth / ox-alpha.
 * El host queda fijo: NaN tiene su propio proveedor y no pasa por acá.
 */
import {
  openaiCompatChat,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './openaiCompat.js'

export type {
  OrContentPart,
  OrMessage,
  OrToolCall,
  OrToolSpec,
} from './openaiCompat.js'
export { parseOpenAiToolCalls, textFromOpenAiChat } from './openaiCompat.js'

export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions'

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

export async function openrouterChat(opts: {
  apiKey: string
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  const headers: Record<string, string> = {}
  const referer = env('OPENROUTER_HTTP_REFERER')
  const title = env('OPENROUTER_X_TITLE', 'Deprocast')
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title

  return openaiCompatChat({
    url: OPENROUTER_CHAT_COMPLETIONS_URL,
    apiKey: opts.apiKey,
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    tools: opts.tools,
    responseFormat: opts.responseFormat,
    headers,
    // Evitar reasoning en el contenido visible (rompe JSON de extracts).
    extraBody: { reasoning: { exclude: true } },
    errorLabel: 'OpenRouter',
  })
}
