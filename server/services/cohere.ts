import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type {
  AgrupacionGeneratedMeta,
  BookmarkCategory,
  BookmarkExtraction,
  ChatExtraction,
  ChatTipo,
  CohereExtraction,
  DeproIdaCardProposal,
  OcrFrameResult,
} from '../types.js'
import { getDb } from '../db.js'
import { refinePersonKind } from './nerGuards.js'
import { clampTitleWords } from './titleUtils.js'
import { canCallLlm, isPayloadTooLargeError, llmChat } from './llmChat.js'
import { resolveLlmRoute } from './appSettings.js'
import { listNerLexicon } from './entityMatch.js'
import {
  extractDeprocastEntities,
  groqEntityToCohere,
  groqToCohereExtraction,
} from './groqExtractor.js'
import {
  cohereAssistantMessage,
  parseCohereToolCalls,
} from './providers/cohereChat.js'

export { cohereAssistantMessage, parseCohereToolCalls }

export function isCohereQuotaError(err: unknown): boolean {
  if (isPayloadTooLargeError(err)) return false
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Trial key/i.test(msg) ||
    /1000 API calls/i.test(msg) ||
    (/rate limits/i.test(msg) && /Trial/i.test(msg)) ||
    /OpenRouter.*(?:429|rate)/i.test(msg) ||
    /insufficient.?credits/i.test(msg) ||
    /\b402\b/.test(msg)
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const require = createRequire(import.meta.url)

/** @napi-rs/canvas JPEG quality is 0–100 (0.84 would encode at ~1 and yield ~5 KB blobs). */
function jpegQuality100(q: number): number {
  if (!Number.isFinite(q) || q <= 0) return 86
  return q <= 1 ? Math.round(q * 100) : Math.round(q)
}

async function encodeImageForVision(absPath: string): Promise<{
  dataUrl: string
  bytes: number
  width: number
  height: number
}> {
  try {
    const { createCanvas, loadImage } =
      require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
    const img = await loadImage(absPath)
    const maxEdge = 2048
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const canvasBuf = canvas as unknown as {
      toBuffer: (mime: string, quality?: number) => Buffer
    }
    let quality = 86
    let buf = canvasBuf.toBuffer('image/jpeg', jpegQuality100(quality))
    while (buf.length > 3_500_000 && quality > 70) {
      quality -= 6
      buf = canvasBuf.toBuffer('image/jpeg', jpegQuality100(quality))
    }
    if (buf.length < 12_000 && width * height > 200_000) {
      console.warn(
        `[cohere/notebook-vision] JPEG sospechosamente chico (${buf.length} B a ${width}x${height}, q=${quality})`,
      )
    }
    return {
      dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
      bytes: buf.length,
      width,
      height,
    }
  } catch (err) {
    const raw = fs.readFileSync(absPath)
    const ext = absPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
    console.warn(
      '[cohere/notebook-vision] no se pudo reescalar, se manda original:',
      err,
    )
    return {
      dataUrl: `data:image/${ext};base64,${raw.toString('base64')}`,
      bytes: raw.length,
      width: 0,
      height: 0,
    }
  }
}

/** Extrae un campo string aunque el JSON venga truncado o con saltos crudos. */
function extractJsonStringField(raw: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`)
  const m = re.exec(raw)
  if (!m) return null
  let i = m.index + m[0].length
  let out = ''
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1]
      if (n === 'n') out += '\n'
      else if (n === 'r') out += '\r'
      else if (n === 't') out += '\t'
      else if (n === 'u' && /[0-9a-fA-F]{4}/.test(raw.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16))
        i += 6
        continue
      } else {
        out += n
      }
      i += 2
      continue
    }
    if (ch === '"') break
    if (ch === '\n' || ch === '\r') {
      out += '\n'
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

function salvageNotebookVisionJson(raw: string): Record<string, unknown> | null {
  const title = extractJsonStringField(raw, 'title')
  const transcription = extractJsonStringField(raw, 'transcription_spatial')
  if (!title && !transcription) return null
  return {
    title: title || 'Hoja sin título',
    transcription_spatial: transcription || '',
    graphic_elements: [],
    is_blank: false,
    meta: { layout: 'unknown', notes: 'json truncado rescatado' },
  }
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const tryParse = (s: string) => JSON.parse(s) as Record<string, unknown>
  try {
    return tryParse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return tryParse(cleaned.slice(start, end + 1))
      } catch {
        /* sigue al salvage */
      }
    }
    const salvaged = salvageNotebookVisionJson(cleaned)
    if (salvaged) {
      console.warn(
        '[cohere/notebook-vision] JSON truncado, se rescató título/transcripción',
      )
      return salvaged
    }
    throw new Error(
      `Visión no devolvió JSON (${cleaned.slice(0, 220) || 'vacío'})`,
    )
  }
}

type ExtractOpts = {
  fallback?: 'mock' | 'none'
  maxQuantomos?: number
  humanWeight?: number
  slop?: boolean
  speakerContext?: string
  tagsContext?: string
  operatorNote?: string
}

function buildAudioSystemPrompt(opts: ExtractOpts): string {
  const maxQ = Math.max(1, opts.maxQuantomos ?? 6)
  const weight = opts.humanWeight ?? 7
  const slopRule = opts.slop
    ? `- Este audio es SLOP (voto 1–3). Extraé 1 cuántomo fiel al transcript. Todas las entidades person nuevas van con kind "ruido" (vincular a Ruido, no crear perfiles).`
    : `- kind (person): fisica | juridica | ficticia | abstracta | ruido | geografia.`
  return `Eres el extractor hermético de Deprocast. Recibes un transcript en español de una nota de voz/caminata.
Devuelve ÚNICAMENTE un JSON válido (sin markdown) con esta forma exacta:
{
  "suggested_title": string,
  "quantomos": [
    { "title": string, "content": string, "universe": string }
  ],
  "actions": [
    { "task_text": string, "tag": string }
  ],
  "entities": [
    {
      "name": string,
      "type": "person" | "project",
      "kind": "fisica" | "juridica" | "ficticia" | "abstracta" | "ruido" | "geografia" (solo si type=person),
      "category": string (solo si type=project),
      "status": "activo" | "pausado" | "cerrado" | "emergente" (solo si type=project),
      "tactical_focus": string (solo si type=project, opcional)
    }
  ]
}
Reglas:
- suggested_title = nombre corto del audio, entre 3 y 5 palabras, en español, sin comillas ni puntuación final.
- quantomos = ideas atómicas densas REALES del transcript. Máximo ${maxQ}. NO rellenes el cupo: si hay menos ideas, devolvé menos. Cero está bien si no hay nada extraíble (salvo SLOP: entonces 1).
- NO inventes cuántomos plausibles ni de relleno. Si el transcript es stub o inútil, quantomos = [] (salvo SLOP: 1 ítem literal).
- El peso humano ya está fijado (${weight}); no asignes hermetic_weight.
- actions = tareas accionables sugeridas (pocas).
- entities = menciones candidatas. NO asumas identidad canónica; devolvé el nombre tal cual aparece.
- type debe ser exactamente "person" o "project".
${slopRule}
- Personas (type=person) = SOLO Físicas | Jurídicas | Ficticias (nombres propios de gente, orgs/marcas, personajes).
- Geografía (kind=geografia): calles, ciudades, barrios, países, topónimos. NO las metas como persona fisica.
- NO marques como person conceptos, categorías, dominios, adjetivos de taxonomía ni actividades (Gráfico, Audiovisual, distribución, motor, sistema…). Eso es abstracta u omitir.
- ruido = basura NER: fragmentos sin sentido, interjecciones. Calles/lugares van a geografia, no a ruido.
- NO incluyas lugares como type=project.
- Preferí omitir ruido obvio; si dudás, marcá kind=ruido o abstracta (nunca fisica por defecto).
- Responde solo JSON.`
}

export async function extractFromTranscript(
  transcript: string,
  title: string,
  opts?: ExtractOpts,
): Promise<CohereExtraction> {
  const empty: CohereExtraction = {
    suggested_title: title,
    quantomos: [],
    actions: [],
    entities: [],
  }
  const useMock = opts?.fallback !== 'none'
  const fallback = (): CohereExtraction =>
    useMock
      ? clampExtraction(mockExtraction(transcript, title), opts)
      : empty

  const route = resolveLlmRoute('fast')
  if (route.provider === 'groq') {
    if (!route.apiKey) return fallback()
    try {
      let knownEntities: ReturnType<typeof listNerLexicon> = []
      try {
        knownEntities = listNerLexicon(getDb())
      } catch (err) {
        console.warn('[groq/extractor] léxico ENR no disponible:', err)
      }
      const groq = await extractDeprocastEntities(transcript, {
        model: route.model,
        knownEntities,
        slop: opts?.slop,
        maxQuantomos: opts?.maxQuantomos,
        speakerContext: opts?.speakerContext,
        tagsContext: opts?.tagsContext,
        operatorNote: opts?.operatorNote,
      })
      return clampExtraction(groqToCohereExtraction(groq, title), opts)
    } catch (err) {
      console.error('[groq/extractor] extractFromTranscript:', err)
      return empty
    }
  }

  if (!canCallLlm('fast')) {
    return fallback()
  }

  try {
    const extras: string[] = []
    if (opts?.speakerContext) extras.push(opts.speakerContext)
    if (opts?.tagsContext) extras.push(opts.tagsContext)
    if (opts?.operatorNote) extras.push(`Nota operador:\n${opts.operatorNote}`)

    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildAudioSystemPrompt(opts ?? {}) },
        {
          role: 'user',
          content: `Título actual: ${title}\n${extras.join('\n\n')}\n\nTranscript:\n${transcript}`,
        },
      ],
    })

    const parsed = parseJsonSafe(raw)
    if (parsed) {
      return clampExtraction(
        normalizeExtraction(parsed, title, transcript),
        opts,
      )
    }
    return fallback()
  } catch (err) {
    console.error('[cohere] failed, using mock:', err)
    return fallback()
  }
}

function clampExtraction(
  extraction: CohereExtraction,
  opts?: ExtractOpts,
): CohereExtraction {
  const maxQ =
    opts?.maxQuantomos != null
      ? Math.max(0, opts.maxQuantomos)
      : extraction.quantomos.length
  const weight = opts?.humanWeight
  let quantomos = extraction.quantomos.slice(0, maxQ)
  if (opts?.slop) {
    quantomos = quantomos.slice(0, 1)
    if (quantomos.length === 0) {
      quantomos = [
        {
          title: extraction.suggested_title || 'Audio slop',
          content: 'Transcripción de baja densidad; procesar como ruido.',
          hermetic_weight: weight ?? 1,
          universe: 'ruido',
        },
      ]
    }
  }
  if (weight != null) {
    quantomos = quantomos.map((q) => ({ ...q, hermetic_weight: weight }))
  }
  let entities = extraction.entities
  if (opts?.slop) {
    entities = entities.map((e) =>
      e.type === 'person' ? { ...e, kind: 'ruido' } : e,
    )
  }
  return { ...extraction, quantomos, entities }
}

function parseJsonSafe(raw: string): Partial<CohereExtraction> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as Partial<CohereExtraction>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Partial<CohereExtraction>
      } catch {
        return null
      }
    }
    return null
  }
}

function normalizeExtraction(
  partial: Partial<CohereExtraction>,
  fallbackTitle: string,
  transcript: string,
): CohereExtraction {
  const suggested = clampTitleWords(
    String(partial.suggested_title ?? ''),
    3,
    5,
    deriveFallbackTitle(transcript, fallbackTitle),
  )

  return {
    suggested_title: suggested,
    quantomos: Array.isArray(partial.quantomos)
      ? partial.quantomos.map((q) => ({
          title: String(q.title ?? 'Sin título'),
          content: String(q.content ?? ''),
          hermetic_weight: Number(q.hermetic_weight ?? 5),
          universe: String(q.universe ?? 'trinchera'),
        }))
      : [],
    actions: Array.isArray(partial.actions)
      ? partial.actions.map((a) => ({
          task_text: String(a.task_text ?? a),
          tag: String(a.tag ?? 'general'),
        }))
      : [],
    entities: Array.isArray(partial.entities)
      ? partial.entities
          .map((e) => normalizeEntity(e))
          .filter((e): e is NonNullable<typeof e> => e !== null)
      : [],
  }
}

function normalizeEntity(e: {
  name?: string
  type?: string
  kind?: string
  category?: string
  status?: string
  tactical_focus?: string
}): {
  name: string
  type: string
  kind?: string
  category?: string
  status?: string
  tactical_focus?: string
} | null {
  const name = String(e.name ?? '').trim()
  if (!name) return null

  const rawType = String(e.type ?? 'unknown').toLowerCase().trim()
  let type = 'unknown'
  if (
    [
      'person',
      'persona',
      'people',
      'fisica',
      'juridica',
      'agrupacion',
      'ficticia',
      'ficticio',
      'abstracta',
      'ruido',
      'geografia',
    ].includes(rawType)
  ) {
    type = 'person'
  } else if (
    ['project', 'proyecto', 'initiative', 'iniciativa'].includes(rawType)
  ) {
    type = 'project'
  } else {
    return null
  }

  const out: {
    name: string
    type: string
    kind?: string
    category?: string
    status?: string
    tactical_focus?: string
  } = { name, type }

  if (type === 'person') {
    const kind = String(e.kind ?? rawType).toLowerCase()
    let resolved: string
    if (kind === 'agrupacion' || kind === 'ficticio') resolved = 'ficticia'
    else if (
      [
        'fisica',
        'juridica',
        'ficticia',
        'abstracta',
        'ruido',
        'geografia',
      ].includes(kind)
    ) {
      resolved = kind
    } else {
      resolved = 'fisica'
    }
    out.kind = refinePersonKind(name, resolved)
  } else {
    if (e.category) out.category = String(e.category)
    const st = String(e.status ?? 'emergente').toLowerCase()
    out.status = ['activo', 'pausado', 'cerrado', 'emergente'].includes(st)
      ? st
      : 'emergente'
    if (e.tactical_focus) out.tactical_focus = String(e.tactical_focus)
  }
  return out
}

function deriveFallbackTitle(transcript: string, title: string): string {
  const clean = transcript
    .replace(/\[STUB[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = clean.split(/\s+/).filter((w) => w.length > 2).slice(0, 5)
  if (words.length >= 3) return words.join(' ')
  return clampTitleWords(`Nota sobre ${title}`, 3, 5, 'Nota de voz local')
}

function mockExtraction(transcript: string, title: string): CohereExtraction {
  const snippet = transcript.slice(0, 180).replace(/\s+/g, ' ').trim()
  return {
    suggested_title: deriveFallbackTitle(transcript, title),
    quantomos: [
      {
        title: `Esencia: ${title}`,
        content: snippet || `Nota derivada de ${title}`,
        hermetic_weight: 6,
        universe: 'trinchera',
      },
      {
        title: 'Señal local-first',
        content:
          'Mantener vault, SQLite y aduana HITL como núcleo operativo de Deprocast.',
        hermetic_weight: 7,
        universe: 'sistema',
      },
    ],
    actions: [
      {
        task_text: `Revisar y aprobar la entrada «${title}» en aduana`,
        tag: 'hitl',
      },
      {
        task_text: 'Confirmar timestamp_exact de la caminata',
        tag: 'origen',
      },
    ],
    entities: [
      {
        name: 'Deprocast',
        type: 'project',
        category: 'producto',
        status: 'activo',
        tactical_focus: 'local-first HITL',
      },
      {
        name: 'Operador',
        type: 'person',
        kind: 'fisica',
      },
    ],
  }
}

const BOOKMARK_CATEGORIES = [
  'HERRAMIENTAS',
  'CONCEPTOS',
  'ENTIDADES',
  'NEGOCIOS',
  'ARTE',
  'ARCHIVO',
] as const

const BOOKMARK_SYSTEM_PROMPT = `Eres el extractor de bookmarks de Deprocast. Recibes el texto de un tuit/bookmark guardado.
Puede venir metadata "Autor:" / "Link:" — eso es metadata del post, NO contenido a entity-izar.
Devuelve ÚNICAMENTE un JSON válido (sin markdown) con esta forma exacta:
{
  "category": "HERRAMIENTAS" | "CONCEPTOS" | "ENTIDADES" | "NEGOCIOS" | "ARTE" | "ARCHIVO",
  "quantomo": string,
  "suggested_title": string,
  "suggested_weight": number (1-12),
  "entities": [
    {
      "name": string,
      "type": "person" | "project",
      "kind": "fisica" | "juridica" | "ficticia" | "abstracta" | "ruido" | "geografia" (solo si type=person),
      "category": string (solo si type=project),
      "status": "activo" | "pausado" | "cerrado" | "emergente" (solo si type=project)
    }
  ]
}
Reglas:
- category = exactamente UNA de las 6 categorías.
  - HERRAMIENTAS: software, libs, prompts, workflows, gadgets.
  - CONCEPTOS: ideas, frameworks mentales, papers, tesis.
  - ENTIDADES: personas, empresas, lugares, marcas como foco principal.
  - NEGOCIOS: deals, modelos de negocio, pricing, fundraising.
  - ARTE: estética, diseño, cultura, media creativa.
  - ARCHIVO: referencia utilitaria / guardar por si acaso / bajo valor semántico.
- quantomo = UNA oración densa: la idea central destilada (español).
- suggested_title = 3 a 5 palabras, sin puntuación final.
- suggested_weight = tu estimación 1-12 (el operador ya asignó peso humano aparte).
- entities = SOLO nombres mencionados EN EL CUERPO del texto (no en Autor:/Link:).
  - NUNCA incluyas al Autor del post ni su @username como entidad, aunque aparezcan en metadata.
  - Personas = Físicas | Jurídicas | Ficticias. Solo nombres propios.
  - Personas reales identificables → type=person kind=fisica.
  - Empresas, marcas, estudios, orgs, cuentas institucionales → type=person kind=juridica (o type=project si es producto/iniciativa).
  - Personajes, roles narrativos inventados → type=person kind=ficticia.
  - Lugares, calles, ciudades, barrios, países → type=person kind=geografia.
  - Roles genéricos ("alguien", "la gente") y conceptos/categorías/dominios → omitir o person+abstracta. NUNCA fisica.
  - Basura NER sin sentido → omitir o person+ruido.
  - Clasificá kind con cuidado: NO defaults a fisica si es org/marca/ficticio/concepto/lugar.
- Responde solo JSON.`

export async function extractFromBookmark(
  text: string,
  meta?: { author?: string; link?: string },
): Promise<BookmarkExtraction> {
  if (!canCallLlm('fast')) {
    return mockBookmarkExtraction(text)
  }

  try {
    const author = meta?.author
      ? `\nAutor del post (metadata; NO extraer como entidad): ${meta.author}`
      : ''
    const link = meta?.link ? `\nLink: ${meta.link}` : ''

    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: BOOKMARK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Bookmark text:${author}${link}\n\nCuerpo:\n${text}`,
        },
      ],
    })

    const parsed = parseJsonSafe(raw) as Partial<BookmarkExtraction> | null
    if (parsed) return normalizeBookmarkExtraction(parsed, text)
    return mockBookmarkExtraction(text)
  } catch (err) {
    console.error('[cohere/bookmark] failed, using mock:', err)
    return mockBookmarkExtraction(text)
  }
}

