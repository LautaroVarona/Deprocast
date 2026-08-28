import { randomUUID } from 'node:crypto'
import { getDb, getTrincheraNotebookId } from '../db.js'
import { row, rows } from '../sql.js'
import { maxQuantomosForWeight } from './audioCriba.js'
import { extractFromChatBlock } from './cohere.js'
import { enqueueEmbed, embedApprovedEntry } from './embeddings.js'
import { createEntityProposalsFromEntry } from './entityMatch.js'
import {
  L72_CODEC,
  L72_FLAG_HAS_AI,
  L72_FLAG_SEALED,
  bufferToCells,
  clampWeight,
  decodeLattice,
  latticeToPacket,
  resonance,
  sealLattice,
  type LatticeSourceKind,
  type QuantomoStage,
  type SealedLattice,
} from './lattice72.js'
import { getCurrentRun } from './run.js'

export type QuantomoStageRow = {
  id: string
  entry_id: string
  title: string
  content: string | null
  hermetic_weight: number | null
  universe: string | null
  recognized: number
  human_weight: number | null
  suggested_weight: number | null
  stage: QuantomoStage
  source_kind: string | null
  source_id: string | null
  profile_json: string | null
  calendar_json: string | null
  generation: number
  entry_title: string
  entry_status: string
  timestamp_exact: string | null
  original_filename: string | null
  entry_created_at: string
  premium: number | null
  lattice_seal: string | null
}

const STAGE_SELECT = `
  SELECT q.id, q.entry_id, q.title, q.content, q.hermetic_weight,
         q.universe, q.recognized, q.human_weight, q.suggested_weight,
         coalesce(q.stage, 'proto') AS stage,
         q.source_kind, q.source_id, q.profile_json, q.calendar_json,
         coalesce(q.generation, 0) AS generation,
         e.title AS entry_title, e.status AS entry_status,
         e.timestamp_exact, e.original_filename,
         e.created_at AS entry_created_at,
         l.premium AS premium, l.seal AS lattice_seal
  FROM quantomos q
  JOIN entries e ON e.id = q.entry_id
  LEFT JOIN quantomo_lattices l ON l.quantomo_id = q.id
`

export function listQuantomosByStage(
  stage?: QuantomoStage | 'premium' | 'all',
): QuantomoStageRow[] {
  const db = getDb()
  if (stage === 'premium') {
    return rows<QuantomoStageRow>(
      db
        .prepare(
          `${STAGE_SELECT}
           WHERE coalesce(q.stage, 'proto') = 'sealed' AND l.premium = 1
           ORDER BY q.hermetic_weight DESC, e.created_at DESC`,
        )
        .all(),
    )
  }
  if (stage && stage !== 'all') {
    return rows<QuantomoStageRow>(
      db
        .prepare(
          `${STAGE_SELECT}
           WHERE coalesce(q.stage, 'proto') = ?
           ORDER BY q.hermetic_weight DESC, e.created_at DESC`,
        )
        .all(stage),
    )
  }
  return rows<QuantomoStageRow>(
    db
      .prepare(
        `${STAGE_SELECT}
         ORDER BY q.hermetic_weight DESC, e.created_at DESC`,
      )
      .all(),
  )
}

export function chestSnapshot(): {
  open_threads: Array<{
    id: string
    title: string
    updated_at: string
    status: string
    hermetic_weight: number | null
  }>
  proto: QuantomoStageRow[]
  pre: QuantomoStageRow[]
  sealed: number
  premium: number
} {
  const db = getDb()
  const open_threads = rows<{
    id: string
    title: string
    updated_at: string
    status: string
    hermetic_weight: number | null
  }>(
    db
      .prepare(
        `SELECT id, title, updated_at,
                coalesce(status, 'open') AS status,
                hermetic_weight
         FROM dialogo_threads
         WHERE coalesce(status, 'open') = 'open'
         ORDER BY updated_at DESC
         LIMIT 40`,
      )
      .all(),
  )
  return {
    open_threads,
    proto: listQuantomosByStage('proto'),
    pre: listQuantomosByStage('pre'),
    sealed: listQuantomosByStage('sealed').length,
    premium: listQuantomosByStage('premium').length,
  }
}

