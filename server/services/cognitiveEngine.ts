/**
 * Motor cognitivo híbrido: Groq (nube) → Ollama local si 429 / caída.
 */
import { AppError } from '../errors.js'
import { enqueueLlm } from './queue.js'
import {
  buildSystemPrompt,
  buildUserPrompt,
  emptyGroqExtraction,
  getGroqClient,
  hasGroqKey,
  normalizeExtraction,
  parseJsonObject,
  resolveGroqModel,
  type ExtractDeprocastOpts,
  type GroqExtraction,
} from './groqExtractor.js'

export type CognitiveEntityTipo =
  | 'Persona'
  | 'Proyecto'
  | 'Agrupacion'
  | 'Artefacto'
  | 'Ubicacion'
  | 'Hito'

export interface CognitiveEntity {
  nombre: string
  tipo: CognitiveEntityTipo
  canonico?: string
  variante?: 'canonico' | 'apodo' | 'typo'
  alias_de?: string
}

export interface CognitiveExtraction {
  quantomos: string[]
  acciones: string[]
  entidades: CognitiveEntity[]
}

export type CognitiveProvider = 'groq' | 'ollama'

export interface CognitiveResult {
  extraction: CognitiveExtraction
  provider: CognitiveProvider
}

export type GroqCompleter = (input: {
  model: string
  system: string
  user: string
}) => Promise<string>

export type OllamaCompleter = (input: {
  url: string
  model: string
  system: string
  user: string
}) => Promise<string>

export type CognitiveEngineOptions = {
  groqComplete?: GroqCompleter
  ollamaComplete?: OllamaCompleter
  groqModel?: string
  ollamaUrl?: string
  ollamaModel?: string
  /** Tests: no pasar por la cola global. */
  skipQueue?: boolean
}

const FORENSIC_LEAD =
  'Eres un analizador forense de transcripciones. Lee el texto y extrae la información en un JSON estricto sin texto adicional.'

function env(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).replace(/^["']|["']$/g, '').trim()
}

export function ollamaUrl(): string {
  return env('OLLAMA_URL', 'http://localhost:11434').replace(/\/+$/, '')
}

export function ollamaModel(): string {
  return env('OLLAMA_MODEL', 'llama3')
}

export function isGroqRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number }).status
  const msg = err instanceof Error ? err.message : String(err)
  return (
    status === 429 ||
    /429/.test(msg) ||
    /too many requests/i.test(msg) ||
    /rate.?limit/i.test(msg)
  )
}

function groqErrorStatus(err: unknown): number {
  const status = Number((err as { status?: number }).status)
  return Number.isFinite(status) && status > 0 ? status : 502
}

const defaultGroqComplete: GroqCompleter = async ({ model, system, user }) => {
  const client = getGroqClient()
  if (!client) {
    throw new AppError(
      'Falta GROQ_API_KEY en .env',
      503,
      'GROQ_KEY_MISSING',
    )
  }
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return completion.choices[0]?.message?.content ?? ''
}

const defaultOllamaComplete: OllamaCompleter = async ({
  url,
  model,
  system,
  user,
}) => {
  const endpoint = `${url}/api/generate`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60_000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        system,
        prompt: user,
        stream: false,
        format: 'json',
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new AppError(
        `Ollama falló (${res.status}): ${text.slice(0, 240)}`,
        res.status >= 400 && res.status < 600 ? res.status : 502,
        'OLLAMA_ERROR',
      )
    }
    const data = (await res.json()) as { response?: unknown }
    return typeof data.response === 'string' ? data.response : JSON.stringify(data)
  } catch (err) {
    if (err instanceof AppError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new AppError(
      `Ollama no disponible en ${endpoint}: ${msg.slice(0, 200)}`,
      503,
      'OLLAMA_UNAVAILABLE',
    )
  } finally {
    clearTimeout(timer)
  }
}