function normalizeCategory(raw: unknown): BookmarkCategory {
  const s = String(raw ?? '')
    .toUpperCase()
    .trim()
  if ((BOOKMARK_CATEGORIES as readonly string[]).includes(s)) {
    return s as BookmarkCategory
  }
  return 'CONCEPTOS'
}

function normalizeBookmarkExtraction(
  partial: Partial<BookmarkExtraction>,
  text: string,
): BookmarkExtraction {
  const quantomo = String(partial.quantomo ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const suggested = clampTitleWords(
    String(partial.suggested_title ?? ''),
    3,
    5,
    deriveFallbackTitle(text, 'Bookmark X'),
  )
  let suggestedWeight: number | null = null
  if (
    partial.suggested_weight != null &&
    Number.isFinite(Number(partial.suggested_weight))
  ) {
    suggestedWeight = Math.max(
      1,
      Math.min(12, Math.round(Number(partial.suggested_weight))),
    )
  }

  const entities = Array.isArray(partial.entities)
    ? partial.entities
        .map((e) => normalizeEntity(e))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => ({
          name: e.name,
          type: e.type as 'person' | 'project',
          kind: e.kind,
          category: e.category,
          status: e.status,
        }))
    : []

  return {
    category: normalizeCategory(partial.category),
    quantomo:
      quantomo ||
      text.replace(/\s+/g, ' ').trim().slice(0, 220) ||
      'Idea capturada de bookmark',
    suggested_title: suggested,
    suggested_weight: suggestedWeight,
    entities,
  }
}

