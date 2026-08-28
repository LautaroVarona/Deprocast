export type PerplexityCitation = {
  url: string
  title?: string
  snippet?: string
}

export type PerplexityResearchResult = {
  content: string
  citations: PerplexityCitation[]
  stub: boolean
  model: string
}

import { AppError } from '../errors.js'

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

function timeoutMs(): number {
  const n = Number(env('PERPLEXITY_TIMEOUT_MS', '180000'))
  return Number.isFinite(n) && n > 0 ? n : 180000
}

const PROMPT_BY_KEY: Record<string, string> = {
  explorador: `Actúa como explorador de información. Investiga el tema a fondo con búsqueda web.
Cubre ángulos útiles (contexto, hechos clave, debates, fuentes primarias, riesgos).
Escribe en español, en prosa clara o markdown con headings/bullets.
No inventes URLs: usa solo fuentes reales de tu búsqueda.
Sé denso y útil; el operador filtrará después.`,
  'explorador-academico': `Actúa como explorador académico. Prioriza papers, revisiones, datos primarios y marcos teóricos.
Responde en español (términos técnicos pueden quedar en inglés). Markdown con headings.
No inventes URLs. Sé denso; el operador filtrará después.`,
  'explorador-mercado': `Actúa como explorador de mercado. Prioriza tamaño de mercado, actores, precios, regulación y tendencias.
Responde en español, markdown con headings/bullets. No inventes URLs.
Sé denso y accionable; el operador filtrará después.`,
}

export function systemPromptForAgent(agentId: string, promptKey?: string): string {
  const key = (promptKey || agentId || 'explorador').trim()
  return PROMPT_BY_KEY[key] ?? PROMPT_BY_KEY.explorador
}

function mockResearch(topic: string): PerplexityResearchResult {
  const base = topic.trim() || 'tema'
  const content = [
    `# Investigación (mock): ${base}`,
    '',
    '## Contexto',
    `Resumen simulado sobre «${base}». Sin PERPLEXITY_API_KEY el servidor no llama a Sonar.`,
    '',
    '## Ángulos útiles',
    `- Definición operativa de ${base}.`,
    `- Actores o fuentes típicas relacionadas.`,
    `- Tensiones o debates abiertos.`,
    `- Señales a contrastar antes de asimilar al corpus.`,
    '',
    '## Próximo paso',
    'Configurá PERPLEXITY_API_KEY y volvé a investigar para material real.',
  ].join('\n')

  return {
    content,
    citations: [
      {
        url: 'https://example.com/mock-1',
        title: `Mock fuente 1 — ${base}`,
        snippet: 'Cita simulada para desarrollo local.',
      },
      {
        url: 'https://example.com/mock-2',
        title: `Mock fuente 2 — ${base}`,
        snippet: 'Segunda cita simulada.',
      },
      {
        url: 'https://example.com/mock-3',
        title: `Mock fuente 3 — ${base}`,
        snippet: 'Tercera cita simulada.',
      },
      {
        url: 'https://example.com/mock-4',
        title: `Mock fuente 4 — ${base}`,
        snippet: 'Cuarta cita simulada.',
      },
    ],
    stub: true,
    model: 'mock',
  }
}

function normalizeCitations(raw: unknown): PerplexityCitation[] {
  const out: PerplexityCitation[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) {
        out.push({ url: item.trim() })
        continue
      }
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const url = String(o.url ?? o.link ?? '').trim()
      if (!url) continue
      out.push({
        url,
        title: o.title != null ? String(o.title) : undefined,
        snippet:
          o.snippet != null
            ? String(o.snippet)
            : o.summary != null
              ? String(o.summary)
              : undefined,
      })
    }
  }
  return out
}

export async function researchWithPerplexity(input: {
  topic: string
  agentId?: string
  promptKey?: string
}): Promise<PerplexityResearchResult> {
  const topic = String(input.topic ?? '').trim()
  if (!topic) throw new Error('Tema requerido')

  const apiKey = env('PERPLEXITY_API_KEY')
  const model = env('PERPLEXITY_MODEL', 'sonar-pro') || 'sonar-pro'
  if (!apiKey) {
    throw new AppError(
      'Perplexity no configurado',
      503,
      'CAPABILITY_UNAVAILABLE',
    )
  }

  const system = systemPromptForAgent(
    input.agentId ?? 'explorador',
    input.promptKey,
  )
  const controller = new AbortController()
  const ms = timeoutMs()
  const timer = setTimeout(() => controller.abort(), ms)

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: topic },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `Perplexity HTTP ${res.status}${text ? `: ${text.slice(0, 400)}` : ''}`,
      )
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      citations?: unknown
      search_results?: unknown
    }
    const content = String(data.choices?.[0]?.message?.content ?? '').trim()
    if (!content) throw new Error('Perplexity devolvió contenido vacío')

    const fromCitations = normalizeCitations(data.citations)
    const fromSearch = normalizeCitations(data.search_results)
    const seen = new Set<string>()
    const citations: PerplexityCitation[] = []
    for (const c of [...fromCitations, ...fromSearch]) {
      if (seen.has(c.url)) continue
      seen.add(c.url)
      citations.push(c)
    }

    return { content, citations, stub: false, model }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Perplexity timeout tras ${ms}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