function currentRunId(): string {
  return getCurrentRun()?.id ?? 'local-run'
}

function amazonaIndex(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0
  return h % 72
}

function graphDegree(quantomoId: string, entryId: string): number {
  const db = getDb()
  const n = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM entity_links
         WHERE quantomo_id = ? OR entry_id = ?`,
      )
      .get(quantomoId, entryId),
  )
  return n?.c ?? 0
}

function parseObj(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseArr(raw: string | null): number[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map((n) => Number(n) || 0) : []
  } catch {
    return []
  }
}

export function promoteToPre(
  quantomoId: string,
  patch?: {
    universe?: string | null
    profile?: Record<string, unknown>
    calendar?: Record<string, unknown>
  },
): QuantomoStageRow {
  const db = getDb()
  const q = row<{
    id: string
    entry_id: string
    stage: string | null
    universe: string | null
    profile_json: string | null
    calendar_json: string | null
  }>(
    db
      .prepare(
        `SELECT id, entry_id, stage, universe, profile_json, calendar_json
         FROM quantomos WHERE id = ?`,
      )
      .get(quantomoId),
  )
  if (!q) throw new Error('Quántomo no encontrado')
  if ((q.stage ?? 'proto') === 'sealed') {
    throw new Error('Un quántomo sellado no vuelve a pre')
  }

  const universe = patch?.universe !== undefined ? patch.universe : q.universe
  const profile = { ...parseObj(q.profile_json), ...(patch?.profile ?? {}) }
  const calendar = { ...parseObj(q.calendar_json), ...(patch?.calendar ?? {}) }

  db.prepare(
    `UPDATE quantomos
     SET stage = 'pre', recognized = 0, universe = ?,
         profile_json = ?, calendar_json = ?
     WHERE id = ?`,
  ).run(universe, JSON.stringify(profile), JSON.stringify(calendar), quantomoId)

  createEntityProposalsFromEntry(db, q.entry_id)
  const out = listQuantomosByStage('pre').find((x) => x.id === quantomoId)
  if (!out) throw new Error('No se pudo leer el prequántomo')
  return out
}

export function sealQuantomo(quantomoId: string): QuantomoStageRow {
  const db = getDb()
  const q = row<{
    id: string
    entry_id: string
    title: string
    content: string | null
    hermetic_weight: number | null
    human_weight: number | null
    suggested_weight: number | null
    universe: string | null
    stage: string | null
    source_kind: string | null
    generation: number | null
    profile_json: string | null
  }>(
    db
      .prepare(
        `SELECT id, entry_id, title, content, hermetic_weight, human_weight,
                suggested_weight, universe, stage, source_kind, generation,
                profile_json
         FROM quantomos WHERE id = ?`,
      )
      .get(quantomoId),
  )
  if (!q) throw new Error('Quántomo no encontrado')
  if ((q.stage ?? 'proto') === 'proto') {
    throw new Error('Pasá por Campamento (proto → pre) antes de sellar')
  }

  const entry = row<{ timestamp_exact: string | null; created_at: string }>(
    db
      .prepare(`SELECT timestamp_exact, created_at FROM entries WHERE id = ?`)
      .get(q.entry_id),
  )

  const generation = Math.max(1, Number(q.generation ?? 0) + 1)
  const runId = currentRunId()
  const profile = parseObj(q.profile_json)
  const flags =
    L72_FLAG_SEALED | (profile.has_ai ? L72_FLAG_HAS_AI : 0)
  const lattice = sealLattice({
    quantomoId: q.id,
    runId,
    generation,
    meta: {
      source_kind: (q.source_kind ?? 'manual') as LatticeSourceKind,
      title: q.title,
      content: q.content ?? '',
      universe: q.universe,
      hermetic_weight: q.hermetic_weight ?? 7,
      human_weight: q.human_weight,
      suggested_weight: q.suggested_weight,
      timestamp_iso: entry?.timestamp_exact ?? entry?.created_at ?? null,
      amazona_index: amazonaIndex(q.id),
      graph_degree: graphDegree(q.id, q.entry_id),
      flags,
      embed_sketch: [],
    },
  })

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE quantomos
       SET stage = 'sealed', recognized = 1, generation = ?
       WHERE id = ?`,
    ).run(generation, q.id)
    db.prepare(
      `INSERT INTO quantomo_lattices (
         quantomo_id, run_id, codec, generation, permutation_id,
         cells, seal, premium, domain_energies, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(quantomo_id) DO UPDATE SET
         run_id = excluded.run_id,
         codec = excluded.codec,
         generation = excluded.generation,
         permutation_id = excluded.permutation_id,
         cells = excluded.cells,
         seal = excluded.seal,
         premium = excluded.premium,
         domain_energies = excluded.domain_energies,
         updated_at = excluded.updated_at`,
    ).run(
      q.id,
      runId,
      L72_CODEC,
      generation,
      lattice.permutation_id,
      lattice.cells,
      lattice.seal,
      lattice.premium,
      JSON.stringify(lattice.domain_energies),
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  enqueueEmbed(() => embedApprovedEntry(q.entry_id))

  // Rellenar entity_links sin quantomo (menciones/NER previos al átomo)
  db.prepare(
    `UPDATE entity_links SET quantomo_id = ?
     WHERE entry_id = ? AND (quantomo_id IS NULL OR quantomo_id = '')`,
  ).run(q.id, q.entry_id)

  const out = listQuantomosByStage('sealed').find((x) => x.id === q.id)
  if (!out) throw new Error('No se pudo leer el quántomo sellado')
  return out
}

