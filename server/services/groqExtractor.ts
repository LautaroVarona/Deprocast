/**
 * Extractor forense Deprocast v0.7 — Groq (ENR + átomos + acciones).
 * Si la API falla, devuelve matrices vacías para no tumbar la cola.
 */
import Groq from 'groq-sdk'
import type { CohereAction, CohereEntity, CohereExtraction } from '../types.js'
import { clampTitleWords } from './titleUtils.js'

export const GROQ_ENTITY_TIPOS = [
  'Persona',
  'Proyecto',
  'Agrupacion',
  'Artefacto',
  'Ubicacion',
  'Hito',
] as const

export type GroqEntityTipo = (typeof GROQ_ENTITY_TIPOS)[number]

export type GroqEntityVariante = 'canonico' | 'apodo' | 'typo'

export interface GroqEntidad {
  nombre: string
  tipo: GroqEntityTipo
  /** Nombre canónico si la mención es apodo, typo o variante. */
  canonico?: string
  variante?: GroqEntityVariante
  /** Nombre del perfil/léxico al que apunta esta mención. */
  alias_de?: string
}

export interface GroqExtraction {
  quantomos: string[]
  acciones: string[]
  entidades: GroqEntidad[]
}

export interface KnownNerEntity {
  nombre: string
  tipo: GroqEntityTipo
  aliases?: string[]
}

export interface ExtractDeprocastOpts {
  model?: string
  knownEntities?: KnownNerEntity[]
  slop?: boolean
  maxQuantomos?: number
  speakerContext?: string
  tagsContext?: string
  operatorNote?: string
}

const EMPTY_EXTRACTION: GroqExtraction = {
  quantomos: [],
  acciones: [],
  entidades: [],
}

/** IDs retirados de Groq → modelos actuales (Llama 3 salió de catálogo el 2026-08-16). */
const MODEL_ALIASES: Record<string, string> = {
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
}

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
export const GROQ_FAST_MODEL = 'openai/gpt-oss-20b'

function env(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).replace(/^["']|["']$/g, '').trim()
}

export function hasGroqKey(): boolean {
  return Boolean(env('GROQ_API_KEY'))
}

export function resolveGroqModel(raw?: string): string {
  const requested =
    (raw && raw.trim()) ||
    env('GROQ_MODEL') ||
    GROQ_DEFAULT_MODEL
  return MODEL_ALIASES[requested] ?? requested
}

let cachedClient: Groq | null = null
let cachedKey = ''

export function getGroqClient(): Groq | null {
  const apiKey = env('GROQ_API_KEY')
  if (!apiKey) return null
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new Groq({ apiKey })
    cachedKey = apiKey
  }
  return cachedClient
}

export function emptyGroqExtraction(): GroqExtraction {
  return {
    quantomos: [],
    acciones: [],
    entidades: [],
  }
}

export function buildSystemPrompt(opts: ExtractDeprocastOpts): string {
  const maxQ = Math.max(1, opts.maxQuantomos ?? 8)
  const slop = opts.slop
    ? `
MODO SLOP: el audio es de baja densidad. Extraé como máximo 1 quántomo fiel al texto. No inventes entidades de calidad: si hay nombres dudosos, omitilos.`
    : ''

  return `Actuás como analizador forense de Deprocast. Tu ÚNICO trabajo es leer la transcripción (STT Deepgram, español) y devolver JSON puro. Cero prosa, cero markdown, cero comentarios.

Devolvé un objeto JSON con exactamente estas tres claves:
{
  "quantomos": string[],
  "acciones": string[],
  "entidades": [
    {
      "nombre": string,
      "tipo": "Persona" | "Proyecto" | "Agrupacion" | "Artefacto" | "Ubicacion" | "Hito",
      "canonico": string,
      "variante": "canonico" | "apodo" | "typo",
      "alias_de": string
    }
  ]
}

Definiciones:
- quantomos: ideas atómicas, reflexiones filosóficas o conceptos puros REALES del texto. Máximo ${maxQ}. No rellenes el cupo. Cero está bien.
- acciones: tareas operativas o directrices mencionadas. Pocas. Si no hay, [].
- entidades: nombres propios u objetos nominados. tipo es UNO de los 6 literales (respetá mayúsculas y sin tilde en Agrupacion/Ubicacion).

Tipos (estrictos):
- Persona: humana identificable (nombre, apellido, apodo de gente).
- Proyecto: iniciativa, producto, obra, campaña con nombre propio.
- Agrupacion: banda, equipo, colectivo, org informal, crew.
- Artefacto: objeto/herramienta/documento/dispositivo con nombre propio.
- Ubicacion: lugar, calle, barrio, ciudad, país, topónimo.
- Hito: evento temporal, entrega, estreno, deadline nominado.

ENR / vinculación:
- "nombre" = forma SUPERFICIAL tal cual aparece en el transcript (no la corrijas).
- Si es el nombre real/canónico: variante="canonico", canonico=nombre, alias_de omitido o igual.
- Si es apodo, hipocorístico o handle: variante="apodo", canonico=nombre real si lo sabés o está en el léxico, alias_de=ese canónico.
- Si hay typo, ASR mal o grafía rara ("Camila" oído como "Camilla", "Deprocast" como "de procast"): variante="typo", canonico=forma correcta, alias_de=canónico del léxico si existe.
- Si el léxico conocido lista un perfil, vinculá a ese nombre en alias_de (no inventes perfiles nuevos si hay match).
- No marques conceptos, categorías ni ruido como Persona.
- Preferí omitir a inventar.

Reglas de oro:
- No inventes hechos que no estén en la transcripción.
- Responde SOLO el JSON.
${slop}`
}

