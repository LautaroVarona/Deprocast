/**
 * Import + procesamiento de sesiones de chat → entries/quantomos/proposals.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb, getTrincheraNotebookId, syncPersonAliases, syncProjectAliases } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  BookmarkManualTag,
  ChatBlock,
  ChatMessage,
  ChatSession,
  ChatSpeakerMap,
  ChatTipo,
  EntityProposal,
  Person,
  Project,
} from '../types.js'
import {
  applyEntryManualTagsAsLinks,
  applySpeakerLinks,
} from './audioCriba.js'
import { createBlocksForSession } from './chatBlocks.js'
import { parseWhatsAppExport, type ParsedChat } from './chatParse.js'
import { extractFromChatBlock } from './cohere.js'
import {
  parseChatSpeakerMap,
  previewMessagesByBlock,
  resolveChatProcessWeight,
  speakersHaveAi,
} from './chatSpeakers.js'
import { createEntityProposalsFromEntry, normalizeName } from './entityMatch.js'
import { insertLinkHarvest } from './linkHarvest.js'
import { clampTitleWords } from './titleUtils.js'
import { extractUrlsFromMessages, mergeUrlLists } from '../../shared/chatUrls.js'

export {
  parseChatSpeakerMap,
  resolveChatProcessWeight,
  speakersHaveAi,
} from './chatSpeakers.js'

const processingSessions = new Set<string>()

function vaultChatDir(sessionId: string): string {
  return path.resolve(process.cwd(), 'vault', 'chats', sessionId)
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw) as unknown
    if (Array.isArray(p)) return p.map(String).filter(Boolean)
  } catch {
    /* ignore */
  }
  return []
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const t = id.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function personNameById(db: DatabaseSync, id: string): string | null {
  const p = row<Person>(db.prepare(`SELECT name FROM persons WHERE id = ?`).get(id))
  return p?.name ?? null
}

function personKindById(db: DatabaseSync, id: string): string | null {
  const p = row<Person>(db.prepare(`SELECT kind FROM persons WHERE id = ?`).get(id))
  return p?.kind ?? null
}

function projectTitleById(db: DatabaseSync, id: string): string | null {
  const p = row<Project>(
    db.prepare(`SELECT title FROM projects WHERE id = ?`).get(id),
  )
  return p?.title ?? null
}

function addPersonAlias(
  db: DatabaseSync,
  personId: string,
  extra: string,
): void {
  const name = extra.trim()
  if (!name) return
  const person = row<Person>(
    db.prepare(`SELECT * FROM persons WHERE id = ?`).get(personId),
  )
  if (!person) return
  if (normalizeName(name) === normalizeName(person.name)) return
  let aliases: string[] = []
  try {
    const parsed = JSON.parse(person.aliases || '[]') as unknown
    if (Array.isArray(parsed)) aliases = parsed.map(String)
  } catch {
    aliases = []
  }
  if (aliases.some((a) => normalizeName(a) === normalizeName(name))) return
  aliases.push(name)
  const json = JSON.stringify(aliases)
  const now = new Date().toISOString()
  db.prepare(`UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`).run(
    json,
    now,
    personId,
  )
  syncPersonAliases(personId, person.name, json)
}

function addProjectAlias(
  db: DatabaseSync,
  projectId: string,
  extra: string,
): void {
  const title = extra.trim()
  if (!title) return
  const project = row<Project>(
    db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId),
  )
  if (!project) return
  if (normalizeName(title) === normalizeName(project.title)) return
  let aliases: string[] = []
  try {
    const parsed = JSON.parse(project.aliases || '[]') as unknown
    if (Array.isArray(parsed)) aliases = parsed.map(String)
  } catch {
    aliases = []
  }
  if (aliases.some((a) => normalizeName(a) === normalizeName(title))) return
  aliases.push(title)
  const json = JSON.stringify(aliases)
  const now = new Date().toISOString()
  db.prepare(`UPDATE projects SET aliases = ?, updated_at = ? WHERE id = ?`).run(
    json,
    now,
    projectId,
  )
  syncProjectAliases(projectId, project.title, json)
}

function hydrateSpeakerMap(
  db: DatabaseSync,
  speakers: ChatSpeakerMap[],
): ChatSpeakerMap[] {
  return speakers.map((s) => {
    if (!s.person_id) {
      const is_ai = Boolean(s.is_ai)
      return {
        ...s,
        is_ai,
        role: is_ai ? 'assistant' : (s.role ?? 'human'),
      }
    }
    const name = personNameById(db, s.person_id)
    const kind = personKindById(db, s.person_id)
    const is_ai = kind === 'ia'
    return {
      ...s,
      person_name: name ?? s.person_name,
      is_ai,
      role: is_ai ? 'assistant' : 'human',
      model: is_ai ? (s.model ?? name) : null,
    }
  })
}

function displayRemitente(
  remitente: string | null,
  speakers: ChatSpeakerMap[],
): string {
  if (!remitente) return 'Sistema'
  const hit = speakers.find((s) => s.remitente === remitente)
  return hit?.person_name || remitente
}

function toEntrySpeakerMap(speakers: ChatSpeakerMap[]): Array<{
  speaker: number
  person_id: string | null
  person_name: string | null
  is_ai: boolean
  role: 'human' | 'assistant'
  model: string | null
}> {
  return speakers.map((s, i) => ({
    speaker: i,
    person_id: s.person_id,
    person_name: s.person_name,
    is_ai: Boolean(s.is_ai),
    role: s.is_ai || s.role === 'assistant' ? 'assistant' : 'human',
    model: s.model ?? null,
  }))
}

