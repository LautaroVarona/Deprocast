/** RAG del Oráculo: corpus sellado + grafo. Sin entries crudas. */

export const ORACLE_SEED_LIMIT = 10
export const ORACLE_QUANTOMO_SNIPPET = 1000
export const ORACLE_ENTITY_SNIPPET = 400

export const ORACLE_RAG_TYPES = ['quantomo', 'person', 'project'] as const

export const NO_EVIDENCE_REPLY =
  'No hay evidencia en el corpus sellado para esa pregunta.'

export type OracleRagMode = 'semantic' | 'fts' | 'none' | 'embed_down'

export type OracleCitationType = (typeof ORACLE_RAG_TYPES)[number]

export type OracleCitation = {
  type: OracleCitationType
  id: string
  label: string
}

export type OracleSeed = {
  type: string
  id: string
  label: string
  snippet: string
  score: number
}

export type OracleNeighbor = {
  type: string
  id: string
  label: string
  via: string
}

export function isSealedQuantomoForRag(
  recognized: number,
  stage: string | null | undefined,
): boolean {
  return recognized === 1 && (stage ?? 'proto') === 'sealed'
}

export function ragAllowsObjectType(type: string): type is OracleCitationType {
  return type === 'quantomo' || type === 'person' || type === 'project'
}

export function hasOracleEvidence(
  seeds: OracleSeed[],
  neighbors: OracleNeighbor[],
): boolean {
  return (
    seeds.some((s) => ragAllowsObjectType(s.type)) ||
    neighbors.some((n) => ragAllowsObjectType(n.type))
  )
}

export function citationsFromContext(
  seeds: OracleSeed[],
  neighbors: OracleNeighbor[],
): OracleCitation[] {
  const out: OracleCitation[] = []
  const seen = new Set<string>()
  for (const item of [
    ...seeds.map((s) => ({ type: s.type, id: s.id, label: s.label })),
    ...neighbors.map((n) => ({ type: n.type, id: n.id, label: n.label })),
  ]) {
    if (!ragAllowsObjectType(item.type)) continue
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: item.type, id: item.id, label: item.label })
  }
  return out
}

export function ragModeLabel(
  mode: OracleRagMode,
  embedError?: string | null,
): string {
  if (mode === 'semantic') {
    return 'Modo: RAG semántico (corpus sellado + grafo).'
  }
  if (mode === 'fts') {
    return 'Modo: FTS (fallback léxico sobre quántomos sellados).'
  }
  if (mode === 'embed_down') {
    return `Modo: embed caído${embedError ? ` (${embedError})` : ''}.`
  }
  return 'Modo: sin evidencia.'
}

export function formatOracleGraphBlock(opts: {
  mode: OracleRagMode
  embedError?: string | null
  seeds: OracleSeed[]
  neighbors: OracleNeighbor[]
}): string {
  const seedLines =
    opts.seeds.length === 0
      ? ['(ningún nodo semántico cercano)']
      : opts.seeds.map((s) => {
          const score =
            Number.isFinite(s.score) ? ` (score ${s.score.toFixed(3)})` : ''
          return `- [${s.type}:${s.id}] ${s.label}${score}${s.snippet ? `: ${s.snippet}` : ''}`
        })

  const neighborLines =
    opts.neighbors.length === 0
      ? ['(ninguno)']
      : opts.neighbors.map(
          (n) => `- [${n.type}:${n.id}] ${n.label} (via ${n.via})`,
        )

  return [
    ragModeLabel(opts.mode, opts.embedError),
    '',
    '## Seeds',
    ...seedLines,
    '',
    '## Neighbors',
    ...neighborLines,
  ].join('\n')
}

export function parseCitationsJson(
  raw: string | null | undefined,
): OracleCitation[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: OracleCitation[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const type = String((item as { type?: unknown }).type ?? '')
      const id = String((item as { id?: unknown }).id ?? '').trim()
      const label = String((item as { label?: unknown }).label ?? '').trim()
      if (!ragAllowsObjectType(type) || !id) continue
      out.push({ type, id, label: label || id })
    }
    return out
  } catch {
    return []
  }
}

export function buildOracleFtsQuery(raw: string): string | null {
  const tokens = raw
    .replace(/["']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((t) => t.replace(/[^a-z0-9áéíóúüñ]/gi, ''))
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return null
  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `${t}*` : t))
    .join(' ')
}
