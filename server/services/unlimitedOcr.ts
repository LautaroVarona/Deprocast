import fs from 'node:fs'
import path from 'node:path'
import type {
  GraphicElement,
  NotebookPageVisionResult,
} from '../types.js'
import { clampTitleWords } from './titleUtils.js'

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

export type OcrImageMode = 'gundam' | 'base'

export function ocrBackend(): 'auto' | 'unlimited' | 'cohere' {
  const raw = env('NOTEBOOK_OCR_BACKEND', 'auto').toLowerCase()
  if (raw === 'unlimited' || raw === 'cohere') return raw
  return 'auto'
}

export function unlimitedOcrUrl(): string {
  return env('UNLIMITED_OCR_URL').replace(/\/+$/, '')
}

export function unlimitedOcrConfigured(): boolean {
  return Boolean(unlimitedOcrUrl())
}

function modelName(): string {
  return env('UNLIMITED_OCR_MODEL', 'baidu/Unlimited-OCR')
}

function requestTimeoutMs(): number {
  return Number(env('UNLIMITED_OCR_TIMEOUT_MS', '1200000')) || 1_200_000
}

let sidecarCache: { at: number; ok: boolean } | null = null

async function probeSidecar(): Promise<boolean> {
  const base = unlimitedOcrUrl()
  if (!base) return false
  if (sidecarCache && Date.now() - sidecarCache.at < 30_000) {
    return sidecarCache.ok
  }
  const modelsUrl = base.endsWith('/v1')
    ? `${base}/models`
    : `${base}/v1/models`
  try {
    const res = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(3000),
    })
    sidecarCache = { at: Date.now(), ok: res.ok }
  } catch {
    sidecarCache = { at: Date.now(), ok: false }
  }
  return sidecarCache.ok
}

function mimeForPath(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function encodeImageDataUrl(absPath: string): string {
  const buf = fs.readFileSync(absPath)
  const mime = mimeForPath(absPath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

const DET_RE =
  /<\|det\|>([^\s<]+)(?:\s*\[([^\]]*)\])?\s*<\|\/det\|>(.*)/s

export function stripOcrMarkup(raw: string): string {
  let text = raw.replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, '')
  text = text.replace(/<\|ref\|>([\s\S]*?)<\|\/ref\|>/g, '$1')
  text = text.replace(/<\|[^|]+\|>/g, '')
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseBBox(
  raw: string | undefined,
): [number, number, number, number] | null {
  if (!raw) return null
  const nums = raw
    .split(/[,\s]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  if (nums.length < 4) return null
  let [x1, y1, x2, y2] = nums
  const max = Math.max(x1, y1, x2, y2, 1)
  if (max > 1.5) {
    const den = max > 100 ? 999 : max
    x1 /= den
    y1 /= den
    x2 /= den
    y2 /= den
  }
  const x = Math.min(1, Math.max(0, Math.min(x1, x2)))
  const y = Math.min(1, Math.max(0, Math.min(y1, y2)))
  const w = Math.min(1, Math.max(0, Math.abs(x2 - x1)))
  const h = Math.min(1, Math.max(0, Math.abs(y2 - y1)))
  return [x, y, w, h]
}

function mapDetType(type: string): GraphicElement['type'] | null {
  const t = type.toLowerCase()
  if (t === 'table' || t === 'table_caption') return 'table'
  if (t === 'image' || t === 'figure' || t === 'picture' || t === 'chart') {
    return 'drawing'
  }
  if (t === 'formula' || t === 'equation' || t === 'seal') return 'shape'
  if (t === 'line' || t === 'separator') return 'line'
  return null
}

function parseMarkdownTable(block: string): string[][] | null {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
  if (lines.length < 2) return null
  const rows: string[][] = []
  for (const line of lines) {
    if (/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, '').trim())) continue
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.some((c) => c)) rows.push(cells)
  }
  return rows.length > 0 ? rows : null
}

export function graphicElementsFromOcr(raw: string): GraphicElement[] {
  const elements: GraphicElement[] = []
  for (const line of raw.split(/\r?\n/)) {
    const m = DET_RE.exec(line.trim())
    if (!m) continue
    const type = mapDetType(m[1])
    if (!type) continue
    const bbox = parseBBox(m[2]) ?? [0, 0, 1, 1]
    const content = (m[3] || '').trim()
    const el: GraphicElement = {
      type,
      bbox,
      label: content.slice(0, 240) || m[1],
    }
    if (type === 'table') {
      const table = parseMarkdownTable(content)
      if (table) el.table = { rows: table }
    }
    elements.push(el)
  }
  return elements
}