const EXTRA_ENTITY_KINDS = ['dominio', 'agrupacion', 'geografia'] as const

function isExtraEntityKind(
  v: string,
): v is (typeof EXTRA_ENTITY_KINDS)[number] {
  return (EXTRA_ENTITY_KINDS as readonly string[]).includes(v)
}

function parseLinkedEntitiesJson(
  raw: string | null | undefined,
): BookmarkManualTag[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: BookmarkManualTag[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const kind = String(o.kind ?? '').trim()
      const id = String(o.id ?? o.entity_id ?? '').trim()
      const name = String(o.name ?? o.entity_name ?? '').trim()
      if (!id || !isExtraEntityKind(kind)) continue
      const key = `${kind}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind, entity_id: id, entity_name: name || id })
    }
    return out
  } catch {
    return []
  }
}

function serializeLinkedEntities(tags: BookmarkManualTag[]): string {
  return JSON.stringify(
    tags.map((t) => ({ kind: t.kind, id: t.entity_id, name: t.entity_name })),
  )
}

function tagsFromIds(
  db: DatabaseSync,
  personIds: string[],
  projectIds: string[],
  extra: BookmarkManualTag[] = [],
): BookmarkManualTag[] {
  const tags: BookmarkManualTag[] = []
  for (const id of uniqueIds(personIds)) {
    const name = personNameById(db, id)
    if (!name) continue
    tags.push({ kind: 'person', entity_id: id, entity_name: name })
  }
  for (const id of uniqueIds(projectIds)) {
    const title = projectTitleById(db, id)
    if (!title) continue
    tags.push({ kind: 'project', entity_id: id, entity_name: title })
  }
  const seen = new Set(tags.map((t) => `${t.kind}:${t.entity_id}`))
  for (const tag of extra) {
    if (!isExtraEntityKind(tag.kind)) continue
    const key = `${tag.kind}:${tag.entity_id}`
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

export function previewChatFile(
  buffer: Buffer,
  filename: string,
): ReturnType<typeof parseWhatsAppExport> {
  return parseWhatsAppExport(buffer.toString('utf8'), { filename })
}

export type ImportChatResult = {
  session: ChatSession
  message_count: number
  block_count: number
  link_count: number
}

export function importChatSession(input: {
  buffer: Buffer
  filename: string
  nombre_chat?: string
  tipo?: ChatTipo
  person_ids?: string[]
  project_ids?: string[]
  speaker_map?: ChatSpeakerMap[]
  primary_person_id?: string | null
  primary_project_id?: string | null
}): ImportChatResult {
  const db = getDb()
  const parsed = parseWhatsAppExport(input.buffer.toString('utf8'), {
    filename: input.filename,
  })

  const existing = row<ChatSession>(
    db
      .prepare(`SELECT * FROM chat_sessions WHERE origin_hash = ?`)
      .get(parsed.origin_hash),
  )
  if (existing) {
    const err = new Error(`Chat ya importado: ${existing.nombre_chat}`) as Error & {
      status?: number
      session?: ChatSession
    }
    err.status = 409
    err.session = existing
    throw err
  }

  const sessionId = randomUUID()
  const now = new Date().toISOString()
  const tipo: ChatTipo = input.tipo ?? parsed.tipo_auto
  const nombre = (input.nombre_chat || parsed.suggested_name).trim()

  const speakers = hydrateSpeakerMap(
    db,
    (input.speaker_map ?? []).filter((s) => s.remitente),
  )
  for (const s of speakers) {
    if (s.person_id && s.remitente) addPersonAlias(db, s.person_id, s.remitente)
  }

  const personIds = uniqueIds([
    ...(input.person_ids ?? []),
    ...speakers.map((s) => s.person_id).filter((id): id is string => Boolean(id)),
    input.primary_person_id ?? '',
  ])
  const projectIds = uniqueIds([
    ...(input.project_ids ?? []),
    input.primary_project_id ?? '',
  ])
  const primaryPersonId = input.primary_person_id?.trim() || null
  const primaryProjectId = input.primary_project_id?.trim() || null

  const dir = vaultChatDir(sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const vaultPath = path.join(dir, 'export.txt')
  fs.writeFileSync(vaultPath, input.buffer)

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO chat_sessions (
        id, origin_hash, nombre_chat, tipo, participantes_json,
        linked_person_ids_json, linked_project_ids_json, speaker_map_json,
        primary_person_id, primary_project_id, vault_path, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?)`,
    ).run(
      sessionId,
      parsed.origin_hash,
      nombre,
      tipo,
      JSON.stringify(parsed.participantes),
      JSON.stringify(personIds),
      JSON.stringify(projectIds),
      JSON.stringify(speakers),
      primaryPersonId,
      primaryProjectId,
      vaultPath,
      now,
      now,
    )

    const insertMsg = db.prepare(
      `INSERT INTO chat_messages (
        id, chat_session_id, remitente, texto_crudo, timestamp_exact,
        is_system, is_media, estado_procesamiento, block_id, sort_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', NULL, ?)`,
    )

    let link_count = 0
    for (const m of parsed.messages) {
      insertMsg.run(
        m.id,
        sessionId,
        m.remitente,
        m.texto_crudo,
        m.timestamp_exact,
        m.is_system ? 1 : 0,
        m.is_media ? 1 : 0,
        m.sort_index,
      )
      for (const url of m.urls) {
        if (
          insertLinkHarvest(db, {
            url_cruda: url,
            source_type: 'chat_message',
            source_id: m.id,
            remitente: m.remitente,
            timestamp_captura: m.timestamp_exact,
            chat_session_id: sessionId,
          })
        ) {
          link_count++
        }
      }
    }

    const block_count = createBlocksForSession(db, sessionId)
    db.exec('COMMIT')

    const session = row<ChatSession>(
      db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
    )!
    return {
      session,
      message_count: parsed.messages.length,
      block_count,
      link_count,
    }
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
}

