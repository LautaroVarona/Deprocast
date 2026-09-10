import { getDb } from '../db.js'
import { rows } from '../sql.js'
import { listQuantomosByStage } from './quantomoStages.js'

export const QUANTOMO_EXPORT_STAGES = ['proto', 'pre', 'sealed'] as const
export type QuantomoExportStage = (typeof QUANTOMO_EXPORT_STAGES)[number]

export const QUANTOMO_STAGE_FILE_SLUG: Record<QuantomoExportStage, string> = {
  proto: 'protoquantomos',
  pre: 'prequantomos',
  sealed: 'quantomos',
}

export const QUANTOMO_STAGE_LABEL: Record<QuantomoExportStage, string> = {
  proto: 'Protoquántomos',
  pre: 'Prequántomos',
  sealed: 'Quántomos',
}

export type QuantomoStageCounts = Record<QuantomoExportStage, number>

export function isQuantomoExportStage(v: string): v is QuantomoExportStage {
  return (QUANTOMO_EXPORT_STAGES as readonly string[]).includes(v)
}

export function parseQuantomoExportStage(raw: unknown): QuantomoExportStage | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'quantomo' || s === 'quantomos') return 'sealed'
  if (s === 'prequantomo' || s === 'prequantomos') return 'pre'
  if (s === 'protoquantomo' || s === 'protoquantomos') return 'proto'
  if (isQuantomoExportStage(s)) return s
  return null
}

export function quantomoStageExportBasename(stage: QuantomoExportStage): string {
  const day = new Date().toISOString().slice(0, 10)
  return `deprocast-${QUANTOMO_STAGE_FILE_SLUG[stage]}-${day}`
}

function parseJsonUnknown(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function bufferToB64(value: unknown): { encoding: 'base64'; data: string } | null {
  if (value == null) return null
  if (Buffer.isBuffer(value)) {
    return { encoding: 'base64', data: value.toString('base64') }
  }
  if (value instanceof Uint8Array) {
    return { encoding: 'base64', data: Buffer.from(value).toString('base64') }
  }
  return null
}

export function countQuantomosByStage(): QuantomoStageCounts {
  const db = getDb()
  const counts: QuantomoStageCounts = { proto: 0, pre: 0, sealed: 0 }
  const found = rows<{ stage: string; n: number | bigint }>(
    db
      .prepare(
        `SELECT coalesce(stage, 'proto') AS stage, COUNT(*) AS n
         FROM quantomos
         GROUP BY 1`,
      )
      .all(),
  )
  for (const row of found) {
    const stage = parseQuantomoExportStage(row.stage) ?? 'proto'
    counts[stage] += Number(row.n ?? 0)
  }
  return counts
}

export function dumpQuantomoStage(stage: QuantomoExportStage): {
  format: 'deprocast-quantomos'
  version: 1
  stage: QuantomoExportStage
  label: string
  exported_at: string
  count: number
  quantomos: Array<Record<string, unknown>>
  lattices: Array<Record<string, unknown>>
  entity_links: Array<Record<string, unknown>>
} {
  const db = getDb()
  const quantomos = listQuantomosByStage(stage).map((q) => ({
    id: q.id,
    entry_id: q.entry_id,
    title: q.title,
    content: q.content,
    hermetic_weight: q.hermetic_weight,
    universe: q.universe,
    recognized: q.recognized,
    human_weight: q.human_weight,
    suggested_weight: q.suggested_weight,
    stage: q.stage,
    source_kind: q.source_kind,
    source_id: q.source_id,
    profile: parseJsonUnknown(q.profile_json),
    calendar: parseJsonUnknown(q.calendar_json),
    generation: q.generation,
    entry_title: q.entry_title,
    entry_status: q.entry_status,
    timestamp_exact: q.timestamp_exact,
    original_filename: q.original_filename,
    entry_created_at: q.entry_created_at,
    premium: q.premium,
    lattice_seal: q.lattice_seal,
  }))

  const lattices = rows<{
    quantomo_id: string
    run_id: string | null
    codec: string
    generation: number
    permutation_id: number
    cells: unknown
    seal: string
    premium: number
    domain_energies: string
    updated_at: string
  }>(
    db
      .prepare(
        `SELECT l.quantomo_id, l.run_id, l.codec, l.generation, l.permutation_id,
                l.cells, l.seal, l.premium, l.domain_energies, l.updated_at
         FROM quantomo_lattices l
         JOIN quantomos q ON q.id = l.quantomo_id
         WHERE coalesce(q.stage, 'proto') = ?`,
      )
      .all(stage),
  ).map((l) => ({
    quantomo_id: l.quantomo_id,
    run_id: l.run_id,
    codec: l.codec,
    generation: l.generation,
    permutation_id: l.permutation_id,
    cells: bufferToB64(l.cells),
    seal: l.seal,
    premium: l.premium,
    domain_energies: parseJsonUnknown(l.domain_energies),
    updated_at: l.updated_at,
  }))

  const entity_links = rows<Record<string, unknown>>(
    db
      .prepare(
        `SELECT el.*
         FROM entity_links el
         JOIN quantomos q ON q.id = el.quantomo_id
         WHERE coalesce(q.stage, 'proto') = ?`,
      )
      .all(stage),
  )

  return {
    format: 'deprocast-quantomos',
    version: 1,
    stage,
    label: QUANTOMO_STAGE_LABEL[stage],
    exported_at: new Date().toISOString(),
    count: quantomos.length,
    quantomos,
    lattices,
    entity_links,
  }
}
