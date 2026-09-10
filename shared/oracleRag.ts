/** RAG del Oráculo: corpus sellado + grafo. Sin entries crudas. */

export const ORACLE_SEED_LIMIT = 10
export const ORACLE_QUANTOMO_SNIPPET = 1000
export const ORACLE_ENTITY_SNIPPET = 400

export const ORACLE_RAG_TYPES = ['quantomo', 'person', 'project'] as const

export const NO_EVIDENCE_REPLY =
  'No hay evidencia en el corpus sellado para esa pregunta.'

export type OracleRagMode =
  | 'semantic'
  | 'fts'
  | 'hybrid'
  | 'none'
  | 'embed_down'

export type OracleCitationType = (typeof ORACLE_RAG_TYPES)[number]

export type OracleSourceMeta = {
  entry_id?: string | null
  source_kind?: string | null
  timestamp_exact?: string | null
  locator?: string | null
}

export type OracleCitation = {
  type: OracleCitationType
  id: string
  label: string
} & OracleSourceMeta

export type OracleSeed = {
  type: string
  id: string
  label: string
  snippet: string
  score: number
} & OracleSourceMeta

export type OracleNeighbor = {
  type: string
  id: string
  label: string
  via: string
} & OracleSourceMeta

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

function optStr(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return s ? s : null
}

function sourceMetaFrom(item: OracleSourceMeta): OracleSourceMeta {
  return {
    entry_id: optStr(item.entry_id),
    source_kind: optStr(item.source_kind),
    timestamp_exact: optStr(item.timestamp_exact),
    locator: optStr(item.locator),
  }
}

export function formatOracleSourceLine(meta: OracleSourceMeta): string | null {
  const parts = [
    meta.entry_id ? `entry ${meta.entry_id}` : null,
    meta.source_kind ? meta.source_kind : null,
    meta.timestamp_exact ? meta.timestamp_exact : null,
    meta.locator ? meta.locator : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return `fuente: ${parts.join(' · ')}`
}

export function citationsFromContext(
  seeds: OracleSeed[],
  neighbors: OracleNeighbor[],
): OracleCitation[] {
  const out: OracleCitation[] = []
  const seen = new Set<string>()
  const items: Array<{ type: string; id: string; label: string } & OracleSourceMeta> =
    [
      ...seeds.map((s) => ({
        type: s.type,
        id: s.id,
        label: s.label,
        ...sourceMetaFrom(s),
      })),
      ...neighbors.map((n) => ({
        type: n.type,
        id: n.id,
        label: n.label,
        ...sourceMetaFrom(n),
      })),
    ]
  for (const item of items) {
    if (!ragAllowsObjectType(item.type)) continue
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const meta = sourceMetaFrom(item)
    out.push({
      type: item.type,
      id: item.id,
      label: item.label,
      ...meta,
    })
  }
  return out
}

export function ragModeLabel(
  mode: OracleRagMode,
  embedError?: string | null,
): string {
  if (mode === 'hybrid') {
    return 'Modo: RAG híbrido (FTS + semántico + L72).'
  }
  if (mode === 'semantic') {
    return 'Modo: RAG semántico (corpus sellado + grafo).'
  }
  if (mode === 'fts') {
    return 'Modo: FTS (léxico sobre quántomos sellados).'
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
      : opts.seeds.flatMap((s) => {
          const score =
            Number.isFinite(s.score) ? ` (score ${s.score.toFixed(3)})` : ''
          const head = `- [${s.type}:${s.id}] ${s.label}${score}${s.snippet ? `: ${s.snippet}` : ''}`
          const src = formatOracleSourceLine(s)
          return src ? [head, `  ${src}`] : [head]
        })

  const neighborLines =
    opts.neighbors.length === 0
      ? ['(ninguno)']
      : opts.neighbors.flatMap((n) => {
          const head = `- [${n.type}:${n.id}] ${n.label} (via ${n.via})`
          const src = formatOracleSourceLine(n)
          return src ? [head, `  ${src}`] : [head]
        })

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
      const rec = item as Record<string, unknown>
      const type = String(rec.type ?? '')
      const id = String(rec.id ?? '').trim()
      const label = String(rec.label ?? '').trim()
      if (!ragAllowsObjectType(type) || !id) continue
      out.push({
        type,
        id,
        label: label || id,
        ...sourceMetaFrom({
          entry_id: rec.entry_id as string | null,
          source_kind: rec.source_kind as string | null,
          timestamp_exact: rec.timestamp_exact as string | null,
          locator: rec.locator as string | null,
        }),
      })
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

export function clampUnit(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Fusión de un candidato. Si hay lattice, mismos pesos que
 * `lattice72.hybridScore` (FTS 0.25 · embed 0.40 · L72 0.35).
 */
export function fuseHybridCandidate(opts: {
  ftsScore?: number | null
  embedScore?: number | null
  latticeScore?: number | null
}): number {
  const fts = clampUnit(opts.ftsScore)
  const embed = clampUnit(opts.embedScore)
  const hasFts = opts.ftsScore != null && Number.isFinite(opts.ftsScore)
  const hasEmbed = opts.embedScore != null && Number.isFinite(opts.embedScore)
  const hasLattice =
    opts.latticeScore != null && Number.isFinite(opts.latticeScore)
  if (hasLattice) {
    return fts * 0.25 + embed * 0.4 + clampUnit(opts.latticeScore) * 0.35
  }
  if (hasFts && hasEmbed) return fts * 0.4 + embed * 0.6
  if (hasEmbed) return embed
  if (hasFts) return fts
  return 0
}

export type ScoredHit = {
  id: string
  type: string
  label: string
  score: number
}

/** Fusión de listas para zoom de grafo: unión + Math.max (como persons/search). */
export function mergeHybridHits(
  lexical: ScoredHit[],
  semantic: ScoredHit[],
  limit: number,
): ScoredHit[] {
  const scores = new Map<string, ScoredHit>()
  for (const h of lexical) {
    if (!h.id) continue
    scores.set(h.id, { ...h })
  }
  for (const h of semantic) {
    if (!h.id) continue
    const prev = scores.get(h.id)
    if (!prev) {
      scores.set(h.id, { ...h })
      continue
    }
    scores.set(h.id, {
      ...prev,
      type: prev.type || h.type,
      label: prev.label || h.label,
      score: Math.max(prev.score, h.score),
    })
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

export function bm25ToUnit(rank: number): number {
  if (!Number.isFinite(rank)) return 0.35
  return Math.min(0.85, Math.max(0.35, 0.85 + rank * 0.05))
}
