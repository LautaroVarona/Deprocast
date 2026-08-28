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
        id: 'openrouter',
        label: 'Stealth (OpenRouter)',
        models: [{ id: 'stealth/ox-alpha', label: 'Ox Alpha' }],
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
    openrouter: hasProviderKey('openrouter'),
    groq: hasProviderKey('groq'),
    ollama: true,
    cohere: hasProviderKey('cohere'),
    deepgram: hasProviderKey('deepgram'),
    perplexity: hasProviderKey('perplexity'),
  }
}

function defaultModelFor(provider: string, slot: ProviderSlot): string {
  const entry = PROVIDER_CATALOG.find((c) => c.slot === slot)
  const prov = entry?.providers.find((p) => p.id === provider)
  if (prov?.models[0]?.id) return prov.models[0].id
  if (provider === 'openrouter') {
    return env('OPENROUTER_MODEL', 'stealth/ox-alpha')
  }
  if (provider === 'groq') {
    if (slot === 'llm_fast') {
      return env('GROQ_MODEL_FAST', env('GROQ_MODEL', 'openai/gpt-oss-120b'))
    }
    return env('GROQ_MODEL', 'openai/gpt-oss-120b')
  }
  if (provider === 'ollama') {
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
  const safeProvider =
    provider && allowed.includes(provider)
      ? provider
      : (entry?.providers[0]?.id ?? provider)
  const prov = entry?.providers.find((p) => p.id === safeProvider)
  const modelOk = prov?.models.some((m) => m.id === model)
  return {
    provider: safeProvider,
    model: modelOk ? model : defaultModelFor(safeProvider, slot),
  }
}

export function resolveLlmRoute(role: LlmRole): {
  provider: string
  model: string
  apiKey: string
} {
  const slot = LLM_ROLE_TO_SLOT[role]
  const { provider, model } = resolveSlot(slot)
  if (provider === 'openrouter') {
    const apiKey = env('OPENROUTER_API_KEY')
    return {
      provider,
      model: model || env('OPENROUTER_MODEL', 'stealth/ox-alpha'),
      apiKey,
    }
  }
  if (provider === 'groq') {
    const fallback =
      role === 'fast'
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
      model: model || env('OLLAMA_MODEL', 'llama3'),
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