function mockBookmarkExtraction(text: string): BookmarkExtraction {
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180)
  return {
    category: 'CONCEPTOS',
    quantomo: snippet || 'Idea capturada de bookmark',
    suggested_title: deriveFallbackTitle(text, 'Bookmark X'),
    suggested_weight: 7,
    entities: [],
    audio_summary: null,
    video_meta: null,
  }
}

const IG_REEL_SYSTEM_PROMPT = `Eres el extractor hermético de Deprocast para reels de Instagram.
Puede venir metadata "Autor:" / "Link:" — eso es metadata del post, NO contenido a entity-izar.
Devuelve ÚNICAMENTE un JSON válido (sin markdown) con esta forma exacta:
{
  "category": "HERRAMIENTAS" | "CONCEPTOS" | "ENTIDADES" | "NEGOCIOS" | "ARTE" | "ARCHIVO",
  "quantomo": string,
  "suggested_title": string,
  "suggested_weight": number (1-12),
  "audio_summary": string | null,
  "video_meta": string | null,
  "entities": [
    {
      "name": string,
      "type": "person" | "project",
      "kind": "fisica" | "juridica" | "ficticia" | "abstracta" | "ruido",
      "category": string,
      "status": "activo" | "pausado" | "cerrado" | "emergente"
    }
  ]
}
Reglas:
- suggested_title = 1 a 3 palabras en español, sin puntuación final. Resume el tema del reel.
- quantomo = una idea atómica densa (1–3 oraciones) a partir de la descripción y, si hay, transcript/OCR.
- audio_summary = resumen breve del habla del video si hay transcript; null si no hay.
- video_meta = síntesis de de qué va el video (descripción + audio + OCR); null si solo hay descripción corta.
- entities = SOLO menciones en descripción/transcript/OCR (no en Autor:/Link:).
  - NUNCA incluyas al Autor del reel ni su @username como entidad.
  - kind: fisica (persona real), juridica (marca/org/estudio), ficticia (personaje), geografia (lugar), abstracta/ruido según corresponda.
  - Personas = Físicas | Jurídicas | Ficticias. Conceptos/categorías/dominios → omitir o abstracta, nunca fisica. Lugares → geografia.
  - NO defaults a fisica si es org/marca/ficticio/concepto/lugar.
- Responde solo JSON.`

export type InstagramReelExtractInput = {
  description: string
  transcript?: string | null
  ocrFrames?: Array<{ t_sec: number; explanation: string }>
  author?: string
  link?: string
}

