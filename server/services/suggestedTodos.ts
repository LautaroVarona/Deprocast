/**
 * Sugeridor de TODOs a partir del corpus vivo.
 * No escribe pending_tasks ni CalendarTask: tabla suggested_todos.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import { canCallLlm } from './appSettings.js'
import { llmChat } from './llmChat.js'
import { parseJsonObject } from './groqExtractor.js'
import { pulseFromRepo } from './knowledgeStack.js'
import { listWaitingEntities } from './personMatchmaker.js'
import { listWaitingProjects } from './projectMatchmaker.js'
import { AppError } from '../errors.js'
import type {
  SuggestedHorizon,
  SuggestedTodo,
  SuggestedTodoAcceptance,
  SuggestedTodoCoagulation,
  SuggestedTodoEntityRef,
  SuggestedTodoPriority,
  SuggestedTodoRelations,
  SuggestedTodoSource,
  SuggestedTodoSourceKind,
  SuggestedTodoStatus,
  SuggestedTodoWindow,
} from '../types.js'

export const VARONA_TZ = 'Europe/Madrid'
const WORK_DOW = [1, 2, 3, 4, 5]
const HOME_DOW = [6, 7]
const WORK_TIME = '08:30'
const HOME_TIME = '20:00'
const FRIDAY = 5
const NEAR_CAP = 12
const HIGH_WEIGHT = 8

type Candidate = {
  title: string
  why: string
  horizon: SuggestedHorizon
  estimate_minutes?: number
  suggested_window?: SuggestedTodoWindow
  priority: SuggestedTodoPriority
  relations: SuggestedTodoRelations
  source: SuggestedTodoSource
  gravity?: number
  area?: string
  coagulation?: SuggestedTodoCoagulation
  parent_id?: string
}

type TodoRow = {
  id: string
  fingerprint: string
  title: string
  why: string
  horizon: string
  estimate_minutes: number | null
  suggested_window: string | null
  priority: number
  status: string
  relations_json: string
  source_json: string
  acceptance_json: string | null
  hold_at: string | null
  parent_id?: string | null
  coagulation?: string | null
  gravity?: number | null
  area?: string | null
  intention_at?: string | null
  collapsed_at?: string | null
  created_at: string
  updated_at: string
}

function useDb(db?: DatabaseSync): DatabaseSync {
  return db ?? getDb()
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function emptyRelations(): SuggestedTodoRelations {
  return {
    project_ids: [],
    person_ids: [],
    knowledge_ids: [],
    domain_ids: [],
    entity_refs: [],
  }
}

function withRef(
  rel: SuggestedTodoRelations,
  kind: string,
  id: string,
  label: string,
): SuggestedTodoRelations {
  const refs = rel.entity_refs ? [...rel.entity_refs] : []
  if (!refs.some((r) => r.kind === kind && r.id === id)) {
    refs.push({ kind, id, label })
  }
  const next = { ...rel, entity_refs: refs }
  if (kind === 'project' && !next.project_ids.includes(id)) {
    next.project_ids = [...next.project_ids, id]
  }
  if (kind === 'person' && !next.person_ids.includes(id)) {
    next.person_ids = [...next.person_ids, id]
  }
  if (kind === 'knowledge' && !next.knowledge_ids.includes(id)) {
    next.knowledge_ids = [...next.knowledge_ids, id]
  }
  if (kind === 'dominio' && !next.domain_ids.includes(id)) {
    next.domain_ids = [...next.domain_ids, id]
  }
  return next
}

function fingerprintOf(rule: string, refs: string[]): string {
  const key = `${rule}\0${[...refs].map(String).sort().join('\0')}`
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

function clampGravity(n: number): number {
  return Math.min(12, Math.max(1, Math.round(n)))
}

export function gravityFromEstimate(
  estimate?: number,
  weight?: number | null,
): number {
  if (weight != null && Number.isFinite(weight) && weight >= 1) {
    return clampGravity(weight)
  }
  if (estimate == null) return 6
  if (estimate >= 90) return 10
  if (estimate >= 45) return 7
  if (estimate >= 25) return 5
  return 3
}

export function areaFromRelations(
  rel: SuggestedTodoRelations,
  rule?: string,
): string {
  const blob = rel.domain_ids.join(' ').toLowerCase()
  if (/derecho|legal/.test(blob)) return 'derecho'
  if (/vital|salud/.test(blob)) return 'vitalidad'
  if (/finanz/.test(blob)) return 'finanzas'
  if (/biblio/.test(blob)) return 'biblioteca'
  if (/territorio|geo/.test(blob)) return 'territorio'
  if (/memoria/.test(blob)) return 'memoria'
  if (rule?.startsWith('ida')) return 'territorio'
  if (rule?.startsWith('knowledge')) return 'memoria'
  if (rule?.startsWith('waiting')) return 'criba'
  if (rule?.startsWith('project')) return 'captura'
  return 'captura'
}

export function coagulationFromRule(rule?: string): SuggestedTodoCoagulation {
  if (rule?.startsWith('ida')) return 'immutable'
  if (rule === 'knowledge.curriculum' || rule?.startsWith('project.active')) {
    return 'routine'
  }
  return 'suggestion'
}

function decorateCandidate(c: Candidate): Candidate {
  const rule = c.source.rule
  return {
    ...c,
    gravity: c.gravity ?? gravityFromEstimate(c.estimate_minutes),
    area: c.area ?? areaFromRelations(c.relations, rule),
    coagulation: c.coagulation ?? coagulationFromRule(rule),
  }
}

function workWindow(): SuggestedTodoWindow {
  return { dow: [...WORK_DOW], time_local: WORK_TIME }
}

function homeWindow(): SuggestedTodoWindow {
  return { dow: [...HOME_DOW], time_local: HOME_TIME }
}

function parseStringArray(raw: string | null | undefined): string[] {
  const v = parseJson<unknown>(raw, [])
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

function hasRutaTag(tags: string[]): boolean {
  return tags.some((t) => /^ruta[-_]/i.test(t.trim()))
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const hit = row<{ n: number }>(
    db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name),
  )
  return (hit?.n ?? 0) > 0
}

function madridParts(d: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dow: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: VARONA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  const weekday = (map.weekday ?? 'Mon').slice(0, 3)
  const dowMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    dow: dowMap[weekday] ?? 1,
  }
}

function fromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: VARONA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const asUtc = (date: Date) => {
    const map: Record<string, string> = {}
    for (const p of dtf.formatToParts(date)) {
      if (p.type !== 'literal') map[p.type] = p.value
    }
    return Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    )
  }
  const offset = asUtc(new Date(utcGuess)) - utcGuess
  return new Date(utcGuess - offset)
}

function addDaysYmd(
  y: number,
  m: number,
  d: number,
  days: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  }
}

function parseHm(raw: string | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((raw ?? WORK_TIME).trim())
  if (!m) return { h: 8, m: 30 }
  return { h: Number(m[1]), m: Number(m[2]) }
}

function isWorkItem(rel: SuggestedTodoRelations, casaPersonIds: Set<string>): boolean {
  if (rel.domain_ids.includes('dom-salud')) return false
  if (rel.person_ids.some((id) => casaPersonIds.has(id))) return false
  return true
}

export function computeHoldAt(
  window: SuggestedTodoWindow | undefined,
  now = new Date(),
  work = true,
): string {
  const win = window ?? (work ? workWindow() : homeWindow())
  const allowed = (win.dow && win.dow.length > 0 ? win.dow : work ? WORK_DOW : HOME_DOW).slice()
  const { h, m } = parseHm(win.time_local)
  const parts = madridParts(now)
  for (let i = 0; i < 14; i++) {
    const ymd = addDaysYmd(parts.year, parts.month, parts.day, i)
    const probe = fromZoned(ymd.year, ymd.month, ymd.day, 12, 0)
    const dow = madridParts(probe).dow
    if (!allowed.includes(dow)) continue
    if (work && dow === FRIDAY && h >= 15) continue
    const candidate = fromZoned(ymd.year, ymd.month, ymd.day, h, m)
    if (candidate.getTime() > now.getTime() - 60_000) {
      return candidate.toISOString()
    }
  }
  const fallback = fromZoned(parts.year, parts.month, parts.day + 1, h, m)
  return fallback.toISOString()
}

function hydrate(r: TodoRow): SuggestedTodo {
  const relations = parseJson<SuggestedTodoRelations>(r.relations_json, emptyRelations())
  const source = parseJson<SuggestedTodoSource>(r.source_json, {
    kind: 'heuristic',
    refs: [],
  })
  const window = r.suggested_window
    ? parseJson<SuggestedTodoWindow | undefined>(r.suggested_window, undefined)
    : undefined
  const acceptance = r.acceptance_json
    ? parseJson<SuggestedTodoAcceptance | undefined>(r.acceptance_json, undefined)
    : undefined
  const todo: SuggestedTodo = {
    id: r.id,
    fingerprint: r.fingerprint,
    title: r.title,
    why: r.why,
    horizon: r.horizon as SuggestedHorizon,
    priority: r.priority as SuggestedTodoPriority,
    status: r.status as SuggestedTodoStatus,
    relations: {
      project_ids: relations.project_ids ?? [],
      person_ids: relations.person_ids ?? [],
      knowledge_ids: relations.knowledge_ids ?? [],
      domain_ids: relations.domain_ids ?? [],
      entity_refs: relations.entity_refs ?? [],
    },
    source,
    hold_at: r.hold_at,
    parent_id: r.parent_id ?? null,
    coagulation: (r.coagulation as SuggestedTodoCoagulation) || 'suggestion',
    gravity: r.gravity ?? null,
    area: r.area ?? null,
    intention_at: r.intention_at ?? null,
    collapsed_at: r.collapsed_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
  if (r.estimate_minutes != null) todo.estimate_minutes = r.estimate_minutes
  if (window && (window.dow || window.time_local)) todo.suggested_window = window
  if (acceptance) todo.acceptance = acceptance
  return todo
}

function casaPersonIds(db: DatabaseSync): Set<string> {
  if (!tableExists(db, 'persons')) return new Set()
  const hits = rows<{ id: string; name: string; aliases: string | null }>(
    db
      .prepare(`SELECT id, name, aliases FROM persons WHERE source = 'manual'`)
      .all(),
  )
  const out = new Set<string>()
  for (const p of hits) {
    const blob = `${p.name} ${p.aliases ?? ''}`.toLowerCase()
    if (/\bcami(la)?\b/.test(blob) || blob.includes('amorcito')) out.add(p.id)
  }
  return out
}

function personLabel(db: DatabaseSync, id: string): string | null {
  const p = row<{ name: string }>(
    db.prepare(`SELECT name FROM persons WHERE id = ?`).get(id),
  )
  return p?.name ?? null
}

function projectLabel(db: DatabaseSync, id: string): string | null {
  const p = row<{ title: string }>(
    db.prepare(`SELECT title FROM projects WHERE id = ?`).get(id),
  )
  return p?.title ?? null
}

function domainIdsOf(raw: string | null): string[] {
  return parseStringArray(raw)
}

function projectPeople(db: DatabaseSync, projectId: string): SuggestedTodoEntityRef[] {
  if (!tableExists(db, 'person_project_links')) return []
  return rows<{ person_id: string; name: string }>(
    db
      .prepare(
        `SELECT l.person_id, p.name
         FROM person_project_links l
         JOIN persons p ON p.id = l.person_id
         WHERE l.project_id = ?`,
      )
      .all(projectId),
  ).map((r) => ({ kind: 'person', id: r.person_id, label: r.name }))
}

function entryRelations(db: DatabaseSync, entryId: string): SuggestedTodoRelations {
  let rel = emptyRelations()
  if (!tableExists(db, 'entity_links')) return rel
  const links = rows<{ entity_kind: string; entity_id: string }>(
    db
      .prepare(
        `SELECT entity_kind, entity_id FROM entity_links WHERE entry_id = ?`,
      )
      .all(entryId),
  )
  for (const l of links) {
    if (l.entity_kind === 'person') {
      const name = personLabel(db, l.entity_id)
      if (name) rel = withRef(rel, 'person', l.entity_id, name)
    } else if (l.entity_kind === 'project') {
      const title = projectLabel(db, l.entity_id)
      if (title) rel = withRef(rel, 'project', l.entity_id, title)
    } else if (l.entity_kind === 'geografia') {
      const g = row<{ name: string }>(
        db.prepare(`SELECT name FROM geografia WHERE id = ?`).get(l.entity_id),
      )
      if (g) rel = withRef(rel, 'geografia', l.entity_id, g.name)
    } else if (l.entity_kind === 'dominio') {
      const d = row<{ name: string }>(
        db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(l.entity_id),
      )
      if (d) rel = withRef(rel, 'dominio', l.entity_id, d.name)
    }
  }
  return rel
}

function scanCurricula(db: DatabaseSync): Candidate[] {
  if (!tableExists(db, 'knowledge_entities')) return []
  const items = rows<{
    id: string
    title: string
    weight: number | null
    tags: string
    domain_ids: string
    distilled_at: string | null
  }>(
    db
      .prepare(
        `SELECT id, title, weight, tags, domain_ids, distilled_at
         FROM knowledge_entities
         WHERE kind = 'curriculum' AND status != 'error'`,
      )
      .all(),
  )
  const out: Candidate[] = []
  for (const k of items) {
    const tags = parseStringArray(k.tags)
    const weight = k.weight ?? 0
    const ruta = hasRutaTag(tags)
    if (!ruta && weight < HIGH_WEIGHT && k.distilled_at) continue
    let rel = emptyRelations()
    rel = withRef(rel, 'knowledge', k.id, k.title)
    for (const d of domainIdsOf(k.domain_ids)) {
      const name =
        row<{ name: string }>(db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(d))
          ?.name ?? d
      rel = withRef(rel, 'dominio', d, name)
    }
    out.push({
      title: `Seguí el curriculum «${k.title}»`,
      why: ruta
        ? `Hay una ruta marcada en Conocimiento (${tags.filter((t) => /^ruta[-_]/i.test(t)).join(', ')}).`
        : weight >= HIGH_WEIGHT
          ? `Peso ${weight}/12: conviene una sesión concreta esta semana.`
          : 'Curriculum capturado y todavía sin destilar.',
      horizon: ruta || weight >= HIGH_WEIGHT ? 'esta_semana' : 'cola',
      estimate_minutes: 90,
      gravity: weight >= 1 ? weight : 10,
      suggested_window: workWindow(),
      priority: ruta || weight >= HIGH_WEIGHT ? 2 : 3,
      relations: rel,
      source: { kind: 'curriculum', refs: [k.id], rule: 'knowledge.curriculum' },
    })
  }
  return out
}

function scanKnowledgeLive(db: DatabaseSync): Candidate[] {
  if (!tableExists(db, 'knowledge_entities')) return []
  const items = rows<{
    id: string
    title: string
    kind: string
    status: string
    weight: number | null
    distilled_at: string | null
    domain_ids: string
    archived: number | null
    last_commit_at: string | null
    pushed_at: string | null
  }>(
    db
      .prepare(
        `SELECT e.id, e.title, e.kind, e.status, e.weight, e.distilled_at, e.domain_ids,
                r.archived, r.last_commit_at, r.pushed_at
         FROM knowledge_entities e
         LEFT JOIN knowledge_repos r ON r.entity_id = e.id
         WHERE e.kind != 'curriculum'`,
      )
      .all(),
  )
  const out: Candidate[] = []
  for (const k of items) {
    let rel = emptyRelations()
    rel = withRef(rel, 'knowledge', k.id, k.title)
    for (const d of domainIdsOf(k.domain_ids)) {
      const name =
        row<{ name: string }>(db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(d))
          ?.name ?? d
      rel = withRef(rel, 'dominio', d, name)
    }
    if (k.status === 'capturing' || k.status === 'error') {
      out.push({
        title: `Revisá la captura de «${k.title}»`,
        why:
          k.status === 'error'
            ? 'La ficha de Conocimiento quedó en error; hay que reintentar o corregir.'
            : 'Sigue en capturing: la validación de este referente es una tarea concreta.',
        horizon: 'hoy',
        estimate_minutes: 15,
        suggested_window: workWindow(),
        priority: 1,
        relations: rel,
        source: {
          kind: 'knowledge',
          refs: [k.id],
          rule: 'hitl.knowledge_capture',
        },
      })
      continue
    }
    if (k.kind === 'repo') {
      const pulse = pulseFromRepo({
        archived: k.archived,
        last_commit_at: k.last_commit_at,
        pushed_at: k.pushed_at,
      })
      const weight = k.weight ?? 0
      if (pulse !== 'vivo' && weight < HIGH_WEIGHT) continue
      if (k.distilled_at && weight < HIGH_WEIGHT) continue
      out.push({
        title: k.distilled_at
          ? `Retomá el repo «${k.title}»`
          : `Destilá el repo «${k.title}»`,
        why:
          pulse === 'vivo'
            ? 'Pulso vivo: hay señal reciente y todavía no hay átomo destilado (o el peso pide atención).'
            : `Peso ${weight}/12: conviene extraer utilidad votada.`,
        horizon: 'esta_semana',
        estimate_minutes: 45,
        suggested_window: workWindow(),
        priority: 2,
        relations: rel,
        source: { kind: 'knowledge', refs: [k.id], rule: 'knowledge.repo_pulse' },
      })
      continue
    }
    if (!k.distilled_at && (k.weight ?? 0) >= HIGH_WEIGHT) {
      out.push({
        title: `Destilá «${k.title}»`,
        why: `Referente de peso ${k.weight}/12 sin destilar.`,
        horizon: 'esta_semana',
        estimate_minutes: 45,
        suggested_window: workWindow(),
        priority: 2,
        relations: rel,
        source: { kind: 'knowledge', refs: [k.id], rule: 'knowledge.undistilled' },
      })
    }
  }
  return out
}

function scanHarvest(db: DatabaseSync): Candidate[] {
  if (!tableExists(db, 'link_harvest')) return []
  const items = rows<{ id: string; url_cruda: string; estado_crawler: string }>(
    db
      .prepare(
        `SELECT id, url_cruda, estado_crawler FROM link_harvest
         WHERE estado_crawler NOT IN ('crawled')
         ORDER BY created_at DESC
         LIMIT 8`,
      )
      .all(),
  )
  return items.map((h) => {
    const short = h.url_cruda.length > 48 ? `${h.url_cruda.slice(0, 45)}…` : h.url_cruda
    return {
      title: `Capturá el enlace ${short}`,
      why: `Harvest en estado «${h.estado_crawler}»: lo cargaste y todavía no es ficha de Conocimiento.`,
      horizon: 'esta_semana' as const,
      estimate_minutes: 15,
      suggested_window: workWindow(),
      priority: 2 as const,
      relations: emptyRelations(),
      source: {
        kind: 'heuristic' as const,
        refs: [h.id],
        rule: 'hitl.link_harvest',
      },
    }
  })
}

function scanProjects(db: DatabaseSync, now: Date): Candidate[] {
  if (!tableExists(db, 'projects')) return []
  const items = rows<{
    id: string
    title: string
    status: string
    updated_at: string
  }>(
    db
      .prepare(
        `SELECT id, title, status, updated_at FROM projects
         WHERE status IN ('activo', 'emergente')
           AND source = 'manual'
           AND (merged_into IS NULL OR merged_into = '')`,
      )
      .all(),
  )
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const out: Candidate[] = []
  for (const p of items) {
    let rel = emptyRelations()
    rel = withRef(rel, 'project', p.id, p.title)
    for (const person of projectPeople(db, p.id)) {
      rel = withRef(rel, person.kind, person.id, person.label)
    }
    const stale = Date.parse(p.updated_at) < weekAgo
    out.push({
      title: `Avanzá el proyecto «${p.title}»`,
      why: stale
        ? 'Proyecto activo sin movimiento reciente: un paso táctico visible esta semana.'
        : p.status === 'emergente'
          ? 'Está emergente: conviene anclar el siguiente movimiento.'
          : 'Proyecto activo: un frente técnico concreto, no dejarlo solo en el roster.',
      horizon: stale ? 'hoy' : 'esta_semana',
      estimate_minutes: 45,
      suggested_window: workWindow(),
      priority: stale ? 2 : 3,
      relations: rel,
      source: { kind: 'project', refs: [p.id], rule: 'project.active' },
    })
  }
  return out
}

function scanWaiting(db: DatabaseSync): Candidate[] {
  const out: Candidate[] = []
  if (tableExists(db, 'persons')) {
    for (const p of listWaitingEntities(db)) {
      let rel = emptyRelations()
      rel = withRef(rel, 'person', p.id, p.name)
      out.push({
        title: `Resolvé a «${p.name}» en sala de espera`,
        why: 'Salió del extractor y todavía no tiene ficha maestra: vincular, promover o descartar.',
        horizon: 'hoy',
        estimate_minutes: 25,
        suggested_window: workWindow(),
        priority: 1,
        relations: rel,
        source: {
          kind: 'person_waiting',
          refs: [p.id],
          rule: 'waiting.person',
        },
      })
    }
  }
  if (tableExists(db, 'projects')) {
    for (const p of listWaitingProjects(db).slice(0, 8)) {
      let rel = emptyRelations()
      rel = withRef(rel, 'project', p.id, p.title)
      out.push({
        title: `Resolvé el proyecto «${p.title}» en sala`,
        why: 'Proyecto extraído sin maestro: la sala de espera es trabajo HITL, no archivo.',
        horizon: 'hoy',
        estimate_minutes: 25,
        suggested_window: workWindow(),
        priority: 1,
        relations: rel,
        source: {
          kind: 'person_waiting',
          refs: [p.id],
          rule: 'waiting.project',
        },
      })
    }
  }
  if (tableExists(db, 'geografia')) {
    const geos = rows<{ id: string; name: string }>(
      db
        .prepare(
          `SELECT id, name FROM geografia
           WHERE source = 'extractor'
             AND (merged_into IS NULL OR merged_into = '')
             AND status IN ('active', 'waiting')
           LIMIT 6`,
        )
        .all(),
    )
    for (const g of geos) {
      let rel = emptyRelations()
      rel = withRef(rel, 'geografia', g.id, g.name)
      out.push({
        title: `Resolvé el lugar «${g.name}» en sala`,
        why: 'Geografía extraída pendiente de maestro.',
        horizon: 'esta_semana',
        estimate_minutes: 15,
        suggested_window: workWindow(),
        priority: 2,
        relations: rel,
        source: {
          kind: 'person_waiting',
          refs: [g.id],
          rule: 'waiting.geografia',
        },
      })
    }
  }
  return out
}

function scanHitl(db: DatabaseSync): Candidate[] {
  const out: Candidate[] = []
  if (tableExists(db, 'entries')) {
    const entries = rows<{
      id: string
      title: string
      status: string
      source_type: string
    }>(
      db
        .prepare(
          `SELECT id, title, status, source_type FROM entries
           WHERE status IN ('pending_review', 'pending_criba')
           ORDER BY created_at DESC
           LIMIT 12`,
        )
        .all(),
    )
    for (const e of entries) {
      const rel = entryRelations(db, e.id)
      const aduana = e.status === 'pending_review'
      out.push({
        title: aduana
          ? `Validá en Aduana «${e.title}»`
          : `Cribá el audio «${e.title}»`,
        why: aduana
          ? 'Hay una entry en pending_review: la validación misma es la tarea.'
          : 'Audio en pending_criba: sin voto 1–12 no sigue el tubo.',
        horizon: 'hoy',
        estimate_minutes: 15,
        suggested_window: workWindow(),
        priority: 1,
        relations: rel,
        source: {
          kind: 'heuristic',
          refs: [e.id],
          rule: aduana ? 'hitl.aduana' : 'hitl.criba_audio',
        },
      })
    }
  }
  if (tableExists(db, 'bookmarks')) {
    const bms = rows<{
      id: string
      text: string
      author_name: string | null
      author_username: string | null
      source: string | null
    }>(
      db
        .prepare(
          `SELECT id, text, author_name, author_username, source FROM bookmarks
           WHERE status = 'PENDIENTE_CRIBA'
           ORDER BY imported_at DESC
           LIMIT 10`,
        )
        .all(),
    )
    for (const b of bms) {
      const who = b.author_name || b.author_username || 'bookmark'
      const origin = b.source === 'instagram' ? 'Instagram' : 'Twitter'
      out.push({
        title: `Cribá el bookmark de ${who}`,
        why: `Cargaste algo de ${origin} y no lo votaste: la criba es la tarea realizable.`,
        horizon: 'hoy',
        estimate_minutes: 15,
        suggested_window: workWindow(),
        priority: 1,
        relations: emptyRelations(),
        source: {
          kind: 'heuristic',
          refs: [b.id],
          rule: 'hitl.bookmark_criba',
        },
      })
    }
  }
  return out
}

function scanPendingTasks(db: DatabaseSync): Candidate[] {
  if (!tableExists(db, 'pending_tasks') || !tableExists(db, 'entries')) return []
  const tasks = rows<{
    id: string
    entry_id: string
    task_text: string
    tag: string | null
    title: string
  }>(
    db
      .prepare(
        `SELECT t.id, t.entry_id, t.task_text, t.tag, e.title
         FROM pending_tasks t
         JOIN entries e ON e.id = t.entry_id
         WHERE t.status IN ('suggested', 'accepted')
           AND e.status IN ('approved', 'pending_review')
         ORDER BY t.rowid DESC
         LIMIT 20`,
      )
      .all(),
  )
  return tasks.map((t) => {
    const rel = entryRelations(db, t.entry_id)
    const text = t.task_text.trim()
    return {
      title: text.length > 80 ? `${text.slice(0, 77)}…` : text,
      why: `Salió del input «${t.title}»${t.tag ? ` (tag ${t.tag})` : ''}: acción extraída, todavía abierta.`,
      horizon: 'esta_semana' as const,
      estimate_minutes: 25,
      suggested_window: workWindow(),
      priority: 2 as const,
      relations: rel,
      source: {
        kind: 'heuristic' as const,
        refs: [t.id, t.entry_id],
        rule: 'entry.pending_task',
      },
    }
  })
}

function scanIda(db: DatabaseSync, now: Date): Candidate[] {
  if (!tableExists(db, 'depro_ida_items')) return []
  const out: Candidate[] = []
  if (tableExists(db, 'depro_ida_cards')) {
    const cards = rows<{
      id: string
      ida_id: string
      question: string
      ida_title: string
      domain_ids: string
    }>(
      db
        .prepare(
          `SELECT c.id, c.ida_id, c.question, i.title AS ida_title, i.domain_ids
           FROM depro_ida_cards c
           JOIN depro_ida_items i ON i.id = c.ida_id
           WHERE i.archived = 0 AND (c.due_at IS NULL OR c.due_at <= ?)
           ORDER BY c.due_at ASC, c.created_at ASC
           LIMIT 8`,
        )
        .all(now.toISOString()),
    )
    for (const c of cards) {
      let rel = emptyRelations()
      rel = withRef(rel, 'ida', c.ida_id, c.ida_title)
      for (const d of domainIdsOf(c.domain_ids)) {
        const name =
          row<{ name: string }>(
            db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(d),
          )?.name ?? d
        rel = withRef(rel, 'dominio', d, name)
      }
      const q = c.question.trim()
      out.push({
        title: q ? `Repasá: ${q.slice(0, 72)}` : `Repasá la card de «${c.ida_title}»`,
        why: `Card IDA vencida o sin fecha en «${c.ida_title}».`,
        horizon: 'hoy',
        estimate_minutes: 15,
        suggested_window: workWindow(),
        priority: 2,
        relations: rel,
        source: { kind: 'heuristic', refs: [c.id, c.ida_id], rule: 'ida.due_card' },
      })
    }
  }
  const aprendizajes = rows<{
    id: string
    title: string
    domain_ids: string
    stage: string
  }>(
    db
      .prepare(
        `SELECT id, title, domain_ids, stage FROM depro_ida_items
         WHERE archived = 0 AND kind = 'aprendizaje'
         ORDER BY updated_at DESC
         LIMIT 4`,
      )
      .all(),
  )
  for (const i of aprendizajes) {
    let rel = emptyRelations()
    rel = withRef(rel, 'ida', i.id, i.title)
    for (const d of domainIdsOf(i.domain_ids)) {
      const name =
        row<{ name: string }>(db.prepare(`SELECT name FROM dominios WHERE id = ?`).get(d))
          ?.name ?? d
      rel = withRef(rel, 'dominio', d, name)
    }
    out.push({
      title: `Practicá «${i.title}»`,
      why: `IDA de aprendizaje en etapa ${i.stage}: hábito anclado a una ficha real, no a una rutina inventada.`,
      horizon: 'esta_semana',
      estimate_minutes: 25,
      suggested_window: workWindow(),
      priority: 3,
      relations: rel,
      source: { kind: 'heuristic', refs: [i.id], rule: 'ida.aprendizaje' },
    })
  }
  return out
}

function weekBounds(now: Date): { from: string; to: string } {
  const p = madridParts(now)
  const delta = p.dow === 7 ? 6 : p.dow - 1
  const start = addDaysYmd(p.year, p.month, p.day, -delta)
  const end = addDaysYmd(start.year, start.month, start.day, 7)
  return {
    from: fromZoned(start.year, start.month, start.day, 0, 0).toISOString(),
    to: fromZoned(end.year, end.month, end.day, 0, 0).toISOString(),
  }
}

function scanCalendarGaps(db: DatabaseSync, now: Date): Candidate[] {
  if (!tableExists(db, 'projects') || !tableExists(db, 'entity_links')) return []
  const { from, to } = weekBounds(now)
  const projects = rows<{ id: string; title: string }>(
    db
      .prepare(
        `SELECT id, title FROM projects
         WHERE status = 'activo' AND source = 'manual'
           AND (merged_into IS NULL OR merged_into = '')`,
      )
      .all(),
  )
  const out: Candidate[] = []
  for (const p of projects) {
    const hit = row<{ n: number }>(
      db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM entity_links l
           JOIN entries e ON e.id = l.entry_id
           WHERE l.entity_kind = 'project' AND l.entity_id = ?
             AND e.timestamp_exact IS NOT NULL
             AND e.timestamp_exact >= ? AND e.timestamp_exact < ?`,
        )
        .get(p.id, from, to),
    )
    if ((hit?.n ?? 0) > 0) continue
    let rel = emptyRelations()
    rel = withRef(rel, 'project', p.id, p.title)
    out.push({
      title: `Agendá un bloque para «${p.title}»`,
      why: 'Proyecto activo sin ocurrencia nativa esta semana: hay un hueco en el calendario.',
      horizon: 'proxima_semana',
      suggested_window: workWindow(),
      priority: 3,
      relations: rel,
      source: { kind: 'calendar_gap', refs: [p.id], rule: 'calendar.gap_project' },
    })
  }
  return out
}

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function applyCupo(cands: Candidate[]): Candidate[] {
  const ranked = [...cands].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const order: Record<SuggestedHorizon, number> = {
      hoy: 0,
      esta_semana: 1,
      proxima_semana: 2,
      cola: 3,
    }
    return order[a.horizon] - order[b.horizon]
  })
  const seenTitles = new Set<string>()
  const unique: Candidate[] = []
  for (const c of ranked) {
    const key = normTitle(c.title)
    if (key && seenTitles.has(key)) continue
    if (key) seenTitles.add(key)
    unique.push(c)
  }
  let near = 0
  return unique.map((c) => {
    const nearHorizon = c.horizon === 'hoy' || c.horizon === 'esta_semana'
    if (nearHorizon && near >= NEAR_CAP) {
      return { ...c, horizon: 'cola' as const }
    }
    if (nearHorizon) near += 1
    return c
  })
}

async function maybeRewriteTitles(
  cands: Candidate[],
  useLlm: boolean,
): Promise<Candidate[]> {
  if (!useLlm || cands.length === 0) return cands
  if (!canCallLlm('fast') && !canCallLlm('main')) return cands
  const role = canCallLlm('fast') ? 'fast' : 'main'
  const payload = cands.map((c, i) => ({
    i,
    title: c.title,
    why: c.why,
    rule: c.source.rule,
  }))
  try {
    const out = await llmChat({
      role,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Reescribí title (imperativo, 1 acción, español rioplatense) y why (1–2 frases). No inventes ítems ni cambies i. JSON: {"items":[{"i":0,"title":"...","why":"..."}]}',
        },
        { role: 'user', content: JSON.stringify({ items: payload }) },
      ],
    })
    const parsed = parseJsonObject(out.text)
    const items = parsed?.items
    if (!Array.isArray(items)) return cands
    const byI = new Map<number, { title?: string; why?: string }>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const rec = it as { i?: unknown; title?: unknown; why?: unknown }
      if (typeof rec.i !== 'number') continue
      byI.set(rec.i, {
        title: typeof rec.title === 'string' ? rec.title : undefined,
        why: typeof rec.why === 'string' ? rec.why : undefined,
      })
    }
    return cands.map((c, i) => {
      const hit = byI.get(i)
      if (!hit) return c
      return {
        ...c,
        title: hit.title?.trim() || c.title,
        why: hit.why?.trim() || c.why,
      }
    })
  } catch (err) {
    console.warn(
      '[todos] LLM rewrite skipped:',
      err instanceof Error ? err.message : err,
    )
    return cands
  }
}

function persistCandidates(db: DatabaseSync, cands: Candidate[]): SuggestedTodo[] {
  const now = new Date().toISOString()
  const existing = tableExists(db, 'suggested_todos')
    ? rows<TodoRow>(db.prepare(`SELECT * FROM suggested_todos`).all())
    : []
  const byFp = new Map(existing.map((r) => [r.fingerprint, r]))
  const keepFp = new Set<string>()

  const insert = db.prepare(
    `INSERT INTO suggested_todos (
      id, fingerprint, title, why, horizon, estimate_minutes, suggested_window,
      priority, status, relations_json, source_json, acceptance_json, hold_at,
      parent_id, coagulation, gravity, area, intention_at, collapsed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  )
  const updateSuggested = db.prepare(
    `UPDATE suggested_todos
     SET title = ?, why = ?, horizon = ?, estimate_minutes = ?, suggested_window = ?,
         priority = ?, relations_json = ?, source_json = ?, coagulation = ?,
         gravity = ?, area = ?, updated_at = ?
     WHERE fingerprint = ? AND status = 'suggested'`,
  )

  for (const raw of cands) {
    const c = decorateCandidate(raw)
    const fp = fingerprintOf(c.source.rule ?? c.source.kind, c.source.refs)
    keepFp.add(fp)
    const prev = byFp.get(fp)
    const windowJson = c.suggested_window ? JSON.stringify(c.suggested_window) : null
    const relJson = JSON.stringify(c.relations)
    const srcJson = JSON.stringify(c.source)
    if (prev) {
      if (prev.status === 'accepted' || prev.status === 'done' || prev.status === 'dismissed') {
        continue
      }
      updateSuggested.run(
        c.title,
        c.why,
        c.horizon,
        c.estimate_minutes ?? null,
        windowJson,
        c.priority,
        relJson,
        srcJson,
        c.coagulation ?? 'suggestion',
        c.gravity ?? null,
        c.area ?? null,
        now,
        fp,
      )
    } else {
      insert.run(
        randomUUID(),
        fp,
        c.title,
        c.why,
        c.horizon,
        c.estimate_minutes ?? null,
        windowJson,
        c.priority,
        relJson,
        srcJson,
        c.parent_id ?? null,
        c.coagulation ?? 'suggestion',
        c.gravity ?? null,
        c.area ?? null,
        now,
        now,
      )
    }
  }

  breakLongTodos(db, keepFp, now)

  if (tableExists(db, 'suggested_todos')) {
    const latest = rows<TodoRow>(db.prepare(`SELECT * FROM suggested_todos`).all())
    const stale = latest.filter(
      (r) =>
        r.status === 'suggested' &&
        !keepFp.has(r.fingerprint) &&
        !r.parent_id,
    )
    const del = db.prepare(`DELETE FROM suggested_todos WHERE id = ? AND status = 'suggested'`)
    for (const s of stale) del.run(s.id)
  }

  return listSuggestedTodos({ db })
}

export function minuteSlices(total: number): number[] {
  const slices: number[] = []
  let left = Math.max(1, Math.round(total))
  while (left > 40) {
    slices.push(40)
    left -= 40
  }
  if (left >= 26) {
    slices.push(25)
    left -= 25
  }
  if (left > 0) {
    slices.push(left < 15 ? 15 : left)
  }
  if (slices.length < 2) {
    return slices[0] === 40 ? [40, 25] : [15, 15]
  }
  return slices
}

function shouldBreak(todo: SuggestedTodo): boolean {
  if (todo.parent_id) return false
  if (todo.source.kind === 'ludus_microtask') return false
  if (todo.status !== 'suggested') return false
  if ((todo.estimate_minutes ?? 0) > 40) return true
  if (todo.estimate_minutes == null && (todo.gravity ?? 0) >= 8) return true
  return false
}

function breakLongTodos(db: DatabaseSync, keepFp: Set<string>, now: string): void {
  if (!tableExists(db, 'suggested_todos')) return
  const parents = listSuggestedTodos({ db }).filter(shouldBreak)
  const insert = db.prepare(
    `INSERT INTO suggested_todos (
      id, fingerprint, title, why, horizon, estimate_minutes, suggested_window,
      priority, status, relations_json, source_json, acceptance_json, hold_at,
      parent_id, coagulation, gravity, area, intention_at, collapsed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  )
  const parkParent = db.prepare(
    `UPDATE suggested_todos SET horizon = 'cola', updated_at = ? WHERE id = ? AND status = 'suggested'`,
  )

  for (const parent of parents) {
    const total =
      parent.estimate_minutes && parent.estimate_minutes > 40
        ? parent.estimate_minutes
        : 90
    const slices = minuteSlices(total)
    parkParent.run(now, parent.id)
    for (let i = 0; i < slices.length; i++) {
      const minutes = slices[i]
      const rule = `${parent.source.rule ?? parent.source.kind}.slice:${i}`
      const fp = fingerprintOf(rule, parent.source.refs)
      keepFp.add(fp)
      const exists = row<{ id: string }>(
        db.prepare(`SELECT id FROM suggested_todos WHERE fingerprint = ?`).get(fp),
      )
      if (exists) continue
      const source: SuggestedTodoSource = {
        kind: 'ludus_microtask' as SuggestedTodoSourceKind,
        refs: [...parent.source.refs],
        rule,
      }
      insert.run(
        randomUUID(),
        fp,
        `${parent.title} · corte ${i + 1}`,
        `Partícula de ${minutes} min extraída por el Task-Breaker.`,
        parent.horizon === 'cola' ? 'esta_semana' : parent.horizon,
        minutes,
        parent.suggested_window ? JSON.stringify(parent.suggested_window) : null,
        parent.priority,
        JSON.stringify(parent.relations),
        JSON.stringify(source),
        parent.id,
        'suggestion',
        Math.max(1, (parent.gravity ?? 6) - i),
        parent.area,
        now,
        now,
      )
    }
  }
}

export function listSuggestedTodos(opts?: {
  db?: DatabaseSync
  status?: string
  horizon?: string
  from?: string
  to?: string
}): SuggestedTodo[] {
  const db = useDb(opts?.db)
  if (!tableExists(db, 'suggested_todos')) return []
  const clauses: string[] = []
  const params: string[] = []
  if (opts?.status) {
    clauses.push('status = ?')
    params.push(opts.status)
  }
  if (opts?.horizon) {
    clauses.push('horizon = ?')
    params.push(opts.horizon)
  }
  if (opts?.from) {
    clauses.push('hold_at IS NOT NULL AND hold_at >= ?')
    params.push(opts.from)
  }
  if (opts?.to) {
    clauses.push('hold_at IS NOT NULL AND hold_at <= ?')
    params.push(opts.to)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const found = rows<TodoRow>(
    db
      .prepare(
        `SELECT * FROM suggested_todos ${where}
         ORDER BY priority ASC, horizon ASC, updated_at DESC`,
      )
      .all(...params),
  )
  return found.map(hydrate)
}

export function getSuggestedTodo(id: string, db?: DatabaseSync): SuggestedTodo | null {
  const database = useDb(db)
  if (!tableExists(database, 'suggested_todos')) return null
  const r = row<TodoRow>(
    database.prepare(`SELECT * FROM suggested_todos WHERE id = ?`).get(id),
  )
  return r ? hydrate(r) : null
}

export async function regenerateSuggestedTodos(opts?: {
  db?: DatabaseSync
  now?: Date
  useLlm?: boolean
}): Promise<{ todos: SuggestedTodo[]; created: number; updated: number }> {
  const db = useDb(opts?.db)
  const now = opts?.now ?? new Date()
  const before = new Set(listSuggestedTodos({ db }).map((t) => t.id))
  let cands: Candidate[] = [
    ...scanCurricula(db),
    ...scanKnowledgeLive(db),
    ...scanHarvest(db),
    ...scanProjects(db, now),
    ...scanWaiting(db),
    ...scanHitl(db),
    ...scanPendingTasks(db),
    ...scanIda(db, now),
    ...scanCalendarGaps(db, now),
  ]
  cands = applyCupo(cands)
  cands = await maybeRewriteTitles(cands, opts?.useLlm === true)
  const todos = persistCandidates(db, cands)
  const created = todos.filter((t) => !before.has(t.id) && t.status === 'suggested').length
  const updated = todos.filter((t) => before.has(t.id) && t.status === 'suggested').length
  return { todos, created, updated }
}

function writeStatus(
  db: DatabaseSync,
  id: string,
  patch: {
    status?: SuggestedTodoStatus
    acceptance?: SuggestedTodoAcceptance
    hold_at?: string | null
    clearHold?: boolean
    intention_at?: string | null
    collapsed_at?: string | null
  },
): SuggestedTodo {
  const current = getSuggestedTodo(id, db)
  if (!current) throw new AppError('Tarea sugerida no encontrada', 404, 'NOT_FOUND')
  const now = new Date().toISOString()
  const status = patch.status ?? current.status
  const acceptance = patch.acceptance ?? current.acceptance
  let holdAt = current.hold_at
  if (patch.clearHold) holdAt = null
  if (patch.hold_at !== undefined) holdAt = patch.hold_at
  let intentionAt = current.intention_at
  if (patch.intention_at !== undefined) intentionAt = patch.intention_at
  else if (holdAt && !intentionAt) intentionAt = holdAt
  let collapsedAt = current.collapsed_at
  if (patch.collapsed_at !== undefined) collapsedAt = patch.collapsed_at
  else if (status === 'done' && !collapsedAt) collapsedAt = now
  db.prepare(
    `UPDATE suggested_todos
     SET status = ?, acceptance_json = ?, hold_at = ?, intention_at = ?,
         collapsed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    acceptance ? JSON.stringify(acceptance) : null,
    holdAt,
    intentionAt,
    collapsedAt,
    now,
    id,
  )
  const next = getSuggestedTodo(id, db)
  if (!next) throw new AppError('Tarea sugerida no encontrada', 404, 'NOT_FOUND')
  return next
}

export function acceptSuggestedTodo(
  id: string,
  body?: { create_calendar_hold?: boolean; export_todoist_shape?: boolean },
  opts?: { db?: DatabaseSync; now?: Date },
): SuggestedTodo {
  const db = useDb(opts?.db)
  const current = getSuggestedTodo(id, db)
  if (!current) throw new AppError('Tarea sugerida no encontrada', 404, 'NOT_FOUND')
  const createHold = body?.create_calendar_hold === true
  const casa = casaPersonIds(db)
  const work = isWorkItem(current.relations, casa)
  const holdAt = createHold
    ? computeHoldAt(current.suggested_window, opts?.now ?? new Date(), work)
    : current.hold_at
  return writeStatus(db, id, {
    status: 'accepted',
    acceptance: {
      create_calendar_hold: createHold,
      export_todoist_shape: body?.export_todoist_shape === true,
    },
    hold_at: createHold ? holdAt : current.hold_at,
    intention_at: createHold ? holdAt : current.intention_at,
  })
}

export function patchSuggestedTodo(
  id: string,
  body: {
    status?: string
    acceptance?: SuggestedTodoAcceptance
  },
  opts?: { db?: DatabaseSync; now?: Date },
): SuggestedTodo {
  const db = useDb(opts?.db)
  const statuses: SuggestedTodoStatus[] = ['suggested', 'accepted', 'dismissed', 'done']
  const status =
    typeof body.status === 'string' && statuses.includes(body.status as SuggestedTodoStatus)
      ? (body.status as SuggestedTodoStatus)
      : undefined
  if (status === 'accepted') {
    return acceptSuggestedTodo(
      id,
      {
        create_calendar_hold: body.acceptance?.create_calendar_hold,
        export_todoist_shape: body.acceptance?.export_todoist_shape,
      },
      opts,
    )
  }
  return writeStatus(db, id, {
    status,
    acceptance: body.acceptance,
    clearHold: status === 'dismissed' ? true : undefined,
    collapsed_at: status === 'done' ? (opts?.now ?? new Date()).toISOString() : undefined,
  })
}

export function exportTodoistShape(opts?: { db?: DatabaseSync }): {
  items: Array<{
    content: string
    description: string
    priority: number
    due: string | null
    labels: string[]
  }>
} {
  const todos = listSuggestedTodos({
    db: opts?.db,
  }).filter((t) => t.status === 'suggested' || t.status === 'accepted')
  return {
    items: todos.map((t) => ({
      content: t.title,
      description: t.why,
      priority: Math.max(1, 5 - t.priority),
      due: t.hold_at,
      labels: [
        t.horizon,
        t.source.kind,
        ...t.relations.project_ids.map((id) => `project:${id}`),
      ],
    })),
  }
}

export function fingerprintForTest(rule: string, refs: string[]): string {
  return fingerprintOf(rule, refs)
}