function speakerIsAi(
  remitente: string | null,
  speakers: ChatSpeakerMap[],
): boolean {
  if (!remitente) return false
  return Boolean(speakers.find((s) => s.remitente === remitente)?.is_ai)
}

function buildBlockTranscript(
  messages: ChatMessage[],
  speakers: ChatSpeakerMap[] = [],
): string {
  return messages
    .map((m) => {
      const who = displayRemitente(m.remitente, speakers)
      const ai = speakerIsAi(m.remitente, speakers) ? '[IA] ' : ''
      const media = m.is_media ? ' [multimedia]' : ''
      return `[${m.timestamp_exact}] ${ai}${who}: ${m.texto_crudo}${media}`
    })
    .join('\n')
}

export type ProcessChatResult = {
  processed: number
  skipped: number
  remaining: number
  errors: Array<{ block_id: string; error: string }>
  items: Array<{
    block_id: string
    entry_id: string
    quantomo_id: string
    title: string
  }>
}

export async function processChatSession(
  sessionId: string,
  opts?: { limit?: number; blockId?: string },
): Promise<ProcessChatResult> {
  if (processingSessions.has(sessionId)) {
    throw new Error('Esta sesión ya se está procesando')
  }
  processingSessions.add(sessionId)
  try {
    return await processChatSessionInner(sessionId, opts)
  } finally {
    processingSessions.delete(sessionId)
  }
}

