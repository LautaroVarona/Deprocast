import { afterEach, describe, expect, it } from 'vitest'
import {
  hasProviderKey,
  keysPresent,
  PROVIDER_CATALOG,
} from '../server/services/appSettings.ts'
import {
  nanChat,
  nanChatCompletionsUrl,
  NAN_DEFAULT_BASE_URL,
} from '../server/services/providers/nanChat.ts'
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  openrouterChat,
} from '../server/services/providers/openrouter.ts'

const MEMBER_IDS = [
  'gemma4',
  'qwen3.6',
  'deepseek-v4-flash',
  'glm5.3-flash',
  'mimo-v2.6-flash',
  'qwen3.8-flash',
]

function slot(id: string) {
  const entry = PROVIDER_CATALOG.find((c) => c.slot === id)
  if (!entry) throw new Error(`slot ${id}`)
  return entry
}

function providerIds(id: string): string[] {
  return slot(id).providers.map((p) => p.id)
}

describe('catálogo NaN', () => {
  it('mantiene Groq, OpenRouter y Cohere y suma nan en los slots LLM', () => {
    for (const id of ['llm_main', 'llm_fast', 'llm_sentinel', 'llm_vision']) {
      const ids = providerIds(id)
      expect(ids).toContain('groq')
      expect(ids).toContain('openrouter')
      expect(ids).toContain('cohere')
      expect(ids).toContain('nan')
    }
    expect(providerIds('embed')).toEqual(['cohere'])
    expect(providerIds('stt')).toEqual(['deepgram'])
  })

  it('no lista glm5.3 premium y sí el flash del tier member', () => {
    const ids = PROVIDER_CATALOG.flatMap((entry) =>
      entry.providers.flatMap((p) => p.models.map((m) => m.id)),
    )
    expect(ids).not.toContain('glm5.3')
    expect(ids).toContain('glm5.3-flash')
  })

  it('prioriza deepseek en cerebro, gemma4 en rápido y glm flash en sentinela', () => {
    const nan = (id: string) => slot(id).providers.find((p) => p.id === 'nan')!
    expect(nan('llm_main').models.map((m) => m.id)).toEqual([
      'deepseek-v4-flash',
      ...MEMBER_IDS.filter((m) => m !== 'deepseek-v4-flash'),
    ])
    expect(nan('llm_fast').models[0]?.id).toBe('gemma4')
    expect(nan('llm_fast').models.map((m) => m.id).sort()).toEqual(
      [...MEMBER_IDS].sort(),
    )
    expect(nan('llm_sentinel').models[0]?.id).toBe('glm5.3-flash')
    expect(nan('llm_vision').models.map((m) => m.id)).toEqual([
      'deepseek-v4-flash',
    ])
  })

  it('deja a nan después de Groq y OpenRouter para el fallback por key', () => {
    for (const id of ['llm_main', 'llm_fast'] as const) {
      const ids = providerIds(id)
      expect(ids.indexOf('groq')).toBeLessThan(ids.indexOf('openrouter'))
      expect(ids.indexOf('openrouter')).toBeLessThan(ids.indexOf('nan'))
      expect(ids.indexOf('nan')).toBeLessThan(ids.indexOf('cohere'))
    }
    const sentinel = providerIds('llm_sentinel')
    expect(sentinel.indexOf('ollama')).toBeLessThan(sentinel.indexOf('nan'))
  })

  it('hasProviderKey(nan) sigue NAN_API_KEY y no pisa OpenRouter', () => {
    const prevNan = process.env.NAN_API_KEY
    const prevOr = process.env.OPENROUTER_API_KEY
    try {
      delete process.env.NAN_API_KEY
      delete process.env.OPENROUTER_API_KEY
      expect(hasProviderKey('nan')).toBe(false)
      expect(hasProviderKey('openrouter')).toBe(false)
      process.env.NAN_API_KEY = 'sk-test'
      expect(hasProviderKey('nan')).toBe(true)
      expect(hasProviderKey('openrouter')).toBe(false)
      expect(keysPresent().nan).toBe(true)
      expect(keysPresent().openrouter).toBe(false)
    } finally {
      if (prevNan === undefined) delete process.env.NAN_API_KEY
      else process.env.NAN_API_KEY = prevNan
      if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prevOr
    }
  })
})

describe('chat OpenAI-compatible', () => {
  const originalFetch = globalThis.fetch
  const prevBase = process.env.NAN_BASE_URL

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (prevBase === undefined) delete process.env.NAN_BASE_URL
    else process.env.NAN_BASE_URL = prevBase
  })

  it('usa la base de NaN por defecto y respeta NAN_BASE_URL', () => {
    delete process.env.NAN_BASE_URL
    expect(NAN_DEFAULT_BASE_URL).toBe('https://api.nan.builders/v1')
    expect(nanChatCompletionsUrl()).toBe(
      'https://api.nan.builders/v1/chat/completions',
    )
    process.env.NAN_BASE_URL = '"https://example.test/v1/"'
    expect(nanChatCompletionsUrl()).toBe(
      'https://example.test/v1/chat/completions',
    )
  })

  it('NaN pega a su host con Bearer y sin el reasoning de OpenRouter', async () => {
    delete process.env.NAN_BASE_URL
    let seenUrl = ''
    let auth = ''
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      const headers = new Headers(init?.headers)
      auth = headers.get('authorization') ?? ''
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '  nan-ok  ' } }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await nanChat({
      apiKey: 'sk-nan',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hola' }],
    })
    expect(seenUrl).toBe('https://api.nan.builders/v1/chat/completions')
    expect(seenUrl).not.toContain('openrouter.ai')
    expect(auth).toBe('Bearer sk-nan')
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.reasoning).toBeUndefined()
    expect(res.text).toBe('nan-ok')
  })

  it('OpenRouter sigue en openrouter.ai con reasoning exclude', async () => {
    let seenUrl = ''
    let body: Record<string, unknown> = {}
    let title = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      const headers = new Headers(init?.headers)
      title = headers.get('x-title') ?? ''
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'or-ok' } }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await openrouterChat({
      apiKey: 'sk-or',
      model: 'stealth/ox-alpha',
      messages: [{ role: 'user', content: 'hola' }],
    })
    expect(OPENROUTER_CHAT_COMPLETIONS_URL).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    )
    expect(seenUrl).toBe(OPENROUTER_CHAT_COMPLETIONS_URL)
    expect(body.reasoning).toEqual({ exclude: true })
    expect(body.model).toBe('stealth/ox-alpha')
    expect(title).toBe('Deprocast')
    expect(res.text).toBe('or-ok')
  })
})
