import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  AmaMatrixHydrated,
  DeproIdaCard,
  DeproIdaCardDue,
  DeproIdaCardGrade,
  DeproIdaItem,
  DeproIdaKind,
  DeproIdaNeighbor,
  DeproIdaOrigin,
  DeproIdaStage,
  DeproPowerNote,
  DeproPowerStatus,
} from '../types.js'
import { hydrateMatrix } from './amazona.js'
import { deleteEmbedding } from './embeddings.js'
import {
  IDA_MATRIX_ID,
  isCoagulaProcessRow,
  stageForProcessRow,
  suggestedProcessRow,
} from './idaGeometry.js'
import { normalizeDomainIds } from './dominios.js'

const STAGES: DeproIdaStage[] = ['investigacion', 'desarrollo', 'aplicacion']
const STATUSES: DeproPowerStatus[] = ['hueco', 'bosquejo', 'cargado']
const KINDS: DeproIdaKind[] = ['organismo', 'aprendizaje']
const GRADES: DeproIdaCardGrade[] = ['again', 'good']

type IdaRow = {
  id: string
  title: string
  body: string
  stage: string
  power_indexes: string
  agent_ids: string
  tags: string
  origin: string
  archived: number
  matrix_id: string | null
  row_item_id: string | null
  col_item_id: string | null
  weight: number | null
  kind: string | null
  domain_ids: string | null
  created_at: string
  updated_at: string
}

type CardRow = {
  id: string
  ida_id: string
  question: string
  answer: string
  due_at: string | null
  ease: number
  created_at: string
  updated_at: string
}

type NoteRow = {
  power_index: number
  notes: string
  status: string | null
  updated_at: string
}

function parseStringArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function parseIndexArray(raw: string): number[] {
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 71)
  } catch {
    return []
  }
}

function hydrateKind(raw: string | null | undefined): DeproIdaKind {
  return raw === 'aprendizaje' ? 'aprendizaje' : 'organismo'
}

function hydrateWeight(raw: number | null | undefined): number | null {
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 12) return null
  return n
}