async function processChatSessionInner(
  sessionId: string,
  opts?: { limit?: number; blockId?: string },
): Promise<ProcessChatResult> {
  const db = getDb()
  const session = row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )
  if (!session) throw new Error('Sesión no encontrada')

  const limit = Math.max(1, Math.min(opts?.limit ?? 5, 50))
  const blocks = opts?.blockId
    ? rows<ChatBlock>(
        db
          .prepare(
            `SELECT * FROM chat_blocks
             WHERE chat_session_id = ? AND id = ? AND estado = 'pendiente'`,
          )
          .all(sessionId, opts.blockId),
      )
    : rows<ChatBlock>(
        db
          .prepare(
            `SELECT * FROM chat_blocks
             WHERE chat_session_id = ? AND estado = 'pendiente'
             ORDER BY started_at ASC
             LIMIT ?`,
          )
          .all(sessionId, limit),
      )

  const result: ProcessChatResult = {
    processed: 0,
    skipped: 0,
    remaining: 0,
    errors: [],
    items: [],
  }

  if (blocks.length === 0) {
    const pending = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM chat_blocks
             WHERE chat_session_id = ? AND estado = 'pendiente'`,
          )
          .get(sessionId) as { n: number | bigint }
      ).n ?? 0,
    )
    result.remaining = pending
    if (pending === 0) {
      db.prepare(
        `UPDATE chat_sessions SET status = 'processed', updated_at = ? WHERE id = ?`,
      ).run(new Date().toISOString(), sessionId)
    }
    return result
  }

  db.prepare(
    `UPDATE chat_sessions SET status = 'processing', updated_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), sessionId)

  const participantes = parseJsonArray(session.participantes_json)
  const linkedPersonIds = parseJsonArray(session.linked_person_ids_json)
  const linkedProjectIds = parseJsonArray(session.linked_project_ids_json)
  const speakers = hydrateSpeakerMap(
    db,
    parseChatSpeakerMap(session.speaker_map_json),
  )
  const notebookId = getTrincheraNotebookId()

  for (const block of blocks) {
    try {
      const item = await processOneBlock(db, {
        session,
        block,
        participantes,
        linkedPersonIds,
        linkedProjectIds,
        speakers,
        notebookId,
      })
      result.processed++
      result.items.push(item)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ block_id: block.id, error: msg })
      db.prepare(
        `UPDATE chat_blocks SET estado = 'error', summary_json = ? WHERE id = ?`,
      ).run(JSON.stringify({ error: msg }), block.id)
    }
  }

  const remaining = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM chat_blocks
           WHERE chat_session_id = ? AND estado = 'pendiente'`,
        )
        .get(sessionId) as { n: number | bigint }
    ).n ?? 0,
  )
  result.remaining = remaining
  const status = remaining === 0 ? 'processed' : 'processing'
  db.prepare(
    `UPDATE chat_sessions SET status = ?, updated_at = ? WHERE id = ?`,
  ).run(status, new Date().toISOString(), sessionId)

  return result
}

async function processOneBlock(
  db: DatabaseSync,
  ctx: {
    session: ChatSession
    block: ChatBlock
    participantes: string[]
    linkedPersonIds: string[]
    linkedProjectIds: string[]
    speakers: ChatSpeakerMap[]
    notebookId: string
  },
): Promise<{
  block_id: string
  entry_id: string
  quantomo_id: string
  title: string
}> {
  const {
    session,
    block,
    participantes,
    linkedPersonIds,
    linkedProjectIds,
    speakers,
    notebookId,
  } = ctx
  const messages = rows<ChatMessage>(
    db
      .prepare(
        `SELECT * FROM chat_messages
         WHERE block_id = ?
         ORDER BY timestamp_exact ASC, sort_index ASC`,
      )
      .all(block.id),
  )
  if (messages.length === 0) {
    throw new Error('bloque sin mensajes')
  }

  const blockPeople = parseJsonArray(block.linked_person_ids_json)
  const blockProjects = parseJsonArray(block.linked_project_ids_json)
  const blockExtra = parseLinkedEntitiesJson(block.linked_entities_json)
  const allPersonIds = uniqueIds([
    ...linkedPersonIds,
    ...blockPeople,
    session.primary_person_id ?? '',
    ...speakers.map((s) => s.person_id ?? ''),
  ])
  const allProjectIds = uniqueIds([
    ...linkedProjectIds,
    ...blockProjects,
    session.primary_project_id ?? '',
  ])
  const blockTags = tagsFromIds(db, allPersonIds, allProjectIds, blockExtra)

  const canonicalParticipants = participantes.map((p) =>
    displayRemitente(p, speakers),
  )
  const speakerBanner = speakers
    .filter((s) => s.person_name)
    .map((s) => `${s.person_name}${s.is_ai ? ' (IA)' : ''}`)
    .join(', ')
  const blockNotes = String(block.notes ?? '').trim()
  const blockLinks = mergeUrlLists(
    parseJsonArray(block.links_json),
    extractUrlsFromMessages(messages),
  )
  const transcript = [
    speakerBanner ? `Conversación entre: ${speakerBanner}.` : '',
    blockNotes ? `Notas del chat: ${blockNotes}` : '',
    blockLinks.length
      ? `Links:\n${blockLinks.map((u) => `- ${u}`).join('\n')}`
      : '',
    buildBlockTranscript(messages, speakers),
  ]
    .filter(Boolean)
    .join('\n\n')
  const peopleNames = allPersonIds
    .map((id) => personNameById(db, id))
    .filter((n): n is string => Boolean(n))
  const projectNames = allProjectIds
    .map((id) => projectTitleById(db, id))
    .filter((n): n is string => Boolean(n))
  const extraNames = blockExtra
    .map((t) => t.entity_name)
    .filter(Boolean)

  const extraction = await extractFromChatBlock({
    chatName: session.nombre_chat,
    tipo: session.tipo,
    participantes: canonicalParticipants,
    transcript,
    dayKey: block.day_key,
    habladores: speakers
      .filter((s) => s.person_name)
      .map((s) => ({
        remitente: s.remitente,
        person_name: s.person_name!,
        is_ai: Boolean(s.is_ai),
      })),
    linkedPeople: peopleNames,
    linkedProjects: projectNames,
    linkedEntities: extraNames,
    notes: blockNotes,
    links: blockLinks,
  })

  const entryId = randomUUID()
  const quantomoId = randomUUID()
  const now = new Date().toISOString()
  const title = clampTitleWords(
    extraction.title,
    3,
    5,
    `${session.nombre_chat} ${block.day_key}`,
  )
  const hasAi = speakersHaveAi(speakers)
  const weight = resolveChatProcessWeight({
    blockWeight: block.human_weight,
    conversationWeight: session.human_weight,
    suggestedWeight: extraction.suggested_weight,
    hasAi,
  })
  const entrySpeakerMap = toEntrySpeakerMap(speakers)
  const profileJson = JSON.stringify({
    has_ai: hasAi,
    conversation_id: session.id,
    conversation_name: session.nombre_chat,
    conversation_weight: session.human_weight ?? null,
    chat_weight: block.human_weight ?? null,
    notes: blockNotes,
    links: blockLinks,
    conversation_speakers: speakers.map((s) => ({
      person_id: s.person_id,
      person_name: s.person_name,
      remitente: s.remitente,
      is_ai: Boolean(s.is_ai),
      role: s.is_ai ? 'assistant' : 'human',
    })),
    ai_speakers: speakers
      .filter((s) => s.is_ai)
      .map((s) => ({
        person_id: s.person_id,
        person_name: s.person_name,
        remitente: s.remitente,
      })),
  })

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO entries (
        id, notebook_id, source_type, title, content_raw, vault_path,
        timestamp_exact, status, created_at, title_manual, original_filename,
        speaker_map, human_weight, manual_tags
      ) VALUES (?, ?, 'chat', ?, ?, ?, ?, 'approved', ?, 1, ?, ?, ?, ?)`,
    ).run(
      entryId,
      notebookId,
      title,
      transcript,
      session.vault_path,
      block.started_at,
      now,
      `chat:${session.id}:${block.id}`,
      JSON.stringify(entrySpeakerMap),
      weight,
      JSON.stringify(blockTags),
    )

    db.prepare(
      `INSERT INTO quantomos (
        id, entry_id, title, content, hermetic_weight, universe, recognized,
        human_weight, suggested_weight, stage, source_kind, source_id,
        profile_json
      ) VALUES (?, ?, ?, ?, ?, 'chat', 0, ?, ?, 'proto', 'chat_import', ?, ?)`,
    ).run(
      quantomoId,
      entryId,
      title,
      extraction.quantomo,
      weight,
      weight,
      extraction.suggested_weight ?? weight,
      block.id,
      profileJson,
    )

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

    applySpeakerLinks(
      db,
      JSON.stringify(entrySpeakerMap),
      entryId,
      quantomoId,
    )
    applyEntryManualTagsAsLinks(
      db,
      JSON.stringify(blockTags),
      entryId,
      quantomoId,
    )

    if (session.primary_person_id) {
      db.prepare(
        `UPDATE entity_links SET role = 'primary'
         WHERE entity_kind = 'person' AND entity_id = ? AND entry_id = ?
           AND role IN ('mentioned', 'participant')`,
      ).run(session.primary_person_id, entryId)
    }
    if (session.primary_project_id) {
      db.prepare(
        `UPDATE entity_links SET role = 'primary'
         WHERE entity_kind = 'project' AND entity_id = ? AND entry_id = ?
           AND role IN ('mentioned', 'participant')`,
      ).run(session.primary_project_id, entryId)
    }

    createEntityProposalsFromEntry(db, entryId)

    db.prepare(
      `UPDATE chat_blocks SET
        estado = 'analizado',
        entry_id = ?,
        quantomo_id = ?,
        human_weight = COALESCE(human_weight, ?),
        summary_json = ?
       WHERE id = ?`,
    ).run(
      entryId,
      quantomoId,
      weight,
      JSON.stringify({
        title,
        summary: extraction.summary,
        quantomo: extraction.quantomo,
        entities: extraction.entities,
        locations: extraction.locations,
        milestones: extraction.milestones,
        suggested_weight: extraction.suggested_weight,
      }),
      block.id,
    )

    db.prepare(
      `UPDATE chat_messages SET estado_procesamiento = 'analizado'
       WHERE block_id = ?`,
    ).run(block.id)

    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }

  // No embeber en caliente: la trial key Cohere se satura (chat + embed).
  // Los quántomos/entries quedan approved; Mnemosyne puede correr aparte.

  return {
    block_id: block.id,
    entry_id: entryId,
    quantomo_id: quantomoId,
    title,
  }
}