function titleFromTranscription(text: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)
  const first = (heading?.[1] || text.split('\n').find((l) => l.trim()) || '')
    .replace(/^#+\s*/, '')
    .trim()
  if (!first) return 'Hoja sin título'
  return clampTitleWords(first, 2, 6, 'Hoja sin título')
}

export function notebookResultFromOcr(
  raw: string,
): NotebookPageVisionResult {
  const transcription = stripOcrMarkup(raw)
  const is_blank = transcription.length < 8
  return {
    title: is_blank ? 'Sin título' : titleFromTranscription(transcription),
    transcription_spatial: transcription,
    graphic_elements: graphicElementsFromOcr(raw),
    is_blank,
    meta: {
      layout: 'unknown',
      notes: 'unlimited-ocr',
    },
  }
}

type ChatContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

async function chatOcr(
  prompt: string,
  imagePaths: string[],
  opts: { mode: OcrImageMode; ngramWindow: number },
): Promise<string> {
  const base = unlimitedOcrUrl()
  if (!base) throw new Error('UNLIMITED_OCR_URL no está configurada')
  const url = base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`

  const content: ChatContent[] = [{ type: 'text', text: prompt }]
  for (const imagePath of imagePaths) {
    content.push({
      type: 'image_url',
      image_url: { url: encodeImageDataUrl(imagePath) },
    })
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(requestTimeoutMs()),
    body: JSON.stringify({
      model: modelName(),
      messages: [{ role: 'user', content }],
      temperature: 0,
      max_tokens: 8192,
      skip_special_tokens: false,
      extra_body: {
        skip_special_tokens: false,
        vllm_xargs: { ngram_size: 35, window_size: opts.ngramWindow },
        images_config: { image_mode: opts.mode },
      },
      vllm_xargs: { ngram_size: 35, window_size: opts.ngramWindow },
      images_config: { image_mode: opts.mode },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(
      `Unlimited-OCR ${res.status}: ${errText.slice(0, 400)}`,
    )
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const contentOut = data.choices?.[0]?.message?.content
  if (typeof contentOut === 'string') return contentOut
  if (Array.isArray(contentOut)) {
    return contentOut
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text || '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

export async function ocrImage(
  imageAbsPath: string,
  mode: OcrImageMode = 'gundam',
): Promise<string> {
  if (!fs.existsSync(imageAbsPath)) {
    throw new Error(`Imagen no encontrada: ${imageAbsPath}`)
  }
  const prompt =
    mode === 'base'
      ? '<image>Multi page parsing.'
      : '<image>document parsing.'
  const windowSize = mode === 'base' ? 1024 : 128
  return chatOcr(prompt, [imageAbsPath], { mode, ngramWindow: windowSize })
}

export async function ocrImages(imageAbsPaths: string[]): Promise<string> {
  if (imageAbsPaths.length === 0) return ''
  if (imageAbsPaths.length === 1) return ocrImage(imageAbsPaths[0], 'gundam')
  return chatOcr('<image>Multi page parsing.', imageAbsPaths, {
    mode: 'base',
    ngramWindow: 1024,
  })
}

export async function tryUnlimitedOcrImage(
  imageAbsPath: string,
  mode: OcrImageMode = 'gundam',
): Promise<string | null> {
  const backend = ocrBackend()
  if (backend === 'cohere') return null
  if (!unlimitedOcrConfigured()) {
    if (backend === 'unlimited') {
      throw new Error('NOTEBOOK_OCR_BACKEND=unlimited pero falta UNLIMITED_OCR_URL')
    }
    return null
  }
  const up = await probeSidecar()
  if (!up) {
    if (backend === 'unlimited') {
      throw new Error('Unlimited-OCR no responde en UNLIMITED_OCR_URL')
    }
    return null
  }
  try {
    const raw = await ocrImage(imageAbsPath, mode)
    const cleaned = stripOcrMarkup(raw)
    if (!cleaned) return null
    return raw
  } catch (err) {
    if (backend === 'unlimited') throw err
    console.warn(
      '[unlimited-ocr] fallo, se usa fallback:',
      err instanceof Error ? err.message : err,
    )
    sidecarCache = { at: Date.now(), ok: false }
    return null
  }
}

export async function analyzeNotebookPageUnlimited(
  imageAbsPath: string,
): Promise<NotebookPageVisionResult> {
  const raw = await ocrImage(imageAbsPath, 'gundam')
  return notebookResultFromOcr(raw)
}

export async function ocrVideoFrameIfEnabled(
  imageAbsPath: string,
): Promise<string | null> {
  const raw = await tryUnlimitedOcrImage(imageAbsPath, 'gundam')
  if (!raw) return null
  const cleaned = stripOcrMarkup(raw)
  return cleaned || null
}
