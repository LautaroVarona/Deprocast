/**
 * Vectores de utilidad: problema que resuelve + TL;DR de arquitectura/casos.
 * Usa el slot LLM de Config (Groq → Ollama). No sella Corpus.
 */
import { canCallLlm, llmChat } from './llmChat.js'
import { parseJsonObject } from './groqExtractor.js'
import { stripReadmeChrome } from './knowledgeStack.js'

export type KnowledgeUtility = {
  summary: string
  utility_problem: string
  architecture_tldr: string
  use_cases: string
}

const SYSTEM = `Sos un analista técnico lacónico. Leés metadatos de un repositorio y un README sin badges.
Respondé SOLO un JSON con estas claves:
- summary: 1-2 frases en español sobre qué es.
- utility_problem: qué problema técnico o humano resuelve (no marketing).
- architecture_tldr: arquitectura y piezas clave (lenguajes, servicios, flujo). Sin emojis ni badges.
- use_cases: 2-4 casos de uso concretos, separados por punto y coma.
Si falta señal, igual inferí con cautela y no inventes APIs que no aparecen.`

export async function generateKnowledgeUtility(input: {
  title: string
  description?: string
  stackTags?: string[]
  languages?: string[]
  readme?: string
}): Promise<KnowledgeUtility | null> {
  if (!canCallLlm('fast') && !canCallLlm('main')) return null
  const readme = stripReadmeChrome(input.readme ?? '').slice(0, 10_000)
  const user = [
    `Título: ${input.title}`,
    input.description ? `Descripción upstream: ${input.description}` : '',
    input.stackTags?.length ? `Stack tags: ${input.stackTags.join(', ')}` : '',
    input.languages?.length ? `Lenguajes: ${input.languages.join(', ')}` : '',
    readme ? `README (limpio):\n${readme}` : 'Sin README.',
  ]
    .filter(Boolean)
    .join('\n')

  const role = canCallLlm('fast') ? 'fast' : 'main'
  try {
    const out = await llmChat({
      role,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    })
    const parsed = parseJsonObject(out.text)
    if (!parsed) return null
    const str = (k: string) =>
      typeof parsed[k] === 'string' ? String(parsed[k]).trim() : ''
    return {
      summary: str('summary'),
      utility_problem: str('utility_problem'),
      architecture_tldr: str('architecture_tldr'),
      use_cases: str('use_cases'),
    }
  } catch (err) {
    console.warn(
      '[knowledge] LLM utilidad falló:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