export function listChatSessions(): Array<
  ChatSession & {
    message_count: number
    block_count: number
    link_count: number
    pending_blocks: number
  }
> {
  const db = getDb()
  return rows(
    db
      .prepare(
        `SELECT s.*,
          (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_session_id = s.id) AS message_count,
          (SELECT COUNT(*) FROM chat_blocks b WHERE b.chat_session_id = s.id) AS block_count,
          (SELECT COUNT(*) FROM link_harvest l WHERE l.chat_session_id = s.id) AS link_count,
          (SELECT COUNT(*) FROM chat_blocks b
            WHERE b.chat_session_id = s.id AND b.estado = 'pendiente') AS pending_blocks
         FROM chat_sessions s
         ORDER BY s.created_at DESC`,
      )
      .all(),
  )
}

export function getChatSessionDetail(sessionId: string): {
  session: ChatSession
  speakers: ChatSpeakerMap[]
  blocks: ChatBlock[]
  messages_sample: ChatMessage[]
  stats: {
    message_count: number
    system_count: number
    media_count: number
    link_count: number
    pending_blocks: number
  }
} | null {
  const db = getDb()
  const session = row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )
  if (!session) return null

  const blocks = rows<ChatBlock>(
    db
      .prepare(
        `SELECT * FROM chat_blocks
         WHERE chat_session_id = ?
         ORDER BY started_at ASC`,
      )
      .all(sessionId),
  )
  const previewSource = rows<ChatMessage>(
    db
      .prepare(
        `SELECT * FROM chat_messages
         WHERE chat_session_id = ? AND is_system = 0
         ORDER BY timestamp_exact ASC, sort_index ASC`,
      )
      .all(sessionId),
  )
  const previews = previewMessagesByBlock(previewSource)
  for (const b of blocks) {
    b.preview_messages = previews.get(b.id) ?? []
  }
  const messages_sample = previewSource.slice(0, 40)

  const statsRow = row<{
    message_count: number
    system_count: number
    media_count: number
  }>(
    db
      .prepare(
        `SELECT
          COUNT(*) AS message_count,
          SUM(CASE WHEN is_system = 1 THEN 1 ELSE 0 END) AS system_count,
          SUM(CASE WHEN is_media = 1 THEN 1 ELSE 0 END) AS media_count
         FROM chat_messages WHERE chat_session_id = ?`,
      )
      .get(sessionId),
  )

  const link_count = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM link_harvest WHERE chat_session_id = ?`,
        )
        .get(sessionId) as { n: number | bigint }
    ).n ?? 0,
  )
  const pending_blocks = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM chat_blocks
           WHERE chat_session_id = ? AND estado = 'pendiente'`,
        )
        .get(sessionId) as { n: number | bigint }
    ).n ?? 0,
  )

  return {
    session,
    speakers: hydrateSpeakerMap(
      db,
      parseChatSpeakerMap(session.speaker_map_json),
    ),
    blocks,
    messages_sample,
    stats: {
      message_count: Number(statsRow?.message_count ?? 0),
      system_count: Number(statsRow?.system_count ?? 0),
      media_count: Number(statsRow?.media_count ?? 0),
      link_count,
      pending_blocks,
    },
  }
}