export function buildUserPrompt(
  transcript: string,
  opts: ExtractDeprocastOpts,
): string {
  const extras: string[] = []
  if (opts.speakerContext) extras.push(opts.speakerContext)
  if (opts.tagsContext) extras.push(opts.tagsContext)
  if (opts.operatorNote) extras.push(`Nota operador:\n${opts.operatorNote}`)

  let lexicon = ''
  const known = opts.knownEntities?.filter((e) => e.nombre.trim()) ?? []
  if (known.length > 0) {
    const lines = known.slice(0, 80).map((e) => {
      const aliases =
        e.aliases?.filter(Boolean).slice(0, 6).join(', ') || ''
      return aliases
        ? `- ${e.tipo}: ${e.nombre} (aliases: ${aliases})`
        : `- ${e.tipo}: ${e.nombre}`
    })
    lexicon = `\n\nLéxico conocido (vinculá typos y apodos a estos canónicos vía alias_de):\n${lines.join('\n')}`
  }

  return `${extras.join('\n\n')}${lexicon}\n\nTranscripción:\n${transcript}`
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
    return null
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1))
  return null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim()
      if (x && typeof x === 'object' && 'content' in x) {
        return String((x as { content?: unknown }).content ?? '').trim()
      }
      if (x && typeof x === 'object' && 'title' in x) {
        const o = x as { title?: unknown; content?: unknown }
        return [o.title, o.content].filter(Boolean).map(String).join(': ').trim()
      }
      return String(x ?? '').trim()
    })
    .filter(Boolean)
}

function normalizeTipo(raw: unknown): GroqEntityTipo | null {
  const t = String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  if (t === 'persona' || t === 'person' || t === 'people' || t === 'fisica') {
    return 'Persona'
  }
  if (t === 'proyecto' || t === 'project') return 'Proyecto'
  if (t === 'agrupacion' || t === 'grupo' || t === 'banda' || t === 'crew') {
    return 'Agrupacion'
  }
  if (t === 'artefacto' || t === 'artifact' || t === 'objeto' || t === 'tool') {
    return 'Artefacto'
  }
  if (
    t === 'ubicacion' ||
    t === 'lugar' ||
    t === 'geografia' ||
    t === 'location' ||
    t === 'place'
  ) {
    return 'Ubicacion'
  }
  if (t === 'hito' || t === 'milestone' || t === 'evento') return 'Hito'
  return null
}

function normalizeVariante(raw: unknown): GroqEntityVariante | undefined {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (v === 'canonico' || v === 'canonical' || v === 'canon') return 'canonico'
  if (v === 'apodo' || v === 'alias' || v === 'nickname' || v === 'nick') {
    return 'apodo'
  }
  if (v === 'typo' || v === 'typo_asr' || v === 'error' || v === 'ocr') {
    return 'typo'
  }
  return undefined
}

