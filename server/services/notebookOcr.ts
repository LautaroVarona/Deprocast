import { analyzeNotebookPage } from './cohere.js'
import {
  ocrBackend,
  tryUnlimitedOcrImage,
  notebookResultFromOcr,
} from './unlimitedOcr.js'
import type { NotebookPageVisionResult } from '../types.js'

export async function ocrNotebookPage(
  imageAbsPath: string,
): Promise<NotebookPageVisionResult> {
  const backend = ocrBackend()
  if (backend !== 'cohere') {
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
      console.warn(
        '[notebook-ocr] Unlimited-OCR falló, fallback Cohere Vision:',
        err instanceof Error ? err.message : err,
      )
    }
  }
  return analyzeNotebookPage(imageAbsPath)
}