function purgeEntryRows(db: DatabaseSync, entryId: string): void {
  const quantomoIds = rows<{ id: string }>(
    db.prepare(`SELECT id FROM quantomos WHERE entry_id = ?`).all(entryId),
  )
  for (const q of quantomoIds) {
    db.prepare(
      `DELETE FROM embeddings WHERE object_type = 'quantomo' AND object_id = ?`,
    ).run(q.id)
  }
  db.prepare(`DELETE FROM quantomos WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM pending_tasks WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entry_entities_raw WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entity_proposals WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM entity_links WHERE entry_id = ?`).run(entryId)
  db.prepare(`DELETE FROM validated_file_metadata WHERE entry_id = ?`).run(
    entryId,
  )
  db.prepare(
    `DELETE FROM embeddings WHERE object_type = 'entry' AND object_id = ?`,
  ).run(entryId)
  db.prepare(
    `DELETE FROM embeddings WHERE object_type = 'entry_chunk' AND object_id LIKE ?`,
  ).run(`${entryId}:%`)
  db.prepare(`DELETE FROM entries WHERE id = ?`).run(entryId)
}

export function deleteChatSession(sessionId: string): {
  id: string
  deleted_blocks: number
  deleted_entries: number
} {
  if (processingSessions.has(sessionId)) {
    const err = new Error(
      'Esta conversación se está destilando; esperá o reintentá.',
    ) as Error & { status?: number }
    err.status = 409
    throw err
  }
  const db = getDb()
  const session = row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )
  if (!session) {
    const err = new Error('Sesión no encontrada') as Error & { status?: number }
    err.status = 404
    throw err
  }

  const blocks = rows<ChatBlock>(
    db
      .prepare(`SELECT * FROM chat_blocks WHERE chat_session_id = ?`)
      .all(sessionId),
  )
  const entryIds = new Set<string>()
  for (const b of blocks) {
    if (b.entry_id) entryIds.add(b.entry_id)
  }
  const extraEntries = rows<{ id: string }>(
    db
      .prepare(`SELECT id FROM entries WHERE original_filename LIKE ?`)
      .all(`chat:${sessionId}:%`),
  )
  for (const e of extraEntries) entryIds.add(e.id)

  db.exec('BEGIN')
  try {
    for (const entryId of entryIds) {
      purgeEntryRows(db, entryId)
    }
    const orphanQuantomos = rows<{ id: string }>(
      db
        .prepare(
          `SELECT id FROM quantomos
           WHERE source_kind = 'chat_import' AND source_id IN (
             SELECT id FROM chat_blocks WHERE chat_session_id = ?
           )`,
        )
        .all(sessionId),
    )
    for (const q of orphanQuantomos) {
      db.prepare(
        `DELETE FROM embeddings WHERE object_type = 'quantomo' AND object_id = ?`,
      ).run(q.id)
      db.prepare(`DELETE FROM quantomos WHERE id = ?`).run(q.id)
    }
    db.prepare(`DELETE FROM link_harvest WHERE chat_session_id = ?`).run(
      sessionId,
    )
    db.prepare(`DELETE FROM chat_messages WHERE chat_session_id = ?`).run(
      sessionId,
    )
    db.prepare(`DELETE FROM chat_blocks WHERE chat_session_id = ?`).run(
      sessionId,
    )
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(sessionId)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }

  try {
    const dir = vaultChatDir(sessionId)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch (err) {
    console.warn('[chats] vault cleanup failed:', err)
  }

  return {
    id: sessionId,
    deleted_blocks: blocks.length,
    deleted_entries: entryIds.size,
  }
}

