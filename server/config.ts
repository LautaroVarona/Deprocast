/**
 * Validación central de entorno. Fallar al arranque si un valor está fuera de rango.
 */
export type EnvKind = 'required' | 'optional'

export type EnvSpec = {
  key: string
  kind: EnvKind
  default?: string
  description: string
  secret?: boolean
  min?: number
  max?: number
  integer?: boolean
}

export const ENV_SPECS: EnvSpec[] = [
  { key: 'PORT', kind: 'optional', default: '3001', description: 'Puerto HTTP local', min: 1, max: 65535, integer: true },
  { key: 'LOCAL_API_TOKEN', kind: 'optional', description: 'Token de capacidad local. Si falta, se genera en data/local-token.', secret: true },
  { key: 'DEEPGRAM_API_KEY', kind: 'optional', description: 'STT Deepgram', secret: true },
  { key: 'COHERE_API_KEY', kind: 'optional', description: 'LLM/embed Cohere', secret: true },
  { key: 'GEMINI_API_KEY', kind: 'optional', description: 'Gemini visión / OCR', secret: true },
  { key: 'VISION_REQUEST_DELAY_MS', kind: 'optional', default: '3000', description: 'Pausa entre hojas de visión (anti-429)', min: 0, max: 120_000, integer: true },
  { key: 'VISION_CONCURRENCY', kind: 'optional', default: '1', description: 'Hojas de visión en paralelo (1–2)', min: 1, max: 2, integer: true },
  { key: 'VISION_429_RETRIES', kind: 'optional', default: '4', description: 'Reintentos LLM ante 429 antes de OCR local', min: 0, max: 8, integer: true },
  { key: 'VISION_BACKOFF_BASE_MS', kind: 'optional', default: '2000', description: 'Base del backoff exponencial 429', min: 200, max: 60_000, integer: true },
  { key: 'OLLAMA_URL', kind: 'optional', default: 'http://localhost:11434', description: 'Fallback local Ollama' },
  { key: 'OLLAMA_MODEL', kind: 'optional', default: 'llama3', description: 'Modelo Ollama de fallback (debe estar en `ollama list`)' },
  { key: 'OPENROUTER_API_KEY', kind: 'optional', description: 'LLM OpenRouter', secret: true },
  { key: 'PERPLEXITY_API_KEY', kind: 'optional', description: 'Investigación Sonar. Sin key, /research/run responde 503.', secret: true },
  { key: 'BACKUP_PASSPHRASE', kind: 'optional', description: 'Frase para cifrar backups (Fase 3). Vacío = sin cifrado.', secret: true },
  { key: 'PIPELINE_STUCK_MS', kind: 'optional', default: '120000', description: 'Lease de pipeline atascado', min: 5000, max: 3_600_000, integer: true },
  { key: 'COHERE_REQUEST_DELAY_MS', kind: 'optional', default: '2000', description: 'Throttle entre llamadas LLM', min: 0, max: 60_000, integer: true },
  { key: 'AI_RPM_LIMIT', kind: 'optional', default: '30', description: 'Tope de peticiones IA por minuto', min: 1, max: 1000, integer: true },
]

function strip(raw: string | undefined): string {
  return (raw || '').replace(/^["']|["']$/g, '').trim()
}

export function readEnv(key: string, fallback = ''): string {
  const spec = ENV_SPECS.find((s) => s.key === key)
  const v = strip(process.env[key])
  if (v) return v
  return spec?.default ?? fallback
}

export function envNumber(key: string, fallback: number): number {
  const raw = readEnv(key, String(fallback))
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function envConfigured(key: string): boolean {
  return strip(process.env[key]).length > 0
}

export function validateEnv(): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  for (const spec of ENV_SPECS) {
    const raw = strip(process.env[spec.key])
    const value = raw || spec.default || ''
    if (spec.kind === 'required' && !value) {
      errors.push(`${spec.key} es obligatorio`)
      continue
    }
    if (!value) continue
    if (spec.min != null || spec.max != null || spec.integer) {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        errors.push(`${spec.key} debe ser numérico`)
        continue
      }
      if (spec.integer && !Number.isInteger(n)) {
        errors.push(`${spec.key} debe ser entero`)
      }
      if (spec.min != null && n < spec.min) {
        errors.push(`${spec.key} < ${spec.min}`)
      }
      if (spec.max != null && n > spec.max) {
        errors.push(`${spec.key} > ${spec.max}`)
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

export function capabilities(): Record<string, boolean> {
  return {
    gemini: envConfigured('GEMINI_API_KEY') || envConfigured('GOOGLE_API_KEY'),
    groq: envConfigured('GROQ_API_KEY'),
    cohere: envConfigured('COHERE_API_KEY'),
    openrouter: envConfigured('OPENROUTER_API_KEY'),
    deepgram: envConfigured('DEEPGRAM_API_KEY'),
    perplexity: envConfigured('PERPLEXITY_API_KEY'),
    backupEncryption: envConfigured('BACKUP_PASSPHRASE'),
  }
}