export async function extractFromInstagramReel(
  input: InstagramReelExtractInput,
): Promise<BookmarkExtraction> {
  const description = input.description.replace(/\s+/g, ' ').trim()
  if (!canCallLlm('fast')) {
    return mockInstagramExtraction(description, input)
  }

  try {
    const author = input.author
      ? `\nAutor del post (metadata; NO extraer como entidad): ${input.author}`
      : ''
    const link = input.link ? `\nLink: ${input.link}` : ''
    const transcript = input.transcript?.trim()
      ? `\n\nTranscript audio:\n${input.transcript.trim().slice(0, 8000)}`
      : ''
    const ocr =
      input.ocrFrames && input.ocrFrames.length > 0
        ? `\n\nOCR / fotogramas:\n${input.ocrFrames
            .map((f) => `[t=${f.t_sec}s] ${f.explanation}`)
            .join('\n')
            .slice(0, 8000)}`
        : ''

    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: IG_REEL_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Reel Instagram:${author}${link}\n\nDescripción:\n${description}${transcript}${ocr}`,
        },
      ],
    })

    const parsed = parseJsonSafe(raw) as Partial<BookmarkExtraction> | null
    if (parsed) {
      const base = normalizeBookmarkExtraction(parsed, description)
      return {
        ...base,
        suggested_title: clampTitleWords(
          String(parsed.suggested_title ?? base.suggested_title),
          1,
          3,
          deriveFallbackTitle(description, 'Reel IG'),
        ),
        audio_summary: parsed.audio_summary
          ? String(parsed.audio_summary).trim()
          : input.transcript
            ? String(input.transcript).slice(0, 280)
            : null,
        video_meta: parsed.video_meta
          ? String(parsed.video_meta).trim()
          : null,
      }
    }
    return mockInstagramExtraction(description, input)
  } catch (err) {
    console.error('[cohere/ig] failed, using mock:', err)
    return mockInstagramExtraction(description, input)
  }
}

function mockInstagramExtraction(
  description: string,
  input: InstagramReelExtractInput,
): BookmarkExtraction {
  const snippet = description.slice(0, 180)
  return {
    category: 'CONCEPTOS',
    quantomo: snippet || 'Idea capturada de reel',
    suggested_title: clampTitleWords(
      deriveFallbackTitle(description, 'Reel IG'),
      1,
      3,
      'Reel IG',
    ),
    suggested_weight: 6,
    entities: [],
    audio_summary: input.transcript
      ? input.transcript.replace(/\s+/g, ' ').trim().slice(0, 280)
      : null,
    video_meta:
      input.ocrFrames && input.ocrFrames.length > 0
        ? `Video con ${input.ocrFrames.length} fotogramas analizados`
        : null,
  }
}

/** Extrae texto de un fotograma (Unlimited-OCR) o explica con visión LLM. */
export async function explainVideoFrame(
  imageAbsPath: string,
  tSec: number,
): Promise<string> {
  try {
    const { ocrVideoFrameIfEnabled } = await import('./unlimitedOcr.js')
    const ocrText = await ocrVideoFrameIfEnabled(imageAbsPath)
    if (ocrText) {
      return `(t=${tSec}s) ${ocrText.replace(/\s+/g, ' ').trim()}`
    }
  } catch (err) {
    console.warn('[cohere/ig] Unlimited-OCR frame:', err)
  }

  if (!canCallLlm('vision') || !fs.existsSync(imageAbsPath)) {
    return `(t=${tSec}s) fotograma sin análisis`
  }

  try {
    const buf = fs.readFileSync(imageAbsPath)
    const b64 = buf.toString('base64')
    const { text } = await llmChat({
      role: 'vision',
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Fotograma de un reel de Instagram en t=${tSec}s. En 1–3 oraciones en español: qué se ve, texto en pantalla (OCR) y de qué parece tratar. Sé concreto.`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
    })
    return text.replace(/\s+/g, ' ').trim() || `(t=${tSec}s) vacío`
  } catch (err) {
    console.error('[cohere/vision] failed:', err)
    return `(t=${tSec}s) error de visión`
  }
}

export async function analyzeReelFrames(
  frames: Array<{ t_sec: number; absPath: string }>,
): Promise<OcrFrameResult[]> {
  const out: OcrFrameResult[] = []
  for (const f of frames) {
    const explanation = await explainVideoFrame(f.absPath, f.t_sec)
    out.push({
      t_sec: f.t_sec,
      path: f.absPath,
      explanation,
    })
  }
  return out
}

function looksHallucinated(text: string): boolean {
  const t = text.toLowerCase()
  const banned = [
    'segunda guerra mundial',
    'primera guerra mundial',
    'hoy hablaremos de',
    'fue una guerra global',
    'duró desde 1939',
    'en esta lección',
    'en este ensayo',
    'a lo largo de la historia',
    'revolución industrial',
    'la edad media',
  ]
  if (banned.some((p) => t.includes(p))) return true
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean)
  if (text.length > 500 && lines.length <= 2 && /[.!?]\s+[A-ZÁÉÍÓÚ]/.test(text)) {
    return true
  }
  return false
}

const NOTEBOOK_VISION_PROMPT = `Analizás una foto de cuaderno manuscrito (español). Puede ser UNA hoja, una TAPA, o una foto DOBLE (apertura con dos páginas y línea/gutter divisora en el medio).

Tu ÚNICA tarea es TRANSLITERAR lo que se ve en la imagen. No interpretes, no resumas, no des clase, no inventes contexto histórico ni temas que no estén escritos.

La letra puede ser irregular y la foto mediocre: igual INTENTÁ leer. Si una palabra no se ve clara, escribí tu mejor aproximación y marcá [?]. Nunca rellenes con un artículo, lección o Wikipedia.

Devolvé ÚNICAMENTE JSON válido (sin markdown) con esta forma:
{
  "title": string (título corto 2-6 palabras tomado del texto visible; si no hay título, las primeras palabras legibles; si está en blanco, "Sin título"),
  "transcription_spatial": string (transliteración EXACTA del manuscrito; una línea del string = una línea visual. Si es spread, usá marcadores claros:
----- IZQUIERDA -----
...texto izq...
----- DERECHA -----
...texto der...),
  "graphic_elements": [
    {
      "type": "table" | "shape" | "connector" | "drawing" | "line",
      "bbox": [x, y, w, h] (0-1 normalizado sobre TODA la imagen),
      "label": string | null,
      "table": { "rows": string[][] } | null,
      "points": [[x,y], ...] | null
    }
  ],
  "is_blank": boolean,
  "meta": {
    "layout": "single" | "spread" | "cover" | "unknown",
    "notes": string (solo calidad de foto: orientación, sombra, gutter, recorte; SIN interpretar el contenido),
    "orientation_hint": 0 | 90 | 180 | 270,
    "page_bbox": [x, y, w, h] | null (bbox de la región útil de PAPEL a maximizar; excluí mesa/fondos),
    "spread": null | {
      "divider_x": number (0-1, posición horizontal del gutter/línea divisora),
      "left_bbox": [x, y, w, h],
      "right_bbox": [x, y, w, h],
      "left_title": string | null,
      "right_title": string | null,
      "left_transcription": string | null,
      "right_transcription": string | null
    }
  }
}
Reglas:
- Detectá SIEMPRE si la foto muestra dos páginas abiertas (spread). Si hay línea vertical/gutter en el centro o dos bloques de texto lado a lado → layout="spread" y completá meta.spread.
- En spread: transcribí IZQUIERDA y DERECHA por separado (en transcription_spatial con marcadores Y en meta.spread.*_transcription).
- page_bbox debe enmarcar el papel útil (no la mesa). Si es spread, page_bbox puede ser el cuaderno entero abierto.
- orientation_hint: rotación para que el texto quede derecho (0 si ya está).
- Preservá saltos de línea y ubicación; no “corrijas” ortografía salvo ilegibilidad ([?]).
- Copiá letras, números romanos, títulos y listas TAL CUAL. Prohibido rellenar con prosa genérica (“esta es una página de notas…”, resúmenes de guerras, “hoy hablaremos de…”).
- Si hay poco texto o casi vacío: transcribí solo lo visible (aunque sea una palabra al margen). is_blank=true solo si no hay tinta útil (ni títulos, ni números, ni tachaduras).
- Incluí tablas, formas, conectores, dibujos y líneas en graphic_elements (descripción mínima del dibujo, no un ensayo).
- Tapa lisa sin texto interior → layout="cover"; igual proponé título si hay etiqueta/marca.
- Responde solo JSON.`