export function updateChatSession(
  sessionId: string,
  patch: {
    nombre_chat?: string
    tipo?: ChatTipo
    speaker_map?: ChatSpeakerMap[]
    person_ids?: string[]
    project_ids?: string[]
    primary_person_id?: string | null
    primary_project_id?: string | null
    human_weight?: number | null
  },
): ChatSession {
  const db = getDb()
  const session = row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )
  if (!session) throw new Error('Sesión no encontrada')

  const now = new Date().toISOString()
  let speakers = parseChatSpeakerMap(session.speaker_map_json)
  if (patch.speaker_map) {
    speakers = hydrateSpeakerMap(db, patch.speaker_map)
    for (const s of speakers) {
      if (s.person_id && s.remitente) addPersonAlias(db, s.person_id, s.remitente)
    }
  }

  const personIds = uniqueIds([
    ...(patch.person_ids ?? parseJsonArray(session.linked_person_ids_json)),
    ...speakers.map((s) => s.person_id ?? ''),
    patch.primary_person_id !== undefined
      ? (patch.primary_person_id ?? '')
      : (session.primary_person_id ?? ''),
  ])
  const projectIds = uniqueIds([
    ...(patch.project_ids ?? parseJsonArray(session.linked_project_ids_json)),
    patch.primary_project_id !== undefined
      ? (patch.primary_project_id ?? '')
      : (session.primary_project_id ?? ''),
  ])

  const weight =
    patch.human_weight === undefined
      ? session.human_weight
      : patch.human_weight == null
        ? null
        : Math.max(1, Math.min(12, Math.round(patch.human_weight)))

  db.prepare(
    `UPDATE chat_sessions SET
      nombre_chat = ?,
      tipo = ?,
      speaker_map_json = ?,
      linked_person_ids_json = ?,
      linked_project_ids_json = ?,
      primary_person_id = ?,
      primary_project_id = ?,
      human_weight = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    (patch.nombre_chat ?? session.nombre_chat).trim() || session.nombre_chat,
    patch.tipo ?? session.tipo,
    JSON.stringify(speakers),
    JSON.stringify(personIds),
    JSON.stringify(projectIds),
    patch.primary_person_id !== undefined
      ? patch.primary_person_id
      : session.primary_person_id ?? null,
    patch.primary_project_id !== undefined
      ? patch.primary_project_id
      : session.primary_project_id ?? null,
    weight ?? null,
    now,
    sessionId,
  )

  return row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )!
}

export function updateChatBlock(
  sessionId: string,
  blockId: string,
  patch: {
    person_ids?: string[]
    project_ids?: string[]
    entities?: BookmarkManualTag[]
    human_weight?: number | null
    notes?: string
    links?: string[]
  },
): ChatBlock {
  const db = getDb()
  const block = row<ChatBlock>(
    db
      .prepare(
        `SELECT * FROM chat_blocks WHERE id = ? AND chat_session_id = ?`,
      )
      .get(blockId, sessionId),
  )
  if (!block) throw new Error('Bloque no encontrado')

  const personIds =
    patch.person_ids !== undefined
      ? uniqueIds(patch.person_ids)
      : parseJsonArray(block.linked_person_ids_json)
  const projectIds =
    patch.project_ids !== undefined
      ? uniqueIds(patch.project_ids)
      : parseJsonArray(block.linked_project_ids_json)
  const extraEntities =
    patch.entities !== undefined
      ? patch.entities.filter((t) => isExtraEntityKind(t.kind))
      : parseLinkedEntitiesJson(block.linked_entities_json)
  const weight =
    patch.human_weight === undefined
      ? block.human_weight
      : patch.human_weight == null
        ? null
        : Math.max(1, Math.min(12, Math.round(patch.human_weight)))
  const notes =
    patch.notes !== undefined ? patch.notes : (block.notes ?? '')
  const links =
    patch.links !== undefined
      ? uniqueIds(patch.links)
      : parseJsonArray(block.links_json)

  db.prepare(
    `UPDATE chat_blocks SET
      linked_person_ids_json = ?,
      linked_project_ids_json = ?,
      linked_entities_json = ?,
      human_weight = ?,
      notes = ?,
      links_json = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(personIds),
    JSON.stringify(projectIds),
    serializeLinkedEntities(extraEntities),
    weight ?? null,
    notes,
    JSON.stringify(links),
    blockId,
  )

  if (block.entry_id && block.quantomo_id) {
    applyEntryManualTagsAsLinks(
      db,
      JSON.stringify(tagsFromIds(db, personIds, projectIds, extraEntities)),
      block.entry_id,
      block.quantomo_id,
    )
    if (weight != null) {
      db.prepare(
        `UPDATE quantomos SET human_weight = ?, hermetic_weight = ?
         WHERE id = ?`,
      ).run(weight, weight, block.quantomo_id)
      db.prepare(`UPDATE entries SET human_weight = ? WHERE id = ?`).run(
        weight,
        block.entry_id,
      )
    }
  }

  return row<ChatBlock>(
    db.prepare(`SELECT * FROM chat_blocks WHERE id = ?`).get(blockId),
  )!
}

export type ChatBlockEntityView = {
  name: string
  type: 'person' | 'project' | string
  kind?: string
  category?: string
  status?: string
  assigned_id?: string | null
  assigned_name?: string | null
  proposal_id?: string | null
  proposal_type?: string | null
  suggested_match_id?: string | null
  suggested_match_name?: string | null
}

export function getChatBlockDetail(
  sessionId: string,
  blockId: string,
): {
  session: ChatSession
  block: ChatBlock
  messages: ChatMessage[]
  speakers: ChatSpeakerMap[]
  entities: ChatBlockEntityView[]
} | null {
  const db = getDb()
  const session = row<ChatSession>(
    db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(sessionId),
  )
  if (!session) return null
  const block = row<ChatBlock>(
    db
      .prepare(
        `SELECT * FROM chat_blocks WHERE id = ? AND chat_session_id = ?`,
      )
      .get(blockId, sessionId),
  )
  if (!block) return null

  const messages = rows<ChatMessage>(
    db
      .prepare(
        `SELECT * FROM chat_messages
         WHERE block_id = ?
         ORDER BY timestamp_exact ASC, sort_index ASC`,
      )
      .all(blockId),
  )

  let summary: {
    entities?: Array<{
      name: string
      type: string
      kind?: string
      category?: string
      status?: string
      assigned_id?: string | null
      assigned_name?: string | null
    }>
  } = {}
  try {
    summary = JSON.parse(block.summary_json || '{}') as typeof summary
  } catch {
    summary = {}
  }

  const proposals = block.entry_id
    ? rows<EntityProposal>(
        db
          .prepare(
            `SELECT * FROM entity_proposals
             WHERE entry_id = ? AND status = 'pending'
             ORDER BY created_at ASC`,
          )
          .all(block.entry_id),
      )
    : []

  const entities: ChatBlockEntityView[] = (summary.entities ?? []).map((e) => {
    const proposal = proposals.find(
      (p) =>
        p.kind === e.type &&
        normalizeName(p.suggested_name) === normalizeName(e.name),
    )
    let meta: Record<string, unknown> = {}
    try {
      meta = proposal
        ? (JSON.parse(proposal.suggested_meta || '{}') as Record<
            string,
            unknown
          >)
        : {}
    } catch {
      meta = {}
    }
    return {
      name: e.name,
      type: e.type,
      kind: e.kind,
      category: e.category,
      status: e.status,
      assigned_id: e.assigned_id ?? null,
      assigned_name: e.assigned_name ?? null,
      proposal_id: proposal?.id ?? null,
      proposal_type: proposal?.proposal_type ?? null,
      suggested_match_id:
        (typeof meta.suggested_match_id === 'string'
          ? meta.suggested_match_id
          : null) ||
        proposal?.matched_entity_id ||
        null,
      suggested_match_name:
        typeof meta.suggested_match_name === 'string'
          ? meta.suggested_match_name
          : typeof meta.matched_name === 'string'
            ? meta.matched_name
            : typeof meta.matched_title === 'string'
              ? meta.matched_title
              : null,
    }
  })

  return {
    session,
    block,
    messages,
    speakers: hydrateSpeakerMap(
      db,
      parseChatSpeakerMap(session.speaker_map_json),
    ),
    entities,
  }
}