function hydrateIda(r: IdaRow): DeproIdaItem {
  const stage = STAGES.includes(r.stage as DeproIdaStage)
    ? (r.stage as DeproIdaStage)
    : 'investigacion'
  const origin: DeproIdaOrigin = r.origin === 'seed' ? 'seed' : 'ui'
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    stage,
    power_indexes: parseIndexArray(r.power_indexes),
    agent_ids: parseStringArray(r.agent_ids),
    tags: parseStringArray(r.tags),
    origin,
    archived: r.archived ? 1 : 0,
    matrix_id: r.matrix_id ?? null,
    row_item_id: r.row_item_id ?? null,
    col_item_id: r.col_item_id ?? null,
    weight: hydrateWeight(r.weight),
    kind: hydrateKind(r.kind),
    domain_ids: parseStringArray(r.domain_ids ?? '[]'),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function hydrateCard(r: CardRow): DeproIdaCard {
  return {
    id: r.id,
    ida_id: r.ida_id,
    question: r.question,
    answer: r.answer ?? '',
    due_at: r.due_at ?? null,
    ease: Number(r.ease) || 2.5,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function hydrateNote(r: NoteRow): DeproPowerNote {
  const status =
    r.status && STATUSES.includes(r.status as DeproPowerStatus)
      ? (r.status as DeproPowerStatus)
      : null
  return {
    power_index: r.power_index,
    notes: r.notes ?? '',
    status,
    updated_at: r.updated_at,
  }
}

export function listPowerNotes(): DeproPowerNote[] {
  const db = getDb()
  return rows<NoteRow>(
    db.prepare(
      'SELECT power_index, notes, status, updated_at FROM depro_power_notes ORDER BY power_index',
    ).all(),
  ).map(hydrateNote)
}

export function upsertPowerNote(
  index: number,
  patch: { notes?: string; status?: DeproPowerStatus | null },
): DeproPowerNote {
  if (!Number.isInteger(index) || index < 0 || index > 71) {
    throw new Error('Índice de poder inválido')
  }
  const db = getDb()
  const now = new Date().toISOString()
  const current = row<NoteRow>(
    db
      .prepare(
        'SELECT power_index, notes, status, updated_at FROM depro_power_notes WHERE power_index = ?',
      )
      .get(index),
  )
  let notes = current?.notes ?? ''
  let status: string | null = current?.status ?? null
  if (typeof patch.notes === 'string') notes = patch.notes
  if (patch.status === null) status = null
  else if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) {
      throw new Error('Status de poder inválido')
    }
    status = patch.status
  }
  db.prepare(
    `INSERT INTO depro_power_notes (power_index, notes, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(power_index) DO UPDATE SET
       notes = excluded.notes,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(index, notes, status, now)
  return {
    power_index: index,
    notes,
    status: status as DeproPowerStatus | null,
    updated_at: now,
  }
}

export function getIdaMatrix(): AmaMatrixHydrated | null {
  return hydrateMatrix(getDb(), IDA_MATRIX_ID)
}

export function listIda(includeArchived = false): DeproIdaItem[] {
  const db = getDb()
  const sql = includeArchived
    ? 'SELECT * FROM depro_ida_items ORDER BY updated_at DESC'
    : 'SELECT * FROM depro_ida_items WHERE archived = 0 ORDER BY updated_at DESC'
  return rows<IdaRow>(db.prepare(sql).all()).map(hydrateIda)
}

export function getIda(id: string): DeproIdaItem | null {
  const db = getDb()
  const found = row<IdaRow>(
    db.prepare('SELECT * FROM depro_ida_items WHERE id = ?').get(id),
  )
  return found ? hydrateIda(found) : null
}

function normalizeIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const uniq = new Set<number>()
  for (const x of raw) {
    const n = Number(x)
    if (Number.isInteger(n) && n >= 0 && n <= 71) uniq.add(n)
  }
  return [...uniq]
}

function normalizeStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseKind(raw: unknown, fallback: DeproIdaKind): DeproIdaKind {
  if (raw === undefined) return fallback
  if (!KINDS.includes(raw as DeproIdaKind)) {
    throw new Error('Tipo de ficha IDA inválido')
  }
  return raw as DeproIdaKind
}

function parseCoord(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new Error('Coordenada AmazonA inválida')
  const t = raw.trim()
  return t || null
}

function parseWeight(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new Error('Peso HITL inválido (1–12)')
  }
  return n
}

function assertCoagulaAllowed(
  kind: DeproIdaKind,
  stage: DeproIdaStage,
  rowItemId: string | null,
  weight: number | null,
): void {
  if (kind !== 'aprendizaje') return
  const coagula =
    stage === 'desarrollo' ||
    stage === 'aplicacion' ||
    isCoagulaProcessRow(rowItemId)
  if (coagula && weight == null) {
    throw new Error('Sin peso HITL (1–12) no baja a Coagula')
  }
}

export function createIda(input: {
  title?: unknown
  body?: unknown
  stage?: unknown
  power_indexes?: unknown
  agent_ids?: unknown
  tags?: unknown
  matrix_id?: unknown
  row_item_id?: unknown
  col_item_id?: unknown
  weight?: unknown
  kind?: unknown
  domain_ids?: unknown
}): DeproIdaItem {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('Título requerido')
  const kind = parseKind(input.kind, 'organismo')
  const rowItemId = parseCoord(input.row_item_id) ?? null
  const colItemId = parseCoord(input.col_item_id) ?? null
  let matrixId = parseCoord(input.matrix_id) ?? null
  if ((rowItemId || colItemId) && !matrixId) matrixId = IDA_MATRIX_ID
  let stage = STAGES.includes(input.stage as DeproIdaStage)
    ? (input.stage as DeproIdaStage)
    : rowItemId
      ? stageForProcessRow(rowItemId)
      : 'investigacion'
  const weight = parseWeight(input.weight) ?? null
  assertCoagulaAllowed(kind, stage, rowItemId, weight)
  const now = new Date().toISOString()
  const id = randomUUID()
  const item: DeproIdaItem = {
    id,
    title,
    body: String(input.body ?? ''),
    stage,
    power_indexes: normalizeIndexes(input.power_indexes),
    agent_ids: normalizeStrings(input.agent_ids),
    tags: normalizeStrings(input.tags),
    origin: 'ui',
    archived: 0,
    matrix_id: matrixId,
    row_item_id: rowItemId,
    col_item_id: colItemId,
    weight,
    kind,
    domain_ids: normalizeDomainIds(input.domain_ids),
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare(
      `INSERT INTO depro_ida_items (
        id, title, body, stage, power_indexes, agent_ids, tags,
        origin, archived, matrix_id, row_item_id, col_item_id, weight, kind,
        domain_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ui', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      item.title,
      item.body,
      item.stage,
      JSON.stringify(item.power_indexes),
      JSON.stringify(item.agent_ids),
      JSON.stringify(item.tags),
      item.matrix_id,
      item.row_item_id,
      item.col_item_id,
      item.weight,
      item.kind,
      JSON.stringify(item.domain_ids),
      now,
      now,
    )
  return item
}

export function updateIda(
  id: string,
  patch: {
    title?: unknown
    body?: unknown
    stage?: unknown
    power_indexes?: unknown
    agent_ids?: unknown
    tags?: unknown
    archived?: unknown
    matrix_id?: unknown
    row_item_id?: unknown
    col_item_id?: unknown
    weight?: unknown
    kind?: unknown
    domain_ids?: unknown
  },
): DeproIdaItem {
  const current = getIda(id)
  if (!current) throw new Error('Ficha IDA no encontrada')
  const now = new Date().toISOString()
  let title = current.title
  let body = current.body
  let stage = current.stage
  let power_indexes = current.power_indexes
  let agent_ids = current.agent_ids
  let tags = current.tags
  let archived = current.archived
  let matrix_id = current.matrix_id
  let row_item_id = current.row_item_id
  let col_item_id = current.col_item_id
  let weight = current.weight
  let kind = current.kind
  let domain_ids = current.domain_ids
  if (typeof patch.title === 'string') {
    const t = patch.title.trim()
    if (!t) throw new Error('Título requerido')
    title = t
  }
  if (typeof patch.body === 'string') body = patch.body
  if (patch.kind !== undefined) kind = parseKind(patch.kind, kind)
  if (patch.weight !== undefined) weight = parseWeight(patch.weight) ?? null
  if (patch.matrix_id !== undefined) matrix_id = parseCoord(patch.matrix_id) ?? null
  if (patch.row_item_id !== undefined) {
    row_item_id = parseCoord(patch.row_item_id) ?? null
  }
  if (patch.col_item_id !== undefined) {
    col_item_id = parseCoord(patch.col_item_id) ?? null
  }
  const stagePatched = patch.stage !== undefined
  if (stagePatched) {
    if (!STAGES.includes(patch.stage as DeproIdaStage)) {
      throw new Error('Etapa IDA inválida')
    }
    stage = patch.stage as DeproIdaStage
    if (patch.row_item_id === undefined) {
      if (row_item_id || kind === 'aprendizaje') {
        row_item_id = suggestedProcessRow(stage, row_item_id)
        if (!matrix_id) matrix_id = IDA_MATRIX_ID
      }
    }
  } else if (patch.row_item_id !== undefined && row_item_id) {
    stage = stageForProcessRow(row_item_id)
  }
  if ((row_item_id || col_item_id) && !matrix_id) matrix_id = IDA_MATRIX_ID
  if (patch.power_indexes !== undefined) {
    power_indexes = normalizeIndexes(patch.power_indexes)
  }
  if (patch.agent_ids !== undefined) {
    agent_ids = normalizeStrings(patch.agent_ids)
  }
  if (patch.tags !== undefined) {
    tags = normalizeStrings(patch.tags)
  }
  if (patch.domain_ids !== undefined) {
    domain_ids = normalizeDomainIds(patch.domain_ids)
  }
  if (patch.archived !== undefined) {
    archived = patch.archived ? 1 : 0
  }
  assertCoagulaAllowed(kind, stage, row_item_id, weight)
  getDb()
    .prepare(
      `UPDATE depro_ida_items SET
        title = ?, body = ?, stage = ?, power_indexes = ?, agent_ids = ?,
        tags = ?, archived = ?, matrix_id = ?, row_item_id = ?, col_item_id = ?,
        weight = ?, kind = ?, domain_ids = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      title,
      body,
      stage,
      JSON.stringify(power_indexes),
      JSON.stringify(agent_ids),
      JSON.stringify(tags),
      archived,
      matrix_id,
      row_item_id,
      col_item_id,
      weight,
      kind,
      JSON.stringify(domain_ids),
      now,
      id,
    )
  return {
    ...current,
    title,
    body,
    stage,
    power_indexes,
    agent_ids,
    tags,
    archived,
    matrix_id,
    row_item_id,
    col_item_id,
    weight,
    kind,
    domain_ids,
    updated_at: now,
  }
}

export function deleteIda(id: string): boolean {
  const db = getDb()
  db.prepare('DELETE FROM depro_ida_cards WHERE ida_id = ?').run(id)
  deleteEmbedding('ida_item', id)
  const result = db.prepare('DELETE FROM depro_ida_items WHERE id = ?').run(id)
  return Number(result.changes) > 0
}

export function listIdaCards(idaId: string): DeproIdaCard[] {
  return rows<CardRow>(
    getDb()
      .prepare(
        'SELECT * FROM depro_ida_cards WHERE ida_id = ? ORDER BY created_at',
      )
      .all(idaId),
  ).map(hydrateCard)
}

export function getIdaCard(id: string): DeproIdaCard | null {
  const found = row<CardRow>(
    getDb().prepare('SELECT * FROM depro_ida_cards WHERE id = ?').get(id),
  )
  return found ? hydrateCard(found) : null
}

export function createIdaCard(
  idaId: string,
  input: { question?: unknown; answer?: unknown; due_at?: unknown },
): DeproIdaCard {
  const item = getIda(idaId)
  if (!item) throw new Error('Ficha IDA no encontrada')
  const question = String(input.question ?? '').trim()
  if (!question) throw new Error('Pregunta requerida')
  const now = new Date().toISOString()
  const dueAt =
    typeof input.due_at === 'string' && input.due_at.trim()
      ? input.due_at.trim()
      : now
  const card: DeproIdaCard = {
    id: randomUUID(),
    ida_id: idaId,
    question,
    answer: String(input.answer ?? ''),
    due_at: dueAt,
    ease: 2.5,
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare(
      `INSERT INTO depro_ida_cards (
        id, ida_id, question, answer, due_at, ease, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      card.id,
      card.ida_id,
      card.question,
      card.answer,
      card.due_at,
      card.ease,
      now,
      now,
    )
  return card
}

export function updateIdaCard(
  id: string,
  patch: { question?: unknown; answer?: unknown; due_at?: unknown },
): DeproIdaCard {
  const current = getIdaCard(id)
  if (!current) throw new Error('Card no encontrada')
  const now = new Date().toISOString()
  let question = current.question
  let answer = current.answer
  let dueAt = current.due_at
  if (typeof patch.question === 'string') {
    const q = patch.question.trim()
    if (!q) throw new Error('Pregunta requerida')
    question = q
  }
  if (typeof patch.answer === 'string') answer = patch.answer
  if (patch.due_at === null) dueAt = null
  else if (typeof patch.due_at === 'string') dueAt = patch.due_at
  getDb()
    .prepare(
      `UPDATE depro_ida_cards SET question = ?, answer = ?, due_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(question, answer, dueAt, now, id)
  return { ...current, question, answer, due_at: dueAt, updated_at: now }
}

export function deleteIdaCard(id: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM depro_ida_cards WHERE id = ?')
    .run(id)
  return Number(result.changes) > 0
}

export function reviewIdaCard(
  id: string,
  gradeRaw: unknown,
): DeproIdaCard {
  const current = getIdaCard(id)
  if (!current) throw new Error('Card no encontrada')
  if (!GRADES.includes(gradeRaw as DeproIdaCardGrade)) {
    throw new Error('Grado de repaso inválido')
  }
  const grade = gradeRaw as DeproIdaCardGrade
  const now = new Date()
  let ease = current.ease || 2.5
  let days: number
  if (grade === 'again') {
    ease = Math.max(1.3, ease - 0.2)
    days = 1
  } else {
    days = Math.max(1, Math.round(ease))
    ease = ease + 0.15
  }
  const due = new Date(now.getTime() + days * 86400000).toISOString()
  const updatedAt = now.toISOString()
  getDb()
    .prepare(
      `UPDATE depro_ida_cards SET due_at = ?, ease = ?, updated_at = ? WHERE id = ?`,
    )
    .run(due, ease, updatedAt, id)
  return { ...current, due_at: due, ease, updated_at: updatedAt }
}

export function listDueIdaCards(now = new Date().toISOString()): DeproIdaCardDue[] {
  return rows<CardRow & { ida_title: string }>(
    getDb()
      .prepare(
        `SELECT c.*, i.title AS ida_title
         FROM depro_ida_cards c
         JOIN depro_ida_items i ON i.id = c.ida_id
         WHERE i.archived = 0 AND (c.due_at IS NULL OR c.due_at <= ?)
         ORDER BY c.due_at ASC, c.created_at ASC`,
      )
      .all(now),
  ).map((r) => ({ ...hydrateCard(r), ida_title: r.ida_title }))
}

export function exportIdaMarkdown(): string {
  const items = listIda(false).filter((i) => i.kind === 'aprendizaje')
  const matrix = getIdaMatrix()
  const rowLabel = new Map(
    (matrix?.row_list.items ?? []).map((it) => [it.id, it.label]),
  )
  const colLabel = new Map(
    (matrix?.col_list.items ?? []).map((it) => [it.id, it.label]),
  )
  const lines: string[] = ['# Aprendizajes IDA', '']
  const groups = new Map<string, DeproIdaItem[]>()
  for (const item of items) {
    const rowName = item.row_item_id
      ? (rowLabel.get(item.row_item_id) ?? item.row_item_id)
      : 'Sin fila'
    const colName = item.col_item_id
      ? (colLabel.get(item.col_item_id) ?? item.col_item_id)
      : 'Sin columna'
    const key =
      item.row_item_id || item.col_item_id
        ? `${rowName} × ${colName}`
        : 'Sin celda'
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  if (groups.size === 0) {
    lines.push('_No hay aprendizajes sellados._', '')
    return lines.join('\n')
  }
  for (const [heading, group] of groups) {
    lines.push(`## ${heading}`, '')
    for (const item of group) {
      lines.push(`### ${item.title}`)
      if (item.weight != null) lines.push(`Peso HITL: ${item.weight}`)
      lines.push(`Etapa: ${item.stage}`)
      if (item.body.trim()) {
        lines.push('')
        lines.push(item.body.trim())
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

export function hydrateNeighbors(
  hits: Array<{
    object_type: string
    object_id: string
    score: number
  }>,
): DeproIdaNeighbor[] {
  const db = getDb()
  const out: DeproIdaNeighbor[] = []
  for (const hit of hits) {
    if (hit.object_type === 'ida_item') {
      const item = getIda(hit.object_id)
      if (!item) continue
      out.push({
        object_type: 'ida_item',
        object_id: item.id,
        score: hit.score,
        title: item.title,
        body: item.body,
        kind: item.kind,
      })
      continue
    }
    if (hit.object_type === 'quantomo') {
      const q = row<{ id: string; title: string; content: string | null }>(
        db
          .prepare('SELECT id, title, content FROM quantomos WHERE id = ?')
          .get(hit.object_id),
      )
      if (!q) continue
      out.push({
        object_type: 'quantomo',
        object_id: q.id,
        score: hit.score,
        title: q.title,
        body: q.content ?? '',
      })
    }
  }
  return out
}

export function shouldEmbedIda(item: DeproIdaItem): boolean {
  return (
    item.kind === 'aprendizaje' &&
    Boolean((item.title + item.body).replace(/\s+/g, ' ').trim())
  )
}
