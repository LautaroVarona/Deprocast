import { analyzeNotebookPage } from './cohere.js'
import { canCallLlm, listVisionRoutes } from './appSettings.js'
import { analyzeNotebookPageLocal } from './localOcr.js'
import {
  ocrBackend,
  tryUnlimitedOcrImage,
  notebookResultFromOcr,
} from './unlimitedOcr.js'
import { envNumber } from '../config.js'
import type { NotebookPageVisionResult } from '../types.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number }).status
}

function isRetryableVisionLimit(err: unknown): boolean {
  const status = errorStatus(err)
  const msg = err instanceof Error ? err.message : String(err)
  return (
    status === 429 ||
    /429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg)
  )
}

async function analyzeNotebookPageWithBackoff(
  imageAbsPath: string,
): Promise<NotebookPageVisionResult> {
  const retries = Math.max(0, envNumber('VISION_429_RETRIES', 4))
  const baseMs = Math.max(500, envNumber('VISION_BACKOFF_BASE_MS', 2000))
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await analyzeNotebookPage(imageAbsPath)
    } catch (err) {
      lastErr = err
      if (!isRetryableVisionLimit(err) || attempt === retries) throw err
      const wait = Math.min(60_000, baseMs * 2 ** attempt)
      console.warn(
        `[notebook-ocr] 429/cuota, reintento ${attempt + 1}/${retries} en ${Math.round(wait / 1000)}s (sin OCR local todavía)`,
      )
      await sleep(wait)
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Visión falló tras reintentos')
}

export async function ocrNotebookPage(
  imageAbsPath: string,
): Promise<NotebookPageVisionResult> {
  const backend = ocrBackend()
  const errors: string[] = []

  if (backend === 'local') {
    const local = await analyzeNotebookPageLocal(imageAbsPath)
    if (local) return local
    throw new Error(
      'NOTEBOOK_OCR_BACKEND=local pero no hay Tesseract ni Windows OCR',
    )
  }

  if (backend !== 'cohere' && backend !== 'gemini') {
    try {
      const raw = await tryUnlimitedOcrImage(imageAbsPath, 'gundam')
      if (raw) {
        const result = notebookResultFromOcr(raw)
        if (!result.is_blank || backend === 'unlimited') return result
      } else if (backend === 'unlimited') {
        return notebookResultFromOcr('')
      }
    } catch (err) {
      if (backend === 'unlimited') throw err
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Unlimited-OCR: ${msg}`)
      console.warn('[notebook-ocr] Unlimited-OCR falló:', msg)
    }
  }

  if (canCallLlm('vision') || listVisionRoutes().length > 0) {
    try {
      return await analyzeNotebookPageWithBackoff(imageAbsPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`LLM visión: ${msg}`)
      console.warn('[notebook-ocr] LLM visión falló, intento OCR local:', msg)
    }
  }

  const local = await analyzeNotebookPageLocal(imageAbsPath)
  if (local) return local
  errors.push('OCR local: sin Tesseract (PATH/TESSERACT_PATH) ni Windows OCR')

  throw new Error(
    `No hay backend de visión usable. Poné GEMINI_API_KEY (Google AI Studio) o GROQ_API_KEY en .env. ${errors.join(' · ')}`,
  )
}
