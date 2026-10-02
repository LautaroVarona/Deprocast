/**
 * NaN (nan.builders) chat — API OpenAI-compatible.
 * Auth: Bearer NAN_API_KEY. Base: NAN_BASE_URL o https://api.nan.builders/v1.
 */
import {
  openaiCompatChat,
  type OrMessage,
  type OrToolCall,
  type OrToolSpec,
} from './openaiCompat.js'

export const NAN_DEFAULT_BASE_URL = 'https://api.nan.builders/v1'

function stripEnv(raw: string | undefined): string {
  return (raw ?? '').replace(/^["']|["']$/g, '').trim()
}

export function nanBaseUrl(): string {
  const raw = stripEnv(process.env.NAN_BASE_URL).replace(/\/+$/, '')
  return raw || NAN_DEFAULT_BASE_URL
}

export function nanChatCompletionsUrl(): string {
  return `${nanBaseUrl()}/chat/completions`
}

export async function nanChat(opts: {
  apiKey: string
  model: string
  messages: OrMessage[]
  temperature?: number
  tools?: OrToolSpec[]
  responseFormat?: { type: 'json_object' }
}): Promise<{ text: string; toolCalls: OrToolCall[]; raw: unknown }> {
  return openaiCompatChat({
    url: nanChatCompletionsUrl(),
    apiKey: opts.apiKey,
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    tools: opts.tools,
    responseFormat: opts.responseFormat,
    errorLabel: 'NaN',
  })
}
