/**
 * Diálogo: hilos operador ↔ Deprocast con RAG (Oráculo).
 * Distinto del import WhatsApp (chat_sessions / Conversador).
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import { chatWithCorpus } from './cohere.js'
import { searchGraphContext } from './graph.js'

export type DialogoEntityRef = {
  type: 'person' | 'project' | 'agrupacion' | 'quantomo' | 'dominio'
  id: string
}

export type DialogoThread = {
  id: string
  title: string
  section_key: string | null
  entity_refs: DialogoEntityRef[]
  created_at: string
  updated_at: string
  status: 'open' | 'closed'
  closed_at: string | null
  hermetic_weight: number | null
  entry_id: string | null
}

export type DialogoMessage = {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export type DashboardPin = {
  slot: number
  ref_type: DialogoEntityRef['type']
  ref_id: string
  label: string
  updated_at: string
}

const REF_TYPES = new Set([
  'person',
  'project',
  'agrupacion',
  'quantomo',
  'dominio',
])

function parseEntityRefs(raw: string | null | undefined): DialogoEntityRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: DialogoEntityRef[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const type = String((item as { type?: unknown }).type ?? '')
      const id = String((item as { id?: unknown }).id ?? '').trim()
      if (!REF_TYPES.has(type) || !id) continue
      out.push({ type: type as DialogoEntityRef['type'], id })
    }
    return out
  } catch {
    return []
  }
}

function mapThread(r: {
  id: string
  title: string
  section_key: string | null
  entity_refs: string
  created_at: string
  updated_at: string
  status?: string | null
  closed_at?: string | null
  hermetic_weight?: number | null
  entry_id?: string | null
}): DialogoThread {
  return {
    id: r.id,
    title: r.title,
    section_key: r.section_key,
    entity_refs: parseEntityRefs(r.entity_refs),
    created_at: r.created_at,
    updated_at: r.updated_at,
    status: r.status === 'closed' ? 'closed' : 'open',
    closed_at: r.closed_at ?? null,
    hermetic_weight:
      typeof r.hermetic_weight === 'number' ? r.hermetic_weight : null,
    entry_id: r.entry_id ?? null,
  }
}

function hydrateEntityCard(ref: DialogoEntityRef): string | null {
  const db = getDb()
  if (ref.type === 'person') {
    const p = row<{ name: string; notes: string; kind: string }>(
      db
        .prepare(
          `SELECT name, coalesce(notes, '') AS notes, coalesce(kind, '') AS kind
           FROM persons WHERE id = ? AND (merged_into IS NULL OR merged_into = '')`,
        )
        .get(ref.id),
    )
    if (!p) return null
    return `[person] ${p.name}${p.kind ? ` (${p.kind})` : ''}${p.notes ? `: ${p.notes.slice(0, 400)}` : ''}`
  }
  if (ref.type === 'project') {
    const p = row<{ title: string; notes: string; kind: string }>(
      db
        .prepare(
          `SELECT title, coalesce(notes, '') AS notes, coalesce(kind, '') AS kind
           FROM projects WHERE id = ? AND (merged_into IS NULL OR merged_into = '')`,
        )
        .get(ref.id),
    )
    if (!p) return null
    return `[project] ${p.title}${p.kind ? ` (${p.kind})` : ''}${p.notes ? `: ${p.notes.slice(0, 400)}` : ''}`
  }
  if (ref.type === 'agrupacion') {
    const a = row<{ name: string; notes: string }>(
      db
        .prepare(
          `SELECT name, coalesce(notes, '') AS notes FROM agrupaciones WHERE id = ?`,
        )
        .get(ref.id),
    )
    if (!a) return null
    return `[agrupacion] ${a.name}${a.notes ? `: ${a.notes.slice(0, 400)}` : ''}`
  }
  if (ref.type === 'quantomo') {
    const q = row<{ title: string; content: string }>(
      db
        .prepare(
          `SELECT title, coalesce(content, '') AS content FROM quantomos WHERE id = ?`,
        )
        .get(ref.id),
    )
    if (!q) return null
    return `[quantomo] ${q.title}: ${q.content.slice(0, 500)}`
  }
  if (ref.type === 'dominio') {
    const d = row<{ name: string; notes: string }>(
      db
        .prepare(
          `SELECT name, coalesce(notes, '') AS notes FROM dominios WHERE id = ?`,
        )
        .get(ref.id),
    )
    if (!d) return null
    return `[dominio] ${d.name}${d.notes ? `: ${d.notes.slice(0, 400)}` : ''}`
  }
  return null
}

function buildSystemPrompt(
  sectionKey: string | null,
  entityBlock: string,
  graphBlock: string,
): string {
  const sectionLine = sectionKey
    ? `Sección de origen: ${sectionKey}.`
    : 'Sección: general (Dashboard / Diálogo).'
  return [
    'Sos Deprocast, el sistema operativo personal del operador.',
    'Respondé en español, claro y concreto.',
    'Usá el contexto recuperado del corpus. Si no hay evidencia, decilo; no inventes hechos.',
    'El Corpus premium son quántomos sellados (retículo L72). Proto y pre son materia en maduración, no semillas RAG.',
    'No digas que sos un LLM genérico: sos el Oráculo de esta RUN.',
    sectionLine,
    '',
    '## Entidades ancladas',
    entityBlock || '(ninguna)',
    '',
    '## Contexto del grafo (RAG)',
    graphBlock,
  ].join('\n')
}

export function listDialogoThreads(): DialogoThread[] {
  const db = getDb()
  const list = rows<{
    id: string
    title: string
    section_key: string | null
    entity_refs: string
    created_at: string
    updated_at: string
    status: string | null
    closed_at: string | null
    hermetic_weight: number | null
    entry_id: string | null
  }>(
    db
      .prepare(
        `SELECT id, title, section_key, entity_refs, created_at, updated_at,
                coalesce(status, 'open') AS status, closed_at, hermetic_weight, entry_id
         FROM dialogo_threads
         ORDER BY updated_at DESC`,
      )
      .all(),
  )
  return list.map(mapThread)
}

export function getDialogoThread(id: string): {
  thread: DialogoThread
  messages: DialogoMessage[]
} | null {
  const db = getDb()
  const t = row<{
    id: string
    title: string
    section_key: string | null
    entity_refs: string
    created_at: string
    updated_at: string
    status: string | null
    closed_at: string | null
    hermetic_weight: number | null
    entry_id: string | null
  }>(
    db
      .prepare(
        `SELECT id, title, section_key, entity_refs, created_at, updated_at,
                coalesce(status, 'open') AS status, closed_at, hermetic_weight, entry_id
         FROM dialogo_threads WHERE id = ?`,
      )
      .get(id),
  )
  if (!t) return null

  const messages = rows<{
    id: string
    thread_id: string
    role: string
    content: string
    created_at: string
  }>(
    db
      .prepare(
        `SELECT id, thread_id, role, content, created_at
         FROM dialogo_messages
         WHERE thread_id = ?
         ORDER BY created_at ASC`,
      )
      .all(id),
  ).map((m) => ({
    id: m.id,
    thread_id: m.thread_id,
    role: m.role as DialogoMessage['role'],
    content: m.content,
    created_at: m.created_at,
  }))

  return { thread: mapThread(t), messages }
}

export function createDialogoThread(input: {
  title?: string
  section_key?: string | null
  entity_refs?: DialogoEntityRef[]
}): DialogoThread {
  const db = getDb()
  const now = new Date().toISOString()
  const id = randomUUID()
  const title = String(input.title ?? '').trim() || 'Nuevo diálogo'
  const sectionKey =
    input.section_key != null && String(input.section_key).trim()
      ? String(input.section_key).trim()
      : null
  const refs = Array.isArray(input.entity_refs)
    ? input.entity_refs.filter((r) => r && REF_TYPES.has(r.type) && r.id)
    : []

  db.prepare(
    `INSERT INTO dialogo_threads (id, title, section_key, entity_refs, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`,
  ).run(id, title, sectionKey, JSON.stringify(refs), now, now)

  return {
    id,
    title,
    section_key: sectionKey,
    entity_refs: refs,
    created_at: now,
    updated_at: now,
    status: 'open',
    closed_at: null,
    hermetic_weight: null,
    entry_id: null,
  }
}

export function updateDialogoThread(
  id: string,
  patch: {
    title?: string
    section_key?: string | null
    entity_refs?: DialogoEntityRef[]
  },
): DialogoThread | null {
  const existing = getDialogoThread(id)
  if (!existing) return null
  const db = getDb()
  const now = new Date().toISOString()
  const title =
    patch.title != null ? String(patch.title).trim() || existing.thread.title : existing.thread.title
  const sectionKey =
    patch.section_key !== undefined
      ? patch.section_key
        ? String(patch.section_key).trim()
        : null
      : existing.thread.section_key
  const refs =
    patch.entity_refs !== undefined
      ? patch.entity_refs.filter((r) => r && REF_TYPES.has(r.type) && r.id)
      : existing.thread.entity_refs

  db.prepare(
    `UPDATE dialogo_threads
     SET title = ?, section_key = ?, entity_refs = ?, updated_at = ?
     WHERE id = ?`,
  ).run(title, sectionKey, JSON.stringify(refs), now, id)

  return {
    ...existing.thread,
    title,
    section_key: sectionKey,
    entity_refs: refs,
    updated_at: now,
  }
}

export async function postDialogoMessage(
  threadId: string,
  content: string,
): Promise<{
  user: DialogoMessage
  assistant: DialogoMessage
  thread: DialogoThread
}> {
  const detail = getDialogoThread(threadId)
  if (!detail) {
    throw new Error('Hilo no encontrado')
  }
  if (detail.thread.status === 'closed') {
    throw new Error('Hilo cerrado: abrí un addendum (hilo nuevo) si hace falta')
  }
  const text = content.trim()
  if (!text) {
    throw new Error('Mensaje vacío')
  }

  const db = getDb()
  const now = new Date().toISOString()
  const userMsg: DialogoMessage = {
    id: randomUUID(),
    thread_id: threadId,
    role: 'user',
    content: text,
    created_at: now,
  }

  db.prepare(
    `INSERT INTO dialogo_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, ?)`,
  ).run(userMsg.id, threadId, text, now)

  const entityLines = detail.thread.entity_refs
    .map((r) => hydrateEntityCard(r))
    .filter((s): s is string => !!s)
  const entityBlock = entityLines.map((l) => `- ${l}`).join('\n')
  const graphBlock = await searchGraphContext(text)
  const system = buildSystemPrompt(
    detail.thread.section_key,
    entityBlock,
    graphBlock,
  )

  const history = detail.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
  history.push({ role: 'user', content: text })

  const reply = await chatWithCorpus({ system, messages: history })
  const assistantAt = new Date().toISOString()
  const assistantMsg: DialogoMessage = {
    id: randomUUID(),
    thread_id: threadId,
    role: 'assistant',
    content: reply,
    created_at: assistantAt,
  }

  db.prepare(
    `INSERT INTO dialogo_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(assistantMsg.id, threadId, reply, assistantAt)

  db.prepare(`UPDATE dialogo_threads SET updated_at = ? WHERE id = ?`).run(
    assistantAt,
    threadId,
  )

  return {
    user: userMsg,
    assistant: assistantMsg,
    thread: { ...detail.thread, updated_at: assistantAt },
  }
}

export function listDashboardPins(): DashboardPin[] {
  const db = getDb()
  return rows<{
    slot: number
    ref_type: string
    ref_id: string
    label: string
    updated_at: string
  }>(
    db
      .prepare(
        `SELECT slot, ref_type, ref_id, label, updated_at
         FROM dashboard_pins
         ORDER BY slot ASC`,
      )
      .all(),
  ).map((p) => ({
    slot: p.slot,
    ref_type: p.ref_type as DashboardPin['ref_type'],
    ref_id: p.ref_id,
    label: p.label,
    updated_at: p.updated_at,
  }))
}

export function setDashboardPins(
  pins: Array<{
    slot: number
    ref_type: string
    ref_id: string
    label: string
  }>,
): DashboardPin[] {
  const db = getDb()
  const now = new Date().toISOString()
  const cleaned: DashboardPin[] = []
  const usedSlots = new Set<number>()

  for (const p of pins) {
    const slot = Number(p.slot)
    if (!Number.isInteger(slot) || slot < 0 || slot > 11) continue
    if (usedSlots.has(slot)) continue
    if (!REF_TYPES.has(p.ref_type)) continue
    const refId = String(p.ref_id ?? '').trim()
    const label = String(p.label ?? '').trim()
    if (!refId || !label) continue
    usedSlots.add(slot)
    cleaned.push({
      slot,
      ref_type: p.ref_type as DashboardPin['ref_type'],
      ref_id: refId,
      label,
      updated_at: now,
    })
  }

  const del = db.prepare('DELETE FROM dashboard_pins')
  const ins = db.prepare(
    `INSERT INTO dashboard_pins (slot, ref_type, ref_id, label, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )

  try {
    db.exec('BEGIN')
    del.run()
    for (const p of cleaned) {
      ins.run(p.slot, p.ref_type, p.ref_id, p.label, p.updated_at)
    }
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }

  return listDashboardPins()
}