function normalizeBBox(
  v: unknown,
): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length < 4) return null
  const nums = v.slice(0, 4).map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) return null
  return [
    Math.min(1, Math.max(0, nums[0])),
    Math.min(1, Math.max(0, nums[1])),
    Math.min(1, Math.max(0, nums[2])),
    Math.min(1, Math.max(0, nums[3])),
  ]
}

function normalizeVisionMeta(
  raw: unknown,
): import('../types.js').NotebookPageVisionMeta {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const layoutRaw = String(m.layout || 'unknown')
  const layout =
    layoutRaw === 'single' ||
    layoutRaw === 'spread' ||
    layoutRaw === 'cover' ||
    layoutRaw === 'unknown'
      ? layoutRaw
      : 'unknown'
  const oh = Number(m.orientation_hint ?? 0)
  const orientation_hint =
    oh === 90 || oh === 180 || oh === 270 || oh === 0 ? oh : 0

  let spread: import('../types.js').NotebookPageVisionMeta['spread'] = null
  if (m.spread && typeof m.spread === 'object') {
    const s = m.spread as Record<string, unknown>
    const left = normalizeBBox(s.left_bbox)
    const right = normalizeBBox(s.right_bbox)
    if (left && right) {
      spread = {
        divider_x: Math.min(1, Math.max(0, Number(s.divider_x ?? 0.5))),
        left_bbox: left,
        right_bbox: right,
        left_title: s.left_title != null ? String(s.left_title) : null,
        right_title: s.right_title != null ? String(s.right_title) : null,
        left_transcription:
          s.left_transcription != null ? String(s.left_transcription) : null,
        right_transcription:
          s.right_transcription != null ? String(s.right_transcription) : null,
      }
    }
  }

  return {
    layout: spread ? 'spread' : layout,
    notes: m.notes != null ? String(m.notes) : null,
    orientation_hint,
    page_bbox: normalizeBBox(m.page_bbox),
    spread,
    error: m.error != null ? String(m.error) : null,
  }
}

export async function analyzeNotebookPage(
  imageAbsPath: string,
): Promise<import('../types.js').NotebookPageVisionResult> {
  if (!canCallLlm('vision')) {
    throw new Error('Falta API key del proveedor de visión en .env')
  }
  if (!fs.existsSync(imageAbsPath)) {
    throw new Error(`Imagen no encontrada: ${imageAbsPath}`)
  }

  const encoded = await encodeImageForVision(imageAbsPath)
  console.log(
    `[cohere/notebook-vision] ${path.basename(imageAbsPath)} → ${encoded.width}x${encoded.height} jpeg ${(encoded.bytes / 1024).toFixed(0)} KB`,
  )

  const messagesFor = (prompt: string) => [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: prompt },
        {
          type: 'image_url' as const,
          image_url: { url: encoded.dataUrl },
        },
      ],
    },
  ]

  const call = async (prompt: string, withJsonFormat: boolean) => {
    try {
      const result = await llmChat({
        role: 'vision',
        temperature: 0,
        messages: messagesFor(prompt),
        ...(withJsonFormat
          ? { responseFormat: { type: 'json_object' as const } }
          : {}),
      })
      return result
    } catch (err) {
      const status = (err as Error & { status?: number }).status
      const e = err as Error & { status?: number }
      e.status = status
      throw e
    }
  }

  const retryable = (err: unknown) => {
    const status = (err as Error & { status?: number }).status
    return (
      status === 500 ||
      status === 502 ||
      status === 503 ||
      (status === 429 && !/Trial key|1000 API calls/i.test(String(err)))
    )
  }

  async function callWithRetry(
    prompt: string,
    withJson: boolean,
  ): Promise<{ text: string }> {
    try {
      return await call(prompt, withJson)
    } catch (err) {
      if (!retryable(err)) throw err
      const status = (err as Error & { status?: number }).status
      console.warn(
        `[cohere/notebook-vision] ${status}, reintento sin json_object…`,
      )
      await delay(3000)
      try {
        return await call(prompt, false)
      } catch (err2) {
        if (!retryable(err2)) throw err2
        console.warn('[cohere/notebook-vision] segundo reintento…')
        await delay(5000)
        return await call(prompt, false)
      }
    }
  }

  const parseFrom = async (prompt: string, preferJson: boolean) => {
    let data = await callWithRetry(prompt, preferJson)
    let raw = data.text
    try {
      return extractJsonObject(raw)
    } catch (parseErr) {
      console.warn('[cohere/notebook-vision] JSON inválido, reintento:', parseErr)
      data = await callWithRetry(prompt, !preferJson)
      raw = data.text
      return extractJsonObject(raw)
    }
  }

  let parsed = await parseFrom(NOTEBOOK_VISION_PROMPT, false)

  const elements = Array.isArray(parsed.graphic_elements)
    ? (parsed.graphic_elements as import('../types.js').GraphicElement[])
    : []
  const meta = normalizeVisionMeta(parsed.meta)

  let transcription = String(parsed.transcription_spatial || '')
  if (
    meta.spread &&
    !transcription.includes('----- IZQUIERDA') &&
    (meta.spread.left_transcription || meta.spread.right_transcription)
  ) {
    transcription = [
      '----- IZQUIERDA -----',
      meta.spread.left_transcription || '',
      '----- DERECHA -----',
      meta.spread.right_transcription || '',
    ].join('\n')
  }

  if (looksHallucinated(transcription)) {
    console.warn(
      '[cohere/notebook-vision] alucinación detectada, segundo pase estricto',
    )
    const strict =
      NOTEBOOK_VISION_PROMPT +
      '\n\nLa respuesta anterior INVENTÓ un tema que no está en la foto. Volvé a transcribir SOLO las palabras visibles. Si no se lee, usá [?] — jamás un resumen histórico ni una lección.'
    parsed = await parseFrom(strict, false)
    transcription = String(parsed.transcription_spatial || '')
    if (looksHallucinated(transcription)) {
      transcription = ''
      parsed.is_blank = false
      parsed.title = 'Hoja sin título'
      meta.notes = `${meta.notes || ''} alucinación descartada`.trim()
    }
  }

  const title = String(parsed.title || '').trim() || 'Hoja sin título'
  console.log(
    `[cohere/notebook-vision] ok título="${title.slice(0, 60)}" tx=${transcription.length}c gráficos=${elements.length} blank=${Boolean(parsed.is_blank)}`,
  )

  return {
    title,
    transcription_spatial: transcription,
    graphic_elements: Array.isArray(parsed.graphic_elements)
      ? (parsed.graphic_elements as import('../types.js').GraphicElement[])
      : elements,
    is_blank: Boolean(parsed.is_blank) && transcription.trim().length < 8,
    meta,
  }
}

export async function explainNotebookPage(input: {
  title: string
  transcription: string
  graphic_elements: import('../types.js').GraphicElement[]
  posicion: string
  numero_logico: number
  extraContext?: string
}): Promise<string> {
  const graphicsSummary =
    input.graphic_elements.length > 0
      ? JSON.stringify(input.graphic_elements)
      : '(ninguno)'

  if (!canCallLlm('main')) {
    return `Explicación (local): ${input.title}. ${input.transcription.slice(0, 400)}`
  }

  try {
    const { text } = await llmChat({
      role: 'main',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Sos el analista de cuadernos de Deprocast. Explicá en español (2-4 párrafos) el sentido de UNA hoja usando la transcripción, los elementos gráficos y el contexto extra del operador (audio STT, notas, planilla) si viene. Prohibido inventar hechos que no estén en esos materiales. Si la transcripción es una lista de títulos o está casi vacía, describí eso (estructura y palabras reales) sin rellenar. Sin markdown ni JSON.',
        },
        {
          role: 'user',
          content: `Hoja ${input.numero_logico} (${input.posicion})
Título: ${input.title}

Transcripción espacial:
${input.transcription}

Elementos gráficos:
${graphicsSummary}

Contexto extra del operador (puede estar vacío):
${(input.extraContext || '').trim() || '(ninguno)'}`,
        },
      ],
    })
    return text.trim() || `Explicación de: ${input.title}`
  } catch (err) {
    console.error('[cohere/notebook-explain] failed:', err)
    return `Explicación (fallback): ${input.title}`
  }
}

