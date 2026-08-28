/**
 * Puente de ingesta cognitiva → Aduana (`pending_review`).
 * Toma transcripciones (Deepgram), las serializa en la cola LLM
 * y devuelve JSON forense listo para HITL.
 */
import { AppError } from '../errors.js'
import {
  CognitiveEngine,
  extractKnowledgeDetailed,
  type CognitiveExtraction,
  type CognitiveProvider,
} from '../services/cognitiveEngine.js'
import { groqToCohereExtraction } from '../services/groqExtractor.js'
import type { ExtractDeprocastOpts } from '../services/groqExtractor.js'
import type { CohereExtraction } from '../types.js'

export type IngestTranscriptInput = {
  id?: string
  title?: string
  transcript: string
}

export type AduanaReadyItem = {
  id: string | null
  title: string
  transcript: string
  status: 'pending_review'
  provider: CognitiveProvider | 'empty'
  extraction: CognitiveExtraction
  /** Bundle que ya consume el pipeline / Aduana. */
  bundle: CohereExtraction
  error?: string
}

export type ProcessTranscriptsOptions = ExtractDeprocastOpts & {
  engine?: CognitiveEngine
}

function asInputs(
  transcripts: Array<string | IngestTranscriptInput>,
): IngestTranscriptInput[] {
  return transcripts.map((item, index) => {
    if (typeof item === 'string') {
      return { title: `Nota ${index + 1}`, transcript: item }
    }
    return {
      id: item.id,
      title: item.title?.trim() || `Nota ${index + 1}`,
      transcript: item.transcript,
    }
  })
}

async function runOne(
  input: IngestTranscriptInput,
  opts: ProcessTranscriptsOptions,
): Promise<AduanaReadyItem> {
  const title = input.title?.trim() || 'Nota de voz'
  const empty: CognitiveExtraction = {
    quantomos: [],
    acciones: [],
    entidades: [],
  }
  try {
    const result = opts.engine
      ? await opts.engine.extractKnowledge(input.transcript, opts)
      : await extractKnowledgeDetailed(input.transcript, opts)
    return {
      id: input.id ?? null,
      title,
      transcript: input.transcript,
      status: 'pending_review',
      provider: result.provider,
      extraction: result.extraction,
      bundle: groqToCohereExtraction(result.extraction, title),
    }
  } catch (err) {
    const msg = err instanceof AppError ? err.message : err instanceof Error ? err.message : String(err)
    console.error('[ingest/cognitive] item falló, Aduana vacía:', msg.slice(0, 240))
    return {
      id: input.id ?? null,
      title,
      transcript: input.transcript,
      status: 'pending_review',
      provider: 'empty',
      extraction: empty,
      bundle: groqToCohereExtraction(empty, title),
      error: msg.slice(0, 240),
    }
  }
}

/**
 * Procesa N transcripciones a través del motor cognitivo (cola serial).
 * Cada ítem sale con `status: pending_review` aunque la inferencia falle
 * (extracción vacía) para no tumbar el lote.
 */
export async function processTranscripts(
  transcripts: Array<string | IngestTranscriptInput>,
  opts: ProcessTranscriptsOptions = {},
): Promise<AduanaReadyItem[]> {
  const inputs = asInputs(transcripts)
  return Promise.all(inputs.map((input) => runOne(input, opts)))
}

export async function processTranscript(
  transcript: string,
  opts: ProcessTranscriptsOptions = {},
): Promise<AduanaReadyItem> {
  const [item] = await processTranscripts([transcript], opts)
  return item!
}