function decodeExtraction(
  raw: string,
  opts: ExtractDeprocastOpts,
): CognitiveExtraction {
  const parsed = parseJsonObject(raw)
  if (!parsed) {
    throw new AppError(
      'El modelo no devolvió JSON estricto',
      502,
      'COGNITIVE_BAD_JSON',
    )
  }
  return normalizeExtraction(parsed, opts)
}

function forensicSystem(opts: ExtractDeprocastOpts): string {
  return `${FORENSIC_LEAD}\n\n${buildSystemPrompt(opts)}`
}

export class CognitiveEngine {
  private readonly groqComplete: GroqCompleter
  private readonly ollamaComplete: OllamaCompleter
  private readonly groqModel?: string
  private readonly ollamaBaseUrl: string
  private readonly ollamaModelId: string
  private readonly skipQueue: boolean

  constructor(opts: CognitiveEngineOptions = {}) {
    this.groqComplete = opts.groqComplete ?? defaultGroqComplete
    this.ollamaComplete = opts.ollamaComplete ?? defaultOllamaComplete
    this.groqModel = opts.groqModel
    this.ollamaBaseUrl = (opts.ollamaUrl ?? ollamaUrl()).replace(/\/+$/, '')
    this.ollamaModelId = opts.ollamaModel ?? ollamaModel()
    this.skipQueue = Boolean(opts.skipQueue)
  }

  async extractKnowledge(
    transcript: string,
    opts: ExtractDeprocastOpts = {},
  ): Promise<CognitiveResult> {
    const run = () => this.extractUnqueued(transcript, opts)
    if (this.skipQueue) return run()
    return enqueueLlm(run)
  }

  private async extractUnqueued(
    transcript: string,
    opts: ExtractDeprocastOpts,
  ): Promise<CognitiveResult> {
    const text = transcript.replace(/\s+/g, ' ').trim()
    if (!text) {
      return { extraction: emptyGroqExtraction(), provider: 'groq' }
    }

    const system = forensicSystem(opts)
    const user = buildUserPrompt(text, opts)
    const model = resolveGroqModel(opts.model ?? this.groqModel)

    if (hasGroqKey() || this.groqComplete !== defaultGroqComplete) {
      try {
        const raw = await this.groqComplete({ model, system, user })
        return {
          extraction: decodeExtraction(raw, opts),
          provider: 'groq',
        }
      } catch (err) {
        const status = groqErrorStatus(err)
        const msg = err instanceof Error ? err.message : String(err)
        const kind = isGroqRateLimitError(err) ? '429 Rate Limit' : `caída ${status}`
        console.warn(
          `[cognitive] Groq ${kind}: ${msg.slice(0, 240)} → fallback Ollama (${this.ollamaModelId})`,
        )
      }
    } else {
      console.warn('[cognitive] sin GROQ_API_KEY → fallback Ollama')
    }

    try {
      const raw = await this.ollamaComplete({
        url: this.ollamaBaseUrl,
        model: this.ollamaModelId,
        system,
        user,
      })
      return {
        extraction: decodeExtraction(raw, opts),
        provider: 'ollama',
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError(
        `Motor cognitivo caído (Groq + Ollama): ${msg.slice(0, 200)}`,
        503,
        'COGNITIVE_UNAVAILABLE',
      )
    }
  }
}

const defaultEngine = new CognitiveEngine()

/**
 * Extrae quántomos, acciones y entidades. Pasa por la cola serial.
 * Si Groq falla (429 u otro), reintenta en Ollama local.
 */
export async function extractKnowledge(
  transcript: string,
  opts: ExtractDeprocastOpts = {},
): Promise<GroqExtraction> {
  const { extraction } = await defaultEngine.extractKnowledge(transcript, opts)
  return extraction
}

export async function extractKnowledgeDetailed(
  transcript: string,
  opts: ExtractDeprocastOpts = {},
): Promise<CognitiveResult> {
  return defaultEngine.extractKnowledge(transcript, opts)
}