type NotebookEntity = {
  name: string
  type: 'person' | 'project'
  kind?: string
  category?: string
  status?: string
}

export async function extractNotebookEntities(input: {
  title: string
  transcription: string
  explanation: string
  mentioned?: Array<{ kind: string; entity_name: string }>
}): Promise<NotebookEntity[]> {
  const blob = [
    input.title,
    input.transcription,
    input.explanation,
    ...(input.mentioned ?? []).map(
      (m) => `${m.entity_name} (${m.kind})`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n')

  const route = resolveLlmRoute('fast')
  if (route.provider === 'groq') {
    if (!route.apiKey) return []
    try {
      let knownEntities: ReturnType<typeof listNerLexicon> = []
      try {
        knownEntities = listNerLexicon(getDb())
      } catch {
        knownEntities = []
      }
      const groq = await extractDeprocastEntities(blob, {
        model: route.model,
        knownEntities,
        maxQuantomos: 1,
      })
      return groq.entidades
        .map((e) => groqEntityToCohere(e))
        .filter((e) => e.type === 'person' || e.type === 'project')
        .map((e) => ({
          name: e.name,
          type: e.type as 'person' | 'project',
          kind:
            e.type === 'person' ? refinePersonKind(e.name, e.kind) : e.kind,
          category: e.category,
          status: e.status,
        }))
    } catch (err) {
      console.error('[groq/notebook-ner]', err)
      return []
    }
  }

  if (!canCallLlm('fast')) return []

  try {
    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Extraé entidades de una hoja de cuaderno. JSON único:
{"entities":[{"name":string,"type":"person"|"project","kind"?:string,"category"?:string,"status"?:string}]}
Reglas Deprocast NER:
- type=person SOLO si es una Persona real: nombre propio de humana (kind=fisica), org/marca/estudio (juridica), o personaje (ficticia).
- Personas = Físicas | Jurídicas | Ficticias. NADA más.
- kind=geografia: calles, ciudades, barrios, países, topónimos.
- NO extraigas como person: categorías, dominios, adjetivos de taxonomía, conceptos, actividades, roles genéricos (ej. Gráfico, Audiovisual, Físico, Económico, Jurídico, Dimensiones, Vectores, Membrana, Atractor, distribución, producción, motor, sistema, idea).
- Si dudás entre concepto y persona → OMITÍ o kind=abstracta (nunca fisica).
- type=project = iniciativas/productos/obras con nombre propio, no etiquetas de lista.
- Preferí pocas entidades correctas a muchas dudosas. Solo JSON.`,
        },
        {
          role: 'user',
          content: `Título: ${input.title}\n\nTranscripción:\n${input.transcription}\n\nExplicación:\n${input.explanation}${
            input.mentioned?.length
              ? `\n\nEl operador ya señaló estas entidades (reconocelas y extraé otras relacionadas):\n${input.mentioned
                  .map((m) => `- ${m.entity_name} (${m.kind})`)
                  .join('\n')}`
              : ''
          }`,
        },
      ],
    })
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as {
      entities?: NotebookEntity[]
    }
    if (!Array.isArray(parsed.entities)) return []
    return parsed.entities
      .filter((e) => e?.name && (e.type === 'person' || e.type === 'project'))
      .map((e) => ({
        ...e,
        kind: e.type === 'person' ? refinePersonKind(e.name, e.kind) : e.kind,
      }))
  } catch (err) {
    console.error('[cohere/notebook-ner]', err)
    return []
  }
}

function emptyAgrupacionMeta(): AgrupacionGeneratedMeta {
  return {
    summary: '',
    tags: [],
    themes: [],
    related_person_names: [],
    related_categories: [],
    inferred_facts: [],
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

function normalizeAgrupacionMeta(
  parsed: Partial<AgrupacionGeneratedMeta> | null,
  name: string,
  notes: string,
  members: string[],
): AgrupacionGeneratedMeta {
  if (!parsed) {
    return mockAgrupacionMeta(name, notes, members)
  }
  return {
    summary: String(parsed.summary ?? '').trim() || `Agrupación: ${name}`,
    tags: asStringArray(parsed.tags),
    themes: asStringArray(parsed.themes),
    related_person_names: asStringArray(parsed.related_person_names),
    related_categories: asStringArray(parsed.related_categories),
    inferred_facts: asStringArray(parsed.inferred_facts),
  }
}

function mockAgrupacionMeta(
  name: string,
  notes: string,
  members: string[],
): AgrupacionGeneratedMeta {
  const bullets = notes
    .split(/\n|•|-/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 6)
  return {
    summary: notes.trim()
      ? `Criterio declarado para «${name}».`
      : `Agrupación «${name}» con ${members.length} miembro(s).`,
    tags: name
      .split(/\s+/)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length > 2)
      .slice(0, 4),
    themes: [],
    related_person_names: members.slice(0, 8),
    related_categories: [],
    inferred_facts: bullets.length > 0 ? bullets : emptyAgrupacionMeta().inferred_facts,
  }
}

function parseAgrupacionMetaJson(
  raw: string,
): Partial<AgrupacionGeneratedMeta> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as Partial<AgrupacionGeneratedMeta>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Partial<AgrupacionGeneratedMeta>
      } catch {
        return null
      }
    }
    return null
  }
}

const AGRUPACION_META_PROMPT = `Eres el extractor de metadatos de agrupaciones de Deprocast.
Dado el nombre, miembros y notas, devolvés ÚNICAMENTE un JSON válido (sin markdown):
{
  "summary": string,
  "tags": string[],
  "themes": string[],
  "related_person_names": string[],
  "related_categories": string[],
  "inferred_facts": string[]
}
Idioma: español. No inventes miembros que no estén en la lista.`

export async function extractAgrupacionMeta(input: {
  name: string
  notes: string
  members: string[]
}): Promise<AgrupacionGeneratedMeta> {
  const { name, notes, members } = input

  if (!canCallLlm('fast')) {
    return mockAgrupacionMeta(name, notes, members)
  }

  try {
    const memberList =
      members.length > 0 ? members.map((m) => `- ${m}`).join('\n') : '(sin miembros)'

    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: AGRUPACION_META_PROMPT },
        {
          role: 'user',
          content: `Nombre de la agrupación: ${name}\n\nMiembros:\n${memberList}\n\nNotas del usuario:\n${notes || '(vacío)'}`,
        },
      ],
    })

    const parsed = parseAgrupacionMetaJson(raw)
    return normalizeAgrupacionMeta(parsed, name, notes, members)
  } catch (err) {
    console.error('[cohere/agrupacion] failed, using mock:', err)
    return mockAgrupacionMeta(name, notes, members)
  }
}

function chatSystemPrompt(tipo: ChatTipo): string {
  const mode =
    tipo === 'grupo'
      ? `Modo GRUPO (multifacción): identificá quién propone qué, tensiones, acuerdos cruzados y menciones entre participantes.`
      : `Modo INDIVIDUAL (contacto clave 1:1): foco en relación colaborativa, acuerdos, proyectos compartidos y seguimiento táctico.`

  return `Eres el extractor de chats de Deprocast. Analizás un BLOQUE temporal de conversación (WhatsApp u similar).
${mode}
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "title": string,
  "summary": string,
  "quantomo": string,
  "suggested_weight": number (1-12),
  "entities": [
    {
      "name": string,
      "type": "person" | "project",
      "kind": "fisica" | "juridica" | "ficticia" | "abstracta" | "ruido" (solo person),
      "category": string (solo project),
      "status": "activo" | "pausado" | "cerrado" | "emergente" (solo project)
    }
  ],
  "locations": string[],
  "milestones": string[],
  "actions": [
    { "task_text": string, "tag": "todo" | "hito" | "seguimiento" | string }
  ]
}
Reglas:
- title = 3 a 5 palabras, sin puntuación final.
- summary = 2-4 oraciones del bloque (español).
- quantomo = UNA oración densa: la idea/acuerdo/hito central del bloque.
- suggested_weight = 1-12. Si algún hablador es IA, sugerí 3-5 salvo hito humano fuerte.
- entities = personas nombradas (no remitentes genéricos del propio chat si solo firman) y proyectos creativos/productoras/plataformas (ej. El Fotógrafo, Versa, Studianta, Terreta Hub).
- locations = zonas/ciudades/lugares logísticos mencionados.
- milestones = hitos temporales o entregables (escenas, estrenos, ferias).
- actions = _todos_ accionables del bloque (pocos, reales). tag = todo | hito | seguimiento. Vacío si no hay nada que hacer.
- Omití ruido NER (calles sueltas sin contexto, interjecciones).
- Las líneas prefijadas con [IA] son de un modelo, no de una persona física.
- Solo JSON.`
}

function mockChatExtraction(transcript: string, chatName: string): ChatExtraction {
  const contentLine =
    transcript
      .split('\n')
      .map((l) => l.replace(/^\[[^\]]+\]\s*[^:]+:\s*/, '').trim())
      .find((l) => l && !l.startsWith('<')) || chatName
  return {
    title: clampTitleWords(contentLine, 3, 5, chatName || 'Bloque de chat'),
    summary: `Bloque del chat «${chatName}». ${contentLine}`,
    quantomo: `Hito conversacional en «${chatName}»: ${contentLine}`,
    suggested_weight: 7,
    entities: [],
    locations: [],
    milestones: [],
    actions: [],
  }
}

function normalizeChatExtraction(
  partial: Partial<ChatExtraction> | null,
  transcript: string,
  chatName: string,
): ChatExtraction {
  const fallback = mockChatExtraction(transcript, chatName)
  if (!partial) return fallback
  const entities = Array.isArray(partial.entities)
    ? partial.entities
        .filter(
          (e) =>
            e &&
            typeof e.name === 'string' &&
            e.name.trim() &&
            (e.type === 'person' || e.type === 'project'),
        )
        .map((e) => ({
          name: e.name.trim(),
          type: e.type as 'person' | 'project',
          kind: e.kind,
          category: e.category,
          status: e.status,
        }))
    : []
  const weight =
    typeof partial.suggested_weight === 'number'
      ? Math.max(1, Math.min(12, Math.round(partial.suggested_weight)))
      : 7
  return {
    title: clampTitleWords(
      String(partial.title || fallback.title),
      3,
      5,
      fallback.title,
    ),
    summary: String(partial.summary || fallback.summary).trim(),
    quantomo: String(partial.quantomo || fallback.quantomo).trim(),
    suggested_weight: weight,
    entities,
    locations: Array.isArray(partial.locations)
      ? partial.locations.map(String).filter(Boolean)
      : [],
    milestones: Array.isArray(partial.milestones)
      ? partial.milestones.map(String).filter(Boolean)
      : [],
    actions: Array.isArray(partial.actions)
      ? partial.actions
          .filter(
            (a) =>
              a &&
              typeof a.task_text === 'string' &&
              a.task_text.trim(),
          )
          .map((a) => ({
            task_text: a.task_text.trim(),
            tag: String(a.tag || 'todo').trim() || 'todo',
          }))
      : [],
  }
}

export async function extractFromChatBlock(input: {
  chatName: string
  tipo: ChatTipo
  participantes: string[]
  transcript: string
  dayKey: string
  habladores?: Array<{ remitente: string; person_name: string; is_ai?: boolean }>
  linkedPeople?: string[]
  linkedProjects?: string[]
  linkedEntities?: string[]
  notes?: string
  links?: string[]
}): Promise<ChatExtraction> {
  const { chatName, tipo, participantes, dayKey } = input
  const transcript =
    input.transcript.length > 14000
      ? `${input.transcript.slice(0, 14000)}\n\n[…truncado…]`
      : input.transcript

  if (!canCallLlm('fast')) {
    throw new Error(
      'API key LLM no configurada: no se puede analizar el bloque de chat',
    )
  }

  const plist =
    participantes.length > 0
      ? participantes.map((p) => `- ${p}`).join('\n')
      : '(desconocidos)'

  const habladores =
    (input.habladores ?? [])
      .filter((h) => h.remitente && h.person_name)
      .map((h) =>
        h.is_ai
          ? `- WhatsApp «${h.remitente}» = perfil IA «${h.person_name}»`
          : `- WhatsApp «${h.remitente}» = perfil «${h.person_name}»`,
      )
      .join('\n')
  const hasAiSpeaker = (input.habladores ?? []).some((h) => h.is_ai)
  const peopleCtx = (input.linkedPeople ?? []).filter(Boolean).join(', ')
  const projectCtx = (input.linkedProjects ?? []).filter(Boolean).join(', ')
  const entityCtx = (input.linkedEntities ?? []).filter(Boolean).join(', ')

  const extraCtx = [
    habladores
      ? `Habladores (identidad canónica — usá estos nombres de perfil):\n${habladores}`
      : '',
    hasAiSpeaker
      ? 'Hay al menos un conversante IA: no lo trates como persona física; suggested_weight más bajo salvo hito humano claro.'
      : '',
    peopleCtx ? `Personas vinculadas a este bloque: ${peopleCtx}` : '',
    projectCtx ? `Proyectos vinculados a este bloque: ${projectCtx}` : '',
    entityCtx
      ? `Otras entidades vinculadas a este bloque: ${entityCtx}`
      : '',
    input.notes?.trim()
      ? `Notas HITL de este chat (prioridad alta): ${input.notes.trim()}`
      : '',
    (input.links ?? []).length
      ? `Links extraídos/anclados:\n${(input.links ?? []).map((u) => `- ${u}`).join('\n')}`
      : '',
    'Los habladores listados son de TODA la conversación: usá sus nombres de perfil en el relato.',
    'No los listes como entidades mencionadas solo por estar hablando. Mención = alguien o algo de lo que se habla, no el parlante del día.',
  ]
    .filter(Boolean)
    .join('\n')

  let raw: string
  try {
    const result = await llmChat({
      role: 'fast',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: chatSystemPrompt(tipo) },
        {
          role: 'user',
          content: `Chat: ${chatName}\nTipo: ${tipo}\nJornada: ${dayKey}\nParticipantes del chat:\n${plist}${
            extraCtx ? `\n${extraCtx}` : ''
          }\n\nBloque:\n${transcript}`,
        },
      ],
    })
    raw = result.text || '{}'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cohere/chat]', msg)
    if (/429/.test(msg)) {
      throw new Error(
        'LLM rate limit (429). Esperá un minuto o revisá la key / cuota.',
      )
    }
    throw new Error(`Chat extract falló: ${msg.slice(0, 200)}`)
  }

  let parsed: Partial<ChatExtraction> | null = null
  try {
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()
    parsed = JSON.parse(cleaned) as Partial<ChatExtraction>
  } catch {
    console.error('[cohere/chat] JSON inválido:', raw.slice(0, 400))
    throw new Error('LLM devolvió JSON inválido para el bloque de chat')
  }
  return normalizeChatExtraction(parsed, transcript, chatName)
}

function mockIdaCards(title: string, body: string): DeproIdaCardProposal[] {
  const gist = body.trim().slice(0, 280) || title
  return [
    { question: `¿Qué es «${title}»?`, answer: gist },
    {
      question: `¿En qué etapa o dominio entra «${title}»?`,
      answer: gist,
    },
    {
      question: `¿Qué harías con «${title}» si tuvieras que aplicarlo hoy?`,
      answer: gist,
    },
  ]
}

function parseIdaCardsJson(raw: string): DeproIdaCardProposal[] | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  let parsed = tryParse(cleaned)
  if (!parsed) {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) parsed = tryParse(cleaned.slice(start, end + 1))
  }
  if (!parsed || typeof parsed !== 'object') return null
  const cardsRaw = Array.isArray(parsed)
    ? parsed
    : (parsed as { cards?: unknown }).cards
  if (!Array.isArray(cardsRaw)) return null
  const cards: DeproIdaCardProposal[] = []
  for (const row of cardsRaw) {
    if (!row || typeof row !== 'object') continue
    const question = String(
      (row as { question?: unknown }).question ?? '',
    ).trim()
    const answer = String((row as { answer?: unknown }).answer ?? '').trim()
    if (!question) continue
    cards.push({ question, answer })
    if (cards.length >= 3) break
  }
  return cards.length > 0 ? cards : null
}

export async function proposeIdaCards(
  title: string,
  body: string,
): Promise<DeproIdaCardProposal[]> {
  const fallback = mockIdaCards(title, body)
  if (!canCallLlm('fast')) return fallback

  try {
    const { text: raw } = await llmChat({
      role: 'fast',
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Sos un tutor. Dado un concepto destilado, proponé exactamente 3 flashcards de recall activo: pregunta corta, respuesta precisa. Español. JSON: {"cards":[{"question":"...","answer":"..."}]}. Las preguntas deben obligar a recordar, no a reconocer. Sin cloze, sin markdown.',
        },
        {
          role: 'user',
          content: `Título: ${title}\n\nCuerpo:\n${body || '(vacío)'}`,
        },
      ],
    })
    const parsed = parseIdaCardsJson(raw)
    if (!parsed) return fallback
    while (parsed.length < 3) {
      const extra = fallback[parsed.length]
      if (extra) parsed.push(extra)
      else break
    }
    return parsed.slice(0, 3)
  } catch (err) {
    console.error('[cohere/ida-cards]', err)
    return fallback
  }
}

export type CorpusChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Chat multi-turno con contexto RAG ya armado en `system`.
 * Texto libre (sin json_object).
 */
export async function chatWithCorpus(opts: {
  system: string
  messages: CorpusChatMessage[]
  role?: import('./appSettings.js').LlmRole
}): Promise<string> {
  const { text } = await llmChat({
    role: opts.role ?? 'main',
    temperature: 0.3,
    messages: [
      { role: 'system', content: opts.system },
      ...opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
  })
  if (!text) {
    throw new Error('LLM devolvió respuesta vacía')
  }
  return text
}

export type ChatToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ChatToolTurn =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { role: 'assistant'; content?: string; tool_calls: unknown }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Un turno de chat con tools. No ejecuta las tools:
 * el caller corre el intérprete y reenvía resultados.
 */
export async function chatWithTools(opts: {
  system: string
  messages: ChatToolTurn[]
  tools: ChatToolSpec[]
  temperature?: number
  role?: import('./appSettings.js').LlmRole
}): Promise<{
  text: string
  toolCalls: ChatToolCall[]
  rawAssistant: unknown
}> {
  const result = await llmChat({
    role: opts.role ?? 'main',
    temperature: opts.temperature ?? 0.2,
    tools: opts.tools,
    messages: [
      { role: 'system', content: opts.system },
      ...opts.messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool' as const,
            tool_call_id: m.tool_call_id,
            content: m.content,
          }
        }
        return m
      }),
    ],
  })
  return {
    text: result.text,
    toolCalls: result.toolCalls as ChatToolCall[],
    rawAssistant: result.rawAssistant,
  }
}

export type NotebookL72AtomDraft = {
  power_index: number
  title: string
  content: string
  weight: number
  page_refs?: string[]
}

/** Destila 9 átomos L72 para un dominio (índices base..base+8). */
export async function distillNotebookL72Domain(input: {
  notebookTitle: string
  domainIndex: number
  domainLabel: string
  powerSlots: Array<{
    power_index: number
    visible: string
    oficio: string
  }>
  pageContext: string
  pageQuantomoRefs: Array<{ id: string; title: string; excerpt: string }>
}): Promise<NotebookL72AtomDraft[]> {
  const baseWeight = 8
  const fallback = (): NotebookL72AtomDraft[] =>
    input.powerSlots.map((slot, i) => {
      const ref = input.pageQuantomoRefs[i % Math.max(1, input.pageQuantomoRefs.length)]
      return {
        power_index: slot.power_index,
        title: `${slot.visible} ${input.domainLabel} · ${slot.oficio}`,
        content:
          ref?.excerpt?.slice(0, 500) ||
          `Síntesis L72 del cuaderno «${input.notebookTitle}» para ${input.domainLabel} / ${slot.oficio}.`,
        weight: baseWeight,
        page_refs: ref ? [ref.id] : [],
      }
    })

  if (!canCallLlm('main')) return fallback()

  try {
    const { text: raw } = await llmChat({
      role: 'main',
      temperature: 0.35,
      responseFormat: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Sos el convertidor L72 de cuadernos Deprocast. Dado el contexto de un cuaderno ya procesado (hojas + quántomos por hoja), destilá exactamente ${input.powerSlots.length} átomos de síntesis para el dominio «${input.domainLabel}».
JSON único:
{"atoms":[{"power_index":number,"title":string,"content":string,"weight":number,"page_refs":string[]}]}
Reglas:
- Un átomo por cada power_index listado (no inventes otros índices).
- title corto (≤12 palabras); content 2-5 oraciones en español, sin markdown.
- weight entero 7-10 (síntesis de cuaderno completo).
- page_refs: ids de quántomos-hoja que alimentan el átomo (si aplica).
- No inventes hechos ajenos al contexto. Si el dominio apenas aparece, sintetizá con honestidad (estructura / hueco).
- Solo JSON.`,
        },
        {
          role: 'user',
          content: `Cuaderno: ${input.notebookTitle}
Dominio ${input.domainIndex} · ${input.domainLabel}

Slots a cubrir:
${input.powerSlots
  .map((s) => `- ${s.visible} (index ${s.power_index}): ${s.oficio}`)
  .join('\n')}

Quántomos por hoja (refs):
${input.pageQuantomoRefs
  .slice(0, 40)
  .map((q) => `- [${q.id}] ${q.title}: ${q.excerpt.slice(0, 220)}`)
  .join('\n') || '(ninguno)'}

Contexto de hojas (recortado):
${input.pageContext.slice(0, 12000)}`,
        },
      ],
    })

    const parsed = JSON.parse(
      raw.replace(/```json|```/gi, '').trim(),
    ) as { atoms?: NotebookL72AtomDraft[] }
    const byIndex = new Map<number, NotebookL72AtomDraft>()
    for (const a of parsed.atoms ?? []) {
      const idx = Number(a.power_index)
      if (!Number.isFinite(idx)) continue
      byIndex.set(idx, {
        power_index: idx,
        title: String(a.title || '').trim() || `Poder ${idx + 1}`,
        content: String(a.content || '').trim() || fallback().find((f) => f.power_index === idx)?.content || '',
        weight: Math.max(7, Math.min(10, Math.round(Number(a.weight) || baseWeight))),
        page_refs: Array.isArray(a.page_refs)
          ? a.page_refs.map(String).filter(Boolean).slice(0, 12)
          : [],
      })
    }

    const out: NotebookL72AtomDraft[] = []
    for (const slot of input.powerSlots) {
      out.push(byIndex.get(slot.power_index) ?? fallback().find((f) => f.power_index === slot.power_index)!)
    }
    return out
  } catch (err) {
    console.error('[cohere/notebook-l72] domain failed:', input.domainLabel, err)
    return fallback()
  }
}