export function assignBlockEntity(
  sessionId: string,
  blockId: string,
  input: {
    name: string
    type: 'person' | 'project'
    action: 'link' | 'create' | 'reject'
    entity_id?: string
    create_name?: string
  },
): ChatBlockEntityView {
  const db = getDb()
  const detail = getChatBlockDetail(sessionId, blockId)
  if (!detail) throw new Error('Bloque no encontrado')
  const { block } = detail
  if (!block.entry_id) throw new Error('El bloque todavía no está procesado')

  const now = new Date().toISOString()
  const name = input.name.trim()
  if (!name) throw new Error('Nombre de entidad requerido')

  let assignedId: string | null = null
  let assignedName: string | null = null

  if (input.action === 'reject') {
    const pid = detail.entities.find((e) => e.name === name)?.proposal_id
    if (pid) {
      db.prepare(
        `UPDATE entity_proposals SET status = 'rejected', resolved_at = ?
         WHERE id = ?`,
      ).run(now, pid)
    }
  } else {
    if (input.action === 'create') {
      const createdName = (input.create_name || name).trim()
      if (input.type === 'person') {
        assignedId = randomUUID()
        assignedName = createdName
        db.prepare(
          `INSERT INTO persons (
            id, name, kind, aliases, notes, status, created_at, updated_at, source
          ) VALUES (?, ?, 'fisica', '[]', NULL, 'active', ?, ?, 'manual')`,
        ).run(assignedId, createdName, now, now)
        syncPersonAliases(assignedId, createdName, '[]')
        if (normalizeName(name) !== normalizeName(createdName)) {
          addPersonAlias(db, assignedId, name)
        }
      } else {
        assignedId = randomUUID()
        assignedName = createdName
        db.prepare(
          `INSERT INTO projects (
            id, title, category, status, aliases, notes,
            created_at, updated_at, source
          ) VALUES (?, ?, 'proyecto', 'emergente', '[]', NULL, ?, ?, 'manual')`,
        ).run(assignedId, createdName, now, now)
        syncProjectAliases(assignedId, createdName, '[]')
        if (normalizeName(name) !== normalizeName(createdName)) {
          addProjectAlias(db, assignedId, name)
        }
      }
    } else {
      assignedId = input.entity_id?.trim() || null
      if (!assignedId) throw new Error('entity_id requerido para vincular')
      if (input.type === 'person') {
        assignedName = personNameById(db, assignedId)
        if (!assignedName) throw new Error('Persona no encontrada')
        addPersonAlias(db, assignedId, name)
      } else {
        assignedName = projectTitleById(db, assignedId)
        if (!assignedName) throw new Error('Proyecto no encontrado')
        addProjectAlias(db, assignedId, name)
      }
    }

    applyEntryManualTagsAsLinks(
      db,
      JSON.stringify([
        {
          kind: input.type,
          entity_id: assignedId,
          entity_name: assignedName,
        } satisfies BookmarkManualTag,
      ]),
      block.entry_id,
      block.quantomo_id,
    )

    const proposal = detail.entities.find(
      (e) =>
        e.name === name &&
        e.type === input.type &&
        e.proposal_id,
    )
    if (proposal?.proposal_id) {
      db.prepare(
        `UPDATE entity_proposals
         SET status = 'accepted', matched_entity_id = ?, resolved_at = ?
         WHERE id = ?`,
      ).run(assignedId, now, proposal.proposal_id)
    }
  }

  let summary: {
    entities?: Array<Record<string, unknown>>
    [k: string]: unknown
  } = {}
  try {
    summary = JSON.parse(block.summary_json || '{}') as typeof summary
  } catch {
    summary = {}
  }
  const entities = Array.isArray(summary.entities) ? summary.entities : []
  const nextEntities = entities.map((e) => {
    if (String(e.name) !== name || String(e.type) !== input.type) return e
    if (input.action === 'reject') {
      return { ...e, assigned_id: null, assigned_name: null, discarded: true }
    }
    return {
      ...e,
      assigned_id: assignedId,
      assigned_name: assignedName,
      discarded: false,
    }
  })
  summary.entities = nextEntities
  const allAssigned = nextEntities.every(
    (e) => e.assigned_id || e.discarded,
  )
  db.prepare(
    `UPDATE chat_blocks SET summary_json = ?, entities_reviewed = ? WHERE id = ?`,
  ).run(JSON.stringify(summary), allAssigned ? 1 : 0, blockId)

  return {
    name,
    type: input.type,
    assigned_id: assignedId,
    assigned_name: assignedName,
  }
}

export type { ParsedChat }
