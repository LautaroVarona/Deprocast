/**
 * Configuración de proveedores / modelos (SQLite app_settings).
 * Las API keys siguen en .env; aquí solo vive la elección activa.
 */
import { getDb } from '../db.js'

function env(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).replace(/^["']|["']$/g, '').trim()
}

export type LlmRole = 'main' | 'fast' | 'vision' | 'sentinel'

export type ProviderSlot =
  | 'llm_main'
  | 'llm_fast'
  | 'llm_vision'
  | 'llm_sentinel'
  | 'embed'
  | 'rerank'
  | 'stt'
  | 'research'

export type CatalogModel = { id: string; label: string }
export type CatalogProvider = {
  id: string
  label: string
  models: CatalogModel[]
}

export type SlotCatalog = {
  slot: ProviderSlot
  label: string
  providers: CatalogProvider[]
}

export const PROVIDER_CATALOG: SlotCatalog[] = [
  {
    slot: 'llm_main',
    label: 'Cerebro principal (RAG, diálogo, tools)',
    providers: [
      {
        id: 'groq',
        label: 'Groq',
        models: [
          {
            id: 'openai/gpt-oss-120b',
            label: 'GPT-OSS 120B (ENR / sucesor Llama 70B)',
          },
          {
            id: 'openai/gpt-oss-20b',
            label: 'GPT-OSS 20B (rápido / sucesor Llama 8B)',
          },
          {
            id: 'qwen/qwen3.6-27b',
            label: 'Qwen 3.6 27B',
          },
        ],
      },
      {
        id: 'openrouter',
        label: 'Stealth (OpenRouter)',
        models: [{ id: 'stealth/ox-alpha', label: 'Ox Alpha' }],
      },
      {
        id: 'cohere',
        label: 'Cohere (opcional)',
        models: [
          {
            id: 'command-r-plus-08-2024',
            label: 'Command R+ (08-2024)',
          },
        ],
      },
    ],
  },
  {
    slot: 'llm_fast',
    label: 'LLM rápido (ENR, extracts, alto volumen)',
    providers: [
      {
        id: 'groq',
        label: 'Groq (ENR forense)',
        models: [
          {
            id: 'openai/gpt-oss-120b',
            label: 'GPT-OSS 120B — ENR (default)',
          },
          {
            id: 'openai/gpt-oss-20b',
            label: 'GPT-OSS 20B — velocidad',
          },
          {
            id: 'qwen/qwen3.6-27b',
            label: 'Qwen 3.6 27B',
          },
        ],
      },
      {
        id: 'openrouter',
        label: 'Stealth (OpenRouter)',
        models: [{ id: 'stealth/ox-alpha', label: 'Ox Alpha' }],
      },
      {
        id: 'cohere',
        label: 'Cohere',
        models: [
          { id: 'command-r-08-2024', label: 'Command R (08-2024)' },
        ],
      },
    ],
  },
  {
    slot: 'llm_sentinel',
    label: 'Motor de Inferencia (inspección + misiones + tools)',
    providers: [
      {
        id: 'groq',
        label: 'Groq',
        models: [
          {
            id: 'openai/gpt-oss-20b',
            label: 'GPT-OSS 20B (recomendado · más TPM)',
          },
          {
            id: 'openai/gpt-oss-120b',
            label: 'GPT-OSS 120B (calidad · TPM 8k)',
          },
          {
            id: 'qwen/qwen3.6-27b',
            label: 'Qwen 3.6 27B',
          },
        ],
      },
      {
        id: 'ollama',
        label: 'Ollama (local)',
        models: [
          { id: 'llama3', label: 'Llama 3' },
          { id: 'llama3.1', label: 'Llama 3.1' },
          { id: 'qwen2.5', label: 'Qwen 2.5' },
        ],
      },
      {
        id: 'openrouter',
        label: 'Stealth (OpenRouter)',
        models: [{ id: 'stealth/ox-alpha', label: 'Ox Alpha' }],
      },
      {
        id: 'cohere',
        label: 'Cohere',
        models: [
          {
            id: 'command-r-plus-08-2024',
            label: 'Command R+ (08-2024)',
          },
        ],
      },
    ],
  },
  {
    slot: 'llm_vision',
    label: 'Visión / OCR multimodal',
    providers: [
      {
        id: 'gemini',
        label: 'Gemini (Google)',
        models: [
          { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (recomendado)' },
          { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
          { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        ],
      },
      {
        id: 'groq',
        label: 'Groq (visión)',
        models: [
          {
            id: 'qwen/qwen3.6-27b',
            label: 'Qwen 3.6 27B (visión, respaldo)',
          },
          {
            id: 'qwen/qwen3.8-27b',
            label: 'Qwen 3.8 27B (visión, respaldo)',
          },
        ],
      },
      {
        id: 'openrouter',
        label: 'OpenRouter',
        models: [
          {
            id: 'qwen/qwen2.5-vl-32b-instruct',
            label: 'Qwen2.5 VL 32B',
          },
          { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
          { id: 'stealth/ox-alpha', label: 'Ox Alpha' },
        ],
      },
      {
        id: 'cohere',
        label: 'Cohere',
        models: [
          {
            id: 'command-a-vision-07-2025',
            label: 'Command A Vision',
          },
        ],
      },
      {
        id: 'ollama',
        label: 'Ollama (local, llava / qwen2.5vl)',
        models: [
          { id: 'llava', label: 'LLaVA' },
          { id: 'llama3.2-vision', label: 'Llama 3.2 Vision' },
          { id: 'qwen2.5vl', label: 'Qwen 2.5 VL' },
        ],
      },
    ],
  },
  {
    slot: 'stt',
    label: 'Sonido / STT',
    providers: [
      {
        id: 'deepgram',
        label: 'Deepgram',
        models: [{ id: 'nova-3', label: 'Nova 3' }],
      },
    ],
  },
  {
    slot: 'embed',
    label: 'Embeddings (Mnemosyne)',
    providers: [
      {
        id: 'cohere',
        label: 'Cohere',
        models: [{ id: 'embed-v4.0', label: 'Embed v4.0' }],
      },
    ],
  },
  {
    slot: 'rerank',
    label: 'Rerank',
    providers: [
      {
        id: 'cohere',
        label: 'Cohere',
        models: [{ id: 'rerank-v3.5', label: 'Rerank v3.5' }],
      },
    ],
  },
  {
    slot: 'research',
    label: 'Research (Explorador IDA)',
    providers: [
      {
        id: 'perplexity',
        label: 'Perplexity',
        models: [{ id: 'sonar-pro', label: 'Sonar Pro' }],
      },
    ],
  },
]

const LLM_ROLE_TO_SLOT: Record<LlmRole, ProviderSlot> = {
  main: 'llm_main',
  fast: 'llm_fast',
  vision: 'llm_vision',
  sentinel: 'llm_sentinel',
}

export function getSetting(key: string, fallback = ''): string {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now)
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare(`SELECT key, value FROM app_settings`)
    .all() as Array<{ key: string; value: string }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

export function hasProviderKey(providerId: string): boolean {
  switch (providerId) {
    case 'gemini':
      return Boolean(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY') || env('GOOGLE_GENERATIVE_AI_API_KEY'))
    case 'openrouter':
      return Boolean(env('OPENROUTER_API_KEY'))
    case 'groq':
      return Boolean(env('GROQ_API_KEY'))
    case 'cohere':
      return Boolean(env('COHERE_API_KEY'))
    case 'deepgram':
      return Boolean(env('DEEPGRAM_API_KEY'))
    case 'perplexity':
      return Boolean(env('PERPLEXITY_API_KEY'))
    case 'ollama':
      return true
    default:
      return false
  }
}

export function keysPresent(): Record<string, boolean> {
  return {
    gemini: hasProviderKey('gemini'),
    openrouter: hasProviderKey('openrouter'),
    groq: hasProviderKey('groq'),
    ollama: true,
    cohere: hasProviderKey('cohere'),
    deepgram: hasProviderKey('deepgram'),
    perplexity: hasProviderKey('perplexity'),
  }
}

function geminiApiKeyFromEnv(): string {
  return (
    env('GEMINI_API_KEY') ||
    env('GOOGLE_API_KEY') ||
    env('GOOGLE_GENERATIVE_AI_API_KEY')
  )
}

function defaultModelFor(provider: string, slot: ProviderSlot): string {
  const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)
  const prov = entry?.providers.find((p) => p.id === provider)
  if (prov?.models[0]?.id) return prov.models[0].id
  if (provider === 'openrouter') {
    return env('OPENROUTER_MODEL', 'stealth/ox-alpha')
  }
  if (provider === 'groq') {
    if (slot === 'llm_vision') {
      return env('GROQ_VISION_MODEL', 'qwen/qwen3.6-27b')
    }
    if (slot === 'llm_fast') {
      return env('GROQ_MODEL_FAST', env('GROQ_MODEL', 'openai/gpt-oss-120b'))
    }
    return env('GROQ_MODEL', 'openai/gpt-oss-120b')
  }
  if (provider === 'openrouter' && slot === 'llm_vision') {
    return env('OPENROUTER_VISION_MODEL', 'qwen/qwen2.5-vl-32b-instruct')
  }
  if (provider === 'ollama') {
    if (slot === 'llm_vision') {
      return env('OLLAMA_VISION_MODEL', 'llava')
    }
    return env('OLLAMA_MODEL', 'llama3')
  }
  if (slot === 'llm_main') return env('COHERE_MODEL', 'command-r-plus-08-2024')
  if (slot === 'llm_fast') return env('COHERE_MODEL_FAST', 'command-r-08-2024')
  if (slot === 'llm_vision')
    return env('COHERE_VISION_MODEL', 'command-a-vision-07-2025')
  if (slot === 'embed') return env('COHERE_EMBED_MODEL', 'embed-v4.0')
  if (slot === 'rerank') return env('COHERE_RERANK_MODEL', 'rerank-v3.5')
  if (slot === 'stt') return env('DEEPGRAM_MODEL', 'nova-3')
  if (slot === 'research') return env('PERPLEXITY_MODEL', 'sonar-pro')
  return ''
}

export function resolveSlot(slot: ProviderSlot): {
  provider: string
  model: string
} {
  const provider = getSetting(`provider.${slot}`, '')
  const model = getSetting(`model.${slot}`, '')
  const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)
  const allowed = entry?.providers.map((p) => p.id) ?? []
  const storedOk = Boolean(provider && allowed.includes(provider))
  const storedHasKey = storedOk && hasProviderKey(provider)
  const firstKeyed = entry?.providers.find((p) => {
    if (
      p.id === 'ollama' &&
      slot === 'llm_vision' &&
      !env('OLLAMA_VISION_MODEL')
    ) {
      return false
    }
    return hasProviderKey(p.id)
  })
  const safeProvider = storedHasKey
    ? provider
    : (firstKeyed?.id ??
      (storedOk ? provider : (entry?.providers[0]?.id ?? provider)))
  const prov = entry?.providers.find((p) => p.id === safeProvider)
  const modelOk = prov?.models.some((m) => m.id === model)
  return {
    provider: safeProvider,
    model: modelOk ? model : defaultModelFor(safeProvider, slot),
  }
}

function apiKeyForProvider(provider: string): string {
  if (provider === 'gemini') return geminiApiKeyFromEnv()
  if (provider === 'openrouter') return env('OPENROUTER_API_KEY')
  if (provider === 'groq') return env('GROQ_API_KEY')
  if (provider === 'ollama') return ''
  return env('COHERE_API_KEY')
}

export function listVisionRoutes(): Array<{
  provider: string
  model: string
  apiKey: string
}> {
  const slot: ProviderSlot = 'llm_vision'
  const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)
  const preferred = resolveLlmRoute('vision')
  const out: Array<{ provider: string; model: string; apiKey: string }> = []
  const seen = new Set<string>()
  const push = (provider: string, model: string, apiKey: string) => {
    if (provider !== 'ollama' && !apiKey) return
    const key = `${provider}:${model}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ provider, model, apiKey })
  }
  push(preferred.provider, preferred.model, preferred.apiKey)
  const gemini = entry?.providers.find((p) => p.id === 'gemini')
  if (gemini && hasProviderKey('gemini')) {
    for (const m of gemini.models) {
      push('gemini', m.id, apiKeyForProvider('gemini'))
    }
  }
  const groq = entry?.providers.find((p) => p.id === 'groq')
  if (groq && hasProviderKey('groq')) {
    for (const m of groq.models) {
      push('groq', m.id, apiKeyForProvider('groq'))
    }
  }
  for (const p of entry?.providers ?? []) {
    if (p.id === 'ollama' && preferred.provider !== 'ollama') continue
    push(p.id, defaultModelFor(p.id, slot), apiKeyForProvider(p.id))
  }
  return out
}

export function resolveLlmRoute(role: LlmRole): {
  provider: string
  model: string
  apiKey: string
} {
  const slot = LLM_ROLE_TO_SLOT[role]
  const { provider, model } = resolveSlot(slot)
  if (provider === 'gemini') {
    const requested = model || env('GEMINI_VISION_MODEL', 'gemini-3.6-flash')
    const fromEnv = env('GEMINI_VISION_MODEL', 'gemini-3.6-flash')
    const safe = /^gemini-3\./.test(requested)
      ? requested
      : /^gemini-3\./.test(fromEnv)
        ? fromEnv
        : 'gemini-3.6-flash'
    return {
      provider: 'gemini',
      model: safe,
      apiKey: geminiApiKeyFromEnv(),
    }
  }
  if (provider === 'openrouter') {
    const apiKey = env('OPENROUTER_API_KEY')
    const fallback =
      role === 'vision'
        ? env('OPENROUTER_VISION_MODEL', 'qwen/qwen2.5-vl-32b-instruct')
        : env('OPENROUTER_MODEL', 'stealth/ox-alpha')
    return {
      provider,
      model: model || fallback,
      apiKey,
    }
  }
  if (provider === 'groq') {
    const fallback =
      role === 'vision'
        ? env('GROQ_VISION_MODEL', 'qwen/qwen3.6-27b')
        : role === 'fast'
          ? env('GROQ_MODEL_FAST', env('GROQ_MODEL', 'openai/gpt-oss-120b'))
          : env('GROQ_MODEL', 'openai/gpt-oss-120b')
    return {
      provider: 'groq',
      model: model || fallback,
      apiKey: env('GROQ_API_KEY'),
    }
  }
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      model:
        model ||
        (role === 'vision'
          ? env('OLLAMA_VISION_MODEL', 'llava')
          : env('OLLAMA_MODEL', 'llama3')),
      apiKey: '',
    }
  }
  const apiKey = env('COHERE_API_KEY')
  let fallbackModel = env('COHERE_MODEL', 'command-r-plus-08-2024')
  if (role === 'fast')
    fallbackModel = env('COHERE_MODEL_FAST', 'command-r-08-2024')
  if (role === 'vision')
    fallbackModel = env('COHERE_VISION_MODEL', 'command-a-vision-07-2025')
  return { provider: 'cohere', model: model || fallbackModel, apiKey }
}

export function canCallLlm(role: LlmRole): boolean {
  const { provider, apiKey } = resolveLlmRoute(role)
  if (provider === 'ollama') return true
  return Boolean(apiKey) && hasProviderKey(provider)
}

export function getSentinelBrain(): {
  provider: string
  model: string
  label: string
} {
  const { provider, model } = resolveLlmRoute('sentinel')
  const entry = PROVIDER_CATALOG.find((c) => c.slot === 'llm_sentinel')
  const prov = entry?.providers.find((p) => p.id === provider)
  const modelLabel = prov?.models.find((m) => m.id === model)?.label ?? model
  return {
    provider,
    model,
    label: `${prov?.label ?? provider} · ${modelLabel}`,
  }
}

export type ProviderConfigSnapshot = {
  catalog: SlotCatalog[]
  provider: Record<ProviderSlot, string>
  model: Record<ProviderSlot, string>
  keysPresent: Record<string, boolean>
}

export function getProviderConfig(): ProviderConfigSnapshot {
  const provider = {} as Record<ProviderSlot, string>
  const model = {} as Record<ProviderSlot, string>
  for (const entry of PROVIDER_CATALOG) {
    const resolved = resolveSlot(entry.slot)
    provider[entry.slot] = resolved.provider
    model[entry.slot] = resolved.model
  }
  return {
    catalog: PROVIDER_CATALOG,
    provider,
    model,
    keysPresent: keysPresent(),
  }
}

export function updateProviderConfig(patch: {
  provider?: Partial<Record<ProviderSlot, string>>
  model?: Partial<Record<ProviderSlot, string>>
}): ProviderConfigSnapshot {
  const slots = new Set(PROVIDER_CATALOG.map((c) => c.slot))

  if (patch.provider) {
    for (const [slot, providerId] of Object.entries(patch.provider) as Array<
      [ProviderSlot, string]
    >) {
      if (!slots.has(slot)) {
        throw new Error(`Slot desconocido: ${slot}`)
      }
      const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)!
      const prov = entry.providers.find((p) => p.id === providerId)
      if (!prov) {
        throw new Error(`Proveedor ${providerId} no válido para ${slot}`)
      }
      setSetting(`provider.${slot}`, providerId)
      const currentModel = getSetting(`model.${slot}`, '')
      if (!prov.models.some((m) => m.id === currentModel)) {
        setSetting(`model.${slot}`, prov.models[0]!.id)
      }
    }
  }

  if (patch.model) {
    for (const [slot, modelId] of Object.entries(patch.model) as Array<
      [ProviderSlot, string]
    >) {
      if (!slots.has(slot)) {
        throw new Error(`Slot desconocido: ${slot}`)
      }
      const { provider } = resolveSlot(slot)
      const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)!
      const prov = entry.providers.find((p) => p.id === provider)
      if (!prov?.models.some((m) => m.id === modelId)) {
        throw new Error(`Modelo ${modelId} no válido para ${slot}/${provider}`)
      }
      setSetting(`model.${slot}`, modelId)
    }
  }

  return getProviderConfig()
}