export function getLatticeView(quantomoId: string): {
  quantomo: QuantomoStageRow
  packet: Record<string, unknown> | null
  canonical: number[] | null
  domain_energies: number[]
  seal_ok: boolean
} {
  const db = getDb()
  const q = listQuantomosByStage('all').find((x) => x.id === quantomoId)
  if (!q) throw new Error('Quántomo no encontrado')
  const lat = row<{
    cells: Buffer
    seal: string
    generation: number
    permutation_id: number
    premium: number
    domain_energies: string
    run_id: string
  }>(
    db
      .prepare(`SELECT * FROM quantomo_lattices WHERE quantomo_id = ?`)
      .get(quantomoId),
  )
  if (!lat) {
    return {
      quantomo: q,
      packet: null,
      canonical: null,
      domain_energies: [],
      seal_ok: false,
    }
  }
  const sealed = {
    codec: L72_CODEC,
    generation: lat.generation,
    permutation_id: lat.permutation_id,
    cells: Buffer.from(lat.cells),
    seal: lat.seal,
    premium: lat.premium,
    domain_energies: parseArr(lat.domain_energies),
  } as SealedLattice
  const decoded = decodeLattice(sealed, quantomoId, lat.run_id || currentRunId())
  return {
    quantomo: q,
    packet: latticeToPacket(quantomoId, sealed, {
      title: q.title,
      content: q.content,
    }),
    canonical: decoded.canonical ? Array.from(decoded.canonical) : null,
    domain_energies: sealed.domain_energies,
    seal_ok: decoded.ok,
  }
}

export function resonateQuantomo(
  quantomoId: string,
  limit = 8,
): Array<{ id: string; title: string; score: number; stage: string }> {
  const db = getDb()
  const self = row<{ cells: Buffer; hermetic_weight: number | null }>(
    db
      .prepare(
        `SELECT l.cells, q.hermetic_weight
         FROM quantomo_lattices l
         JOIN quantomos q ON q.id = l.quantomo_id
         WHERE l.quantomo_id = ?`,
      )
      .get(quantomoId),
  )
  if (!self) return []
  const a = bufferToCells(Buffer.from(self.cells))
  const others = rows<{
    id: string
    title: string
    cells: Buffer
    hermetic_weight: number | null
    stage: string | null
  }>(
    db
      .prepare(
        `SELECT q.id, q.title, l.cells, q.hermetic_weight, q.stage
         FROM quantomo_lattices l
         JOIN quantomos q ON q.id = l.quantomo_id
         WHERE q.id != ? AND coalesce(q.stage, '') = 'sealed'`,
      )
      .all(quantomoId),
  )
  return others
    .map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage ?? 'sealed',
      score: resonance(
        a,
        bufferToCells(Buffer.from(o.cells)),
        o.hermetic_weight ?? self.hermetic_weight ?? 7,
      ),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.max(1, Math.min(24, limit)))
}