function normalizeEntidades(raw: unknown): GroqEntidad[] {
  if (!Array.isArray(raw)) return []
  const out: GroqEntidad[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const nombre = String(o.nombre ?? o.name ?? '').trim()
    const tipo = normalizeTipo(o.tipo ?? o.type)
    if (!nombre || !tipo) continue
    const key = `${tipo}::${nombre.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const canonico = String(o.canonico ?? o.canonical ?? '').trim()
    const aliasDe = String(o.alias_de ?? o.aliasOf ?? o.alias_of ?? '').trim()
    const variante = normalizeVariante(o.variante ?? o.variant)
    const entity: GroqEntidad = { nombre, tipo }
    if (canonico) entity.canonico = canonico
    if (variante) entity.variante = variante
    if (aliasDe) entity.alias_de = aliasDe
    out.push(entity)
  }
  return out
}

export function normalizeExtraction(
  partial: Record<string, unknown> | null,
  opts: ExtractDeprocastOpts,
): GroqExtraction {
  if (!partial) return emptyGroqExtraction()
  const maxQ = opts.maxQuantomos != null ? Math.max(0, opts.maxQuantomos) : 24
  let quantomos = asStringArray(partial.quantomos).slice(0, maxQ)
  let acciones = asStringArray(
    partial.acciones ?? partial.actions,
  ).slice(0, 16)
  let entidades = normalizeEntidades(partial.entidades ?? partial.entities)
  if (opts.slop) {
    quantomos = quantomos.slice(0, 1)
    entidades = []
    acciones = acciones.slice(0, 1)
  }
  return { quantomos, acciones, entidades }
}

/**
 * Extrae quántomos, acciones y entidades (ENR) de un transcript crudo.
 * Motor híbrido Groq → Ollama, serializado en la cola LLM.
 * Si ambos fallan, matrices vacías para no tumbar la cola de pipeline.
 */
export async function extractDeprocastEntities(
  transcript: string,
  opts: ExtractDeprocastOpts = {},
): Promise<GroqExtraction> {
  const text = transcript.replace(/\s+/g, ' ').trim()
  if (!text) return emptyGroqExtraction()

  try {
    const { extractKnowledge } = await import('./cognitiveEngine.js')
    return await extractKnowledge(transcript, opts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[groq/extractor] motor cognitivo falló, ENR vacía:', msg.slice(0, 300))
    return { ...EMPTY_EXTRACTION }
  }
}

export function groqEntityToCohere(e: GroqEntidad): CohereEntity {
  const extra = {
    deprocast_tipo: e.tipo,
    variante: e.variante,
    canonico: e.canonico,
    alias_de: e.alias_de,
  }
  const name = e.nombre
  switch (e.tipo) {
    case 'Persona':
      return { name, type: 'person', kind: 'fisica', ...extra }
    case 'Agrupacion':
      return { name, type: 'person', kind: 'ficticia', ...extra }
    case 'Ubicacion':
      return { name, type: 'person', kind: 'geografia', ...extra }
    case 'Proyecto':
      return {
        name,
        type: 'project',
        category: 'proyecto',
        status: 'emergente',
        ...extra,
      }
    case 'Artefacto':
      return {
        name,
        type: 'project',
        category: 'artefacto',
        status: 'emergente',
        ...extra,
      }
    case 'Hito':
      return {
        name,
        type: 'project',
        category: 'hito',
        status: 'emergente',
        ...extra,
      }
  }
}

/** Adapta el JSON forense al bundle que ya consume el pipeline. */
export function groqToCohereExtraction(
  extraction: GroqExtraction,
  title: string,
): CohereExtraction {
  const fallback = clampTitleWords(title, 3, 5, 'Nota de voz local')
  const firstAtom = extraction.quantomos[0] ?? ''
  const suggested = clampTitleWords(firstAtom, 3, 5, fallback)

  const quantomos = extraction.quantomos.map((q) => ({
    title: clampTitleWords(q, 3, 6, suggested),
    content: q,
    hermetic_weight: 7,
    universe: 'trinchera',
  }))

  const actions: CohereAction[] = extraction.acciones.map((task_text) => ({
    task_text,
    tag: 'general',
  }))

  return {
    suggested_title: suggested,
    quantomos,
    actions,
    entities: extraction.entidades.map(groqEntityToCohere),
  }
}