export async function closeDialogoThread(
  threadId: string,
  hermeticWeight: number,
  opts?: { title?: string },
): Promise<{
  thread_id: string
  entry_id: string
  weight: number
  proto: Array<{ id: string; title: string }>
}> {
  const db = getDb()
  const thread = row<{
    id: string
    title: string
    status: string | null
  }>(db.prepare(`SELECT * FROM dialogo_threads WHERE id = ?`).get(threadId))
  if (!thread) throw new Error('Hilo no encontrado')
  if ((thread.status ?? 'open') === 'closed') {
    throw new Error('El hilo ya está cerrado')
  }

  const weight = clampWeight(hermeticWeight)
  const cap = maxQuantomosForWeight(weight)
  const messages = rows<{ role: string; content: string }>(
    db
      .prepare(
        `SELECT role, content FROM dialogo_messages
         WHERE thread_id = ? ORDER BY created_at ASC`,
      )
      .all(threadId),
  )
  if (messages.length === 0) {
    throw new Error('Hilo vacío: no hay nada que destilar')
  }

  const transcript = messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n')
  const title = (opts?.title ?? thread.title).trim() || thread.title

  const extraction = await extractFromChatBlock({
    chatName: title,
    tipo: 'individual',
    participantes: ['operador', 'oraculo'],
    transcript,
    dayKey: new Date().toISOString().slice(0, 10),
  })

  const now = new Date().toISOString()
  const entryId = randomUUID()
  const notebookId = getTrincheraNotebookId()
  const atoms = [
    {
      title: extraction.title,
      content: extraction.quantomo || extraction.summary,
    },
  ]

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO entries (
        id, notebook_id, source_type, title, content_raw, vault_path,
        timestamp_exact, status, created_at, title_manual, original_filename
      ) VALUES (?, ?, 'dialogo', ?, ?, NULL, ?, 'approved', ?, 1, ?)`,
    ).run(entryId, notebookId, title, transcript, now, now, `dialogo:${threadId}`)

    const inserted: Array<{ id: string; title: string }> = []
    for (const atom of atoms.slice(0, cap)) {
      const qid = randomUUID()
      db.prepare(
        `INSERT INTO quantomos (
          id, entry_id, title, content, hermetic_weight, universe, recognized,
          human_weight, suggested_weight, stage, source_kind, source_id, generation
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'proto', 'dialogo', ?, 0)`,
      ).run(
        qid,
        entryId,
        atom.title,
        atom.content,
        weight,
        'dialogo',
        weight,
        extraction.suggested_weight ?? weight,
        threadId,
      )
      inserted.push({ id: qid, title: atom.title })
    }

    const insertEntityRaw = db.prepare(`
      INSERT INTO entry_entities_raw (id, entry_id, name, type, payload)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const e of extraction.entities) {
      insertEntityRaw.run(
        randomUUID(),
        entryId,
        e.name,
        e.type,
        JSON.stringify({
          kind: e.kind,
          category: e.category,
          status: e.status,
          locations: extraction.locations,
          milestones: extraction.milestones,
        }),
      )
    }
    createEntityProposalsFromEntry(db, entryId)

    db.prepare(
      `UPDATE dialogo_threads
       SET status = 'closed', closed_at = ?, hermetic_weight = ?,
           entry_id = ?, title = ?, updated_at = ?
       WHERE id = ?`,
    ).run(now, weight, entryId, title, now, threadId)

    db.exec('COMMIT')
    return { thread_id: threadId, entry_id: entryId, weight, proto: inserted }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
