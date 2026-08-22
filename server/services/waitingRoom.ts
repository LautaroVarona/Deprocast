/**
 * Sala de espera general: menciones validadas sin ficha maestra.
 * Une waiting de persons + projects; permite resolver hacia cualquier destino.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Geografia, Person, Project } from '../types.js'
import { row, rows } from '../sql.js'
import {
  buildWaitingWithMatches as buildPersonWaiting,
  listMasterProfiles,
} from './personMatchmaker.js'
import {
  buildWaitingWithMatches as buildProjectWaiting,
  listMasterProjects,
} from './projectMatchmaker.js'
import {
  listGeografiaMasters,
  listGeografiaWaiting,
  normalizeGeoKind,
} from './geografia.js'
import {
  isProfileKind,
  normalizePersonKind,
  type PersonKind,
} from './personKinds.js'
import { normalizeProjectKind } from './entityRelations.js'
import { syncPersonAliases, syncProjectAliases } from '../db.js'

export type WaitingEntityType = 'person' | 'project' | 'geografia'
export type WaitingDestType = WaitingEntityType | 'agrupacion' | 'dominio'

export type WaitingItem = {
  id: string
  entity_type: WaitingEntityType
  name: string
  /** person.kind o project.category */
  class_label: string
  notes: string | null
  created_at: string
  link_count: number
  /** Archivo / título de la entry de origen */
  source_file: string | null
  /** Tipo de fuente (audio, blob, notebook_page…) */
  source_type: string | null
  /** Cita del NER / evidencia de mención */
  evidence_snippet: string | null
  /** Recorte del contenido de la entry cuando no hay evidencia */
  entry_excerpt: string | null
  suggested_match: {
    id: string
    name: string
    score: number
    target_type: WaitingEntityType
  } | null
  /** Sugerencias cruzadas (mismo nombre en el otro roster) */
  cross_match: {
    id: string
    name: string
    score: number
    target_type: WaitingEntityType
  } | null
}

function parseAliases(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw || '[]') as string[]
  } catch {
    return []
  }
}

function mergeAliases(existing: string[], extras: string[], canonical: string): string[] {
  const out = [...existing]
  for (const a of extras) {
    const t = String(a).trim()
    if (
      t &&
      t.toLowerCase() !== canonical.toLowerCase() &&
      !out.some((x) => x.toLowerCase() === t.toLowerCase())
    ) {
      out.push(t)
    }
  }
  return out
}

function fuzzyNameScore(a: string | null | undefined, b: string | null | undefined): number {
  const na = String(a ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  const nb = String(b ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.88
  return 0
}

function bestCrossMatch(
  name: string,
  candidates: Array<{ id: string; name: string }>,
  target_type: WaitingEntityType,
): WaitingItem['cross_match'] {
  let best: WaitingItem['cross_match'] = null
  for (const c of candidates) {
    const score = fuzzyNameScore(name, c.name)
    if (score >= 0.88 && (!best || score > best.score)) {
      best = { id: c.id, name: c.name, score, target_type }
    }
  }
  return best
}

function parseEvidenceSnippet(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { snippet?: string; mention?: string }
    return (parsed.snippet || parsed.mention || '').trim()
  } catch {
    return raw.trim()
  }
}

function clipText(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function excerptAroundName(content: string, name: string, radius = 120): string | null {
  const raw = content.replace(/\s+/g, ' ').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const needle = name.trim().toLowerCase()
  if (!needle) return clipText(raw, 280)
  const idx = lower.indexOf(needle)
  if (idx < 0) return clipText(raw, 280)
  const start = Math.max(0, idx - radius)
  const end = Math.min(raw.length, idx + needle.length + radius)
  const slice = raw.slice(start, end).trim()
  const prefix = start > 0 ? '…' : ''
  const suffix = end < raw.length ? '…' : ''
  return `${prefix}${slice}${suffix}`
}

function loadWaitingContext(
  db: DatabaseSync,
  entityKind: WaitingEntityType,
  entityId: string,
  name: string,
): Pick<
  WaitingItem,
  'link_count' | 'source_file' | 'source_type' | 'evidence_snippet' | 'entry_excerpt'
> {
  const linkCount = row<{ c: number }>(
    db
      .prepare(
        `SELECT COUNT(*) as c FROM entity_links
         WHERE entity_kind = ? AND entity_id = ?`,
      )
      .get(entityKind, entityId),
  )
  const rowsCtx = rows<{
    entry_title: string
    original_filename: string | null
    source_type: string | null
    content_raw: string | null
    evidence: string | null
  }>(
    db
      .prepare(
        `SELECT e.title as entry_title, e.original_filename, e.source_type,
                e.content_raw, ep.evidence
         FROM entity_links l
         JOIN entries e ON e.id = l.entry_id
         LEFT JOIN entity_proposals ep
           ON ep.matched_entity_id = l.entity_id
          AND ep.entry_id = l.entry_id
          AND ep.status = 'approved'
         WHERE l.entity_kind = ? AND l.entity_id = ?
         ORDER BY l.created_at DESC
         LIMIT 3`,
      )
      .all(entityKind, entityId),
  )

  const snippets: string[] = []
  let sourceFile: string | null = null
  let sourceType: string | null = null
  let entryExcerpt: string | null = null

  for (const ctx of rowsCtx) {
    if (!sourceFile) {
      sourceFile =
        (ctx.original_filename || ctx.entry_title || '').trim() || null
    }
    if (!sourceType && ctx.source_type) sourceType = ctx.source_type
    const snip = parseEvidenceSnippet(ctx.evidence)
    if (snip && !snippets.includes(snip)) snippets.push(snip)
    if (!entryExcerpt && ctx.content_raw) {
      entryExcerpt = excerptAroundName(ctx.content_raw, name)
    }
  }

  return {
    link_count: linkCount?.c ?? 0,
    source_file: sourceFile,
    source_type: sourceType,
    evidence_snippet: snippets.length > 0 ? snippets.join(' · ') : null,
    entry_excerpt: entryExcerpt,
  }
}

export function listGeneralWaiting(db: DatabaseSync): WaitingItem[] {
  const personWaiting = buildPersonWaiting(db)
  const projectWaiting = buildProjectWaiting(db)
  const geoWaiting = listGeografiaWaiting()
  const personMasters = listMasterProfiles(db).map((p) => ({
    id: p.id,
    name: p.name,
  }))
  const projectMasters = listMasterProjects(db).map((p) => ({
    id: p.id,
    name: p.title,
  }))
  const geoMasters = listGeografiaMasters().map((p) => ({
    id: p.id,
    name: p.name,
  }))

  const items: WaitingItem[] = []

  for (const p of personWaiting) {
    const same =
      p.suggested_match != null
        ? {
            id: p.suggested_match.id,
            name: p.suggested_match.name,
            score: p.suggested_match.score,
            target_type: 'person' as const,
          }
        : null
    const ctx = loadWaitingContext(db, 'person', p.id, p.name)
    items.push({
      id: p.id,
      entity_type: 'person',
      name: p.name,
      class_label: normalizePersonKind(p.kind),
      notes: p.notes,
      created_at: p.created_at,
      link_count: ctx.link_count || p.link_count || 0,
      source_file: ctx.source_file || p.source_file || null,
      source_type: ctx.source_type,
      evidence_snippet: ctx.evidence_snippet || p.evidence_snippet || null,
      entry_excerpt: ctx.entry_excerpt,
      suggested_match: same,
      cross_match:
        bestCrossMatch(p.name, projectMasters, 'project') ||
        bestCrossMatch(p.name, geoMasters, 'geografia'),
    })
  }

  for (const p of projectWaiting) {
    const same =
      p.suggested_match != null
        ? {
            id: p.suggested_match.id,
            name: p.suggested_match.name,
            score: p.suggested_match.score,
            target_type: 'project' as const,
          }
        : null
    const ctx = loadWaitingContext(db, 'project', p.id, p.title)
    items.push({
      id: p.id,
      entity_type: 'project',
      name: p.title,
      class_label: normalizeProjectKind(p.category),
      notes: p.notes,
      created_at: p.created_at,
      link_count: ctx.link_count || p.link_count || 0,
      source_file: ctx.source_file || p.source_file || null,
      source_type: ctx.source_type,
      evidence_snippet: ctx.evidence_snippet || p.evidence_snippet || null,
      entry_excerpt: ctx.entry_excerpt,
      suggested_match: same,
      cross_match:
        bestCrossMatch(p.title, personMasters, 'person') ||
        bestCrossMatch(p.title, geoMasters, 'geografia'),
    })
  }

  for (const g of geoWaiting) {
    const cross =
      bestCrossMatch(g.name, geoMasters, 'geografia') ||
      bestCrossMatch(g.name, personMasters, 'person') ||
      bestCrossMatch(g.name, projectMasters, 'project')
    const ctx = loadWaitingContext(db, 'geografia', g.id, g.name)
    items.push({
      id: g.id,
      entity_type: 'geografia',
      name: g.name,
      class_label: normalizeGeoKind(g.kind),
      notes: g.notes,
      created_at: g.created_at,
      link_count: ctx.link_count,
      source_file: ctx.source_file,
      source_type: ctx.source_type,
      evidence_snippet: ctx.evidence_snippet,
      entry_excerpt: ctx.entry_excerpt,
      suggested_match:
        cross?.target_type === 'geografia' ? cross : null,
      cross_match:
        cross && cross.target_type !== 'geografia' ? cross : null,
    })
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  return items
}

function loadWaitingPerson(db: DatabaseSync, id: string): Person | null {
  return row<Person>(
    db
      .prepare(
        `SELECT * FROM persons
         WHERE id = ? AND source = 'extractor'
           AND (merged_into IS NULL OR merged_into = '')`,
      )
      .get(id),
  )
}

function loadWaitingProject(db: DatabaseSync, id: string): Project | null {
  return row<Project>(
    db
      .prepare(
        `SELECT * FROM projects
         WHERE id = ? AND source = 'extractor'
           AND (merged_into IS NULL OR merged_into = '')`,
      )
      .get(id),
  )
}

function loadWaitingGeografia(db: DatabaseSync, id: string): Geografia | null {
  return row<Geografia>(
    db
      .prepare(
        `SELECT * FROM geografia
         WHERE id = ? AND source = 'extractor'
           AND (merged_into IS NULL OR merged_into = '')`,
      )
      .get(id),
  )
}

function reassignLinks(
  db: DatabaseSync,
  fromKind: WaitingEntityType,
  fromId: string,
  toKind: WaitingDestType,
  toId: string,
): void {
  db.prepare(
    `UPDATE entity_links
     SET entity_kind = ?, entity_id = ?
     WHERE entity_kind = ? AND entity_id = ?`,
  ).run(toKind, toId, fromKind, fromId)
}

function copyLinksToTarget(
  db: DatabaseSync,
  fromKind: WaitingEntityType,
  fromId: string,
  toKind: WaitingDestType,
  toId: string,
  now: string,
): number {
  const links = rows<{
    entry_id: string
    quantomo_id: string | null
    role: string
  }>(
    db
      .prepare(
        `SELECT entry_id, quantomo_id, role FROM entity_links
         WHERE entity_kind = ? AND entity_id = ?`,
      )
      .all(fromKind, fromId),
  )
  let n = 0
  for (const link of links) {
    const already = row<{ id: string }>(
      db
        .prepare(
          `SELECT id FROM entity_links
           WHERE entity_kind = ? AND entity_id = ? AND entry_id = ?`,
        )
        .get(toKind, toId, link.entry_id),
    )
    if (already) continue
    db.prepare(
      `INSERT INTO entity_links (
        id, entity_kind, entity_id, entry_id, quantomo_id, role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      toKind,
      toId,
      link.entry_id,
      link.quantomo_id,
      link.role || 'mentioned',
      now,
    )
    n++
  }
  return n
}

function deleteWaitingLinks(
  db: DatabaseSync,
  fromKind: WaitingEntityType,
  fromId: string,
): void {
  db.prepare(
    `DELETE FROM entity_links WHERE entity_kind = ? AND entity_id = ?`,
  ).run(fromKind, fromId)
}

function addAliasesToPerson(
  db: DatabaseSync,
  masterId: string,
  extras: string[],
  now: string,
): string | null {
  const master = row<Person>(
    db.prepare(`SELECT * FROM persons WHERE id = ?`).get(masterId),
  )
  if (!master || master.source !== 'manual') {
    throw new Error('Perfil maestro no encontrado')
  }
  const aliases = mergeAliases(
    parseAliases(master.aliases),
    extras,
    master.name,
  )
  const aliasesJson = JSON.stringify(aliases)
  db.prepare(
    `UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`,
  ).run(aliasesJson, now, master.id)
  syncPersonAliases(master.id, master.name, aliasesJson)
  return extras.find((e) => e.trim() && e.toLowerCase() !== master.name.toLowerCase()) ?? extras[0] ?? null
}

function addAliasesToProject(
  db: DatabaseSync,
  masterId: string,
  extras: string[],
  now: string,
): string | null {
  const master = row<Project>(
    db.prepare(`SELECT * FROM projects WHERE id = ?`).get(masterId),
  )
  if (!master || master.source !== 'manual') {
    throw new Error('Proyecto maestro no encontrado')
  }
  const aliases = mergeAliases(
    parseAliases(master.aliases),
    extras,
    master.title,
  )
  const aliasesJson = JSON.stringify(aliases)
  db.prepare(
    `UPDATE projects SET aliases = ?, updated_at = ? WHERE id = ?`,
  ).run(aliasesJson, now, master.id)
  syncProjectAliases(master.id, master.title, aliasesJson)
  return extras.find((e) => e.trim() && e.toLowerCase() !== master.title.toLowerCase()) ?? extras[0] ?? null
}

function addPersonToAgrupacion(
  db: DatabaseSync,
  agrupacionId: string,
  personId: string,
  now: string,
): void {
  const agrup = row<{ id: string }>(
    db.prepare(`SELECT id FROM agrupaciones WHERE id = ?`).get(agrupacionId),
  )
  if (!agrup) throw new Error('Agrupación no encontrada')
  const already = row<{ id: string }>(
    db
      .prepare(
        `SELECT id FROM agrupacion_members
         WHERE agrupacion_id = ? AND person_id = ?`,
      )
      .get(agrupacionId, personId),
  )
  if (already) return
  db.prepare(
    `INSERT INTO agrupacion_members (id, agrupacion_id, person_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), agrupacionId, personId, now)
  db.prepare(`UPDATE agrupaciones SET updated_at = ? WHERE id = ?`).run(
    now,
    agrupacionId,
  )
}

function transferAgrupacionMemberships(
  db: DatabaseSync,
  fromPersonId: string,
  toPersonId: string,
): void {
  const waitingMemberships = rows<{ id: string; agrupacion_id: string }>(
    db
      .prepare(
        `SELECT id, agrupacion_id FROM agrupacion_members WHERE person_id = ?`,
      )
      .all(fromPersonId),
  )
  for (const m of waitingMemberships) {
    const already = row<{ id: string }>(
      db
        .prepare(
          `SELECT id FROM agrupacion_members
           WHERE agrupacion_id = ? AND person_id = ?`,
        )
        .get(m.agrupacion_id, toPersonId),
    )
    if (already) {
      db.prepare(`DELETE FROM agrupacion_members WHERE id = ?`).run(m.id)
    } else {
      db.prepare(
        `UPDATE agrupacion_members SET person_id = ? WHERE id = ?`,
      ).run(toPersonId, m.id)
    }
  }
}

export type WaitingAttachTarget = {
  to_type: WaitingDestType
  target_id: string
}

function normalizeAttachTargets(
  input: ResolveWaitingInput,
): WaitingAttachTarget[] {
  const fromList = Array.isArray(input.targets) ? input.targets : []
  const out: WaitingAttachTarget[] = []
  const seen = new Set<string>()
  const push = (to_type: WaitingDestType, target_id: string) => {
    const id = target_id.trim()
    if (!id) return
    const key = `${to_type}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ to_type, target_id: id })
  }
  for (const t of fromList) {
    if (!t?.to_type || !t?.target_id) continue
    push(t.to_type, String(t.target_id))
  }
  if (out.length === 0 && input.to_type && input.target_id) {
    push(input.to_type, String(input.target_id))
  }
  return out
}

/**
 * Vincula una mención en espera a uno o varios destinos (copia links + alias/membresía).
 * Al final cierra la ficha en espera.
 */
export function attachWaitingMulti(
  db: DatabaseSync,
  waitingId: string,
  from: WaitingEntityType,
  targets: WaitingAttachTarget[],
): {
  ok: true
  result_type: WaitingDestType
  result_id: string
  alias_added?: string | null
  attached: number
} {
  if (targets.length === 0) throw new Error('Al menos un destino requerido')
  const now = new Date().toISOString()

  let waitingName = ''
  let waitingAliases: string[] = []
  if (from === 'person') {
    const waiting = loadWaitingPerson(db, waitingId)
    if (!waiting) throw new Error('Entidad en espera no encontrada')
    waitingName = waiting.name
    waitingAliases = parseAliases(waiting.aliases)
  } else if (from === 'project') {
    const waiting = loadWaitingProject(db, waitingId)
    if (!waiting) throw new Error('Proyecto en espera no encontrado')
    waitingName = waiting.title
    waitingAliases = parseAliases(waiting.aliases)
  } else {
    const waiting = loadWaitingGeografia(db, waitingId)
    if (!waiting) throw new Error('Lugar en espera no encontrado')
    waitingName = waiting.name
    waitingAliases = parseAliases(waiting.aliases)
  }

  const extras = [waitingName, ...waitingAliases]
  let aliasAdded: string | null = waitingName
  const first = targets[0]!

  db.exec('BEGIN')
  try {
    for (const t of targets) {
      if (t.to_type === 'person') {
        const master = row<Person>(
          db.prepare(`SELECT id, source FROM persons WHERE id = ?`).get(t.target_id),
        )
        if (!master || master.source !== 'manual') {
          throw new Error('Perfil maestro no encontrado')
        }
        copyLinksToTarget(db, from, waitingId, 'person', t.target_id, now)
        aliasAdded = addAliasesToPerson(db, t.target_id, extras, now) ?? aliasAdded
        if (from === 'person') {
          transferAgrupacionMemberships(db, waitingId, t.target_id)
        }
      } else if (t.to_type === 'project') {
        const master = row<Project>(
          db.prepare(`SELECT id, source FROM projects WHERE id = ?`).get(t.target_id),
        )
        if (!master || master.source !== 'manual') {
          throw new Error('Proyecto maestro no encontrado')
        }
        copyLinksToTarget(db, from, waitingId, 'project', t.target_id, now)
        aliasAdded = addAliasesToProject(db, t.target_id, extras, now) ?? aliasAdded
      } else if (t.to_type === 'geografia') {
        const master = row<{ id: string; source: string }>(
          db.prepare(`SELECT id, source FROM geografia WHERE id = ?`).get(t.target_id),
        )
        if (!master || master.source !== 'manual') {
          throw new Error('Lugar maestro no encontrado')
        }
        copyLinksToTarget(db, from, waitingId, 'geografia', t.target_id, now)
      } else if (t.to_type === 'agrupacion') {
        const agrup = row<{ id: string }>(
          db.prepare(`SELECT id FROM agrupaciones WHERE id = ?`).get(t.target_id),
        )
        if (!agrup) throw new Error('Agrupación no encontrada')
        copyLinksToTarget(db, from, waitingId, 'agrupacion', t.target_id, now)
        if (from === 'person') {
          addPersonToAgrupacion(db, t.target_id, waitingId, now)
        }
      } else if (t.to_type === 'dominio') {
        const dominio = row<{ id: string }>(
          db.prepare(`SELECT id FROM dominios WHERE id = ?`).get(t.target_id),
        )
        if (!dominio) throw new Error('Dominio no encontrado')
        copyLinksToTarget(db, from, waitingId, 'dominio', t.target_id, now)
      } else {
        throw new Error('to_type inválido')
      }
    }

    // Persona → solo agrupación(es): la membresía la saca de sala; no hace falta merge.
    const onlyAgrupacionPerson =
      from === 'person' &&
      targets.length > 0 &&
      targets.every((t) => t.to_type === 'agrupacion')

    if (onlyAgrupacionPerson) {
      deleteWaitingLinks(db, from, waitingId)
      db.exec('COMMIT')
      return {
        ok: true,
        result_type: first.to_type,
        result_id: first.target_id,
        alias_added: aliasAdded,
        attached: targets.length,
      }
    }

    // Si también hay agrupaciones y persona waiting, las membresías ya apuntan al waiting;
    // transferir a un perfil destino si existe, si no dejar (ya saldrá por merge).
    const personTarget = targets.find((t) => t.to_type === 'person')
    if (from === 'person' && personTarget) {
      for (const t of targets) {
        if (t.to_type !== 'agrupacion') continue
        // Re-apuntar membresía del waiting al perfil maestro
        const mem = row<{ id: string }>(
          db
            .prepare(
              `SELECT id FROM agrupacion_members
               WHERE agrupacion_id = ? AND person_id = ?`,
            )
            .get(t.target_id, waitingId),
        )
        if (mem) {
          const clash = row<{ id: string }>(
            db
              .prepare(
                `SELECT id FROM agrupacion_members
                 WHERE agrupacion_id = ? AND person_id = ?`,
              )
              .get(t.target_id, personTarget.target_id),
          )
          if (clash) {
            db.prepare(`DELETE FROM agrupacion_members WHERE id = ?`).run(mem.id)
          } else {
            db.prepare(
              `UPDATE agrupacion_members SET person_id = ? WHERE id = ?`,
            ).run(personTarget.target_id, mem.id)
          }
        }
      }
    }

    deleteWaitingLinks(db, from, waitingId)
    markWaitingMerged(db, from, waitingId, first.target_id, now)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return {
    ok: true,
    result_type: first.to_type,
    result_id: first.target_id,
    alias_added: aliasAdded,
    attached: targets.length,
  }
}

function markPersonMerged(db: DatabaseSync, waitingId: string, intoId: string, now: string) {
  db.prepare(
    `UPDATE persons SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`,
  ).run(intoId, now, waitingId)
}

function markProjectMerged(db: DatabaseSync, waitingId: string, intoId: string, now: string) {
  db.prepare(
    `UPDATE projects SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`,
  ).run(intoId, now, waitingId)
}

function markGeografiaMerged(db: DatabaseSync, waitingId: string, intoId: string, now: string) {
  db.prepare(
    `UPDATE geografia SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`,
  ).run(intoId, now, waitingId)
}

export type ResolveWaitingInput = {
  from_type: WaitingEntityType
  action: 'attach' | 'promote'
  /** Destino único (compat). Preferí `targets` para multi-vínculo. */
  to_type?: WaitingDestType
  target_id?: string
  /** Uno o más destinos a vincular en la misma resolución. */
  targets?: WaitingAttachTarget[]
  /** promote person */
  kind?: PersonKind | string
  aliases?: unknown
  notes?: string
  /** promote project */
  category?: string
  status?: string
  tactical_focus?: string
  title?: string
  name?: string
}

function waitingDisplayName(
  db: DatabaseSync,
  from: WaitingEntityType,
  waitingId: string,
): string {
  if (from === 'person') {
    return loadWaitingPerson(db, waitingId)?.name ?? waitingId
  }
  if (from === 'project') {
    return loadWaitingProject(db, waitingId)?.title ?? waitingId
  }
  return loadWaitingGeografia(db, waitingId)?.name ?? waitingId
}

function markWaitingMerged(
  db: DatabaseSync,
  from: WaitingEntityType,
  waitingId: string,
  intoId: string,
  now: string,
) {
  if (from === 'person') markPersonMerged(db, waitingId, intoId, now)
  else if (from === 'project') markProjectMerged(db, waitingId, intoId, now)
  else markGeografiaMerged(db, waitingId, intoId, now)
}

export function resolveWaiting(
  db: DatabaseSync,
  waitingId: string,
  input: ResolveWaitingInput,
): {
  ok: true
  result_type: WaitingDestType
  result_id: string
  alias_added?: string | null
} {
  const now = new Date().toISOString()
  const from = input.from_type
  const to = input.to_type
  const action = input.action

  if (action === 'attach') {
    const targets = normalizeAttachTargets(input)
    if (targets.length === 0) {
      throw new Error('Al menos un destino requerido')
    }
    const res = attachWaitingMulti(db, waitingId, from, targets)
    return {
      ok: true,
      result_type: res.result_type,
      result_id: res.result_id,
      alias_added: res.alias_added,
    }
  }

  if (action !== 'promote') {
    throw new Error('action inválida')
  }
  if (!to || to === 'agrupacion' || to === 'dominio') {
    throw new Error('to_type inválido para promover')
  }

  // —— promote ——
  if (from === 'person' && to === 'person') {
    const waiting = loadWaitingPerson(db, waitingId)
    if (!waiting) throw new Error('Entidad en espera no encontrada')
    const kind = normalizePersonKind(input.kind ?? waiting.kind)
    if (!isProfileKind(kind)) {
      throw new Error('Para promover a perfil elegí Física, Jurídica o Ficticia')
    }
    const name = (input.name ?? waiting.name).trim()
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE persons
         SET source = 'manual', kind = ?, name = ?, notes = COALESCE(?, notes),
             status = 'active', updated_at = ?
         WHERE id = ?`,
      ).run(kind, name, input.notes?.trim() || null, now, waiting.id)
      syncPersonAliases(waiting.id, name, waiting.aliases || '[]')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, result_type: 'person', result_id: waiting.id }
  }

  if (from === 'project' && to === 'project') {
    const waiting = loadWaitingProject(db, waitingId)
    if (!waiting) throw new Error('Proyecto en espera no encontrado')
    const title = (input.title ?? input.name ?? waiting.title).trim()
    const category = normalizeProjectKind(input.category ?? waiting.category)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE projects
         SET source = 'manual', title = ?, category = ?,
             status = COALESCE(?, status),
             tactical_focus = COALESCE(?, tactical_focus),
             notes = COALESCE(?, notes),
             updated_at = ?
         WHERE id = ?`,
      ).run(
        title,
        category,
        input.status || null,
        input.tactical_focus || null,
        input.notes?.trim() || null,
        now,
        waiting.id,
      )
      syncProjectAliases(waiting.id, title, waiting.aliases || '[]')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, result_type: 'project', result_id: waiting.id }
  }

  // Cross promote: person waiting → new project master
  if (from === 'person' && to === 'project') {
    const waiting = loadWaitingPerson(db, waitingId)
    if (!waiting) throw new Error('Entidad en espera no encontrada')
    const title = (input.title ?? input.name ?? waiting.name).trim()
    const projectId = randomUUID()
    const category = normalizeProjectKind(input.category ?? 'proyecto')
    const aliasesJson = JSON.stringify(
      mergeAliases(parseAliases(waiting.aliases), [waiting.name], title),
    )
    db.exec('BEGIN')
    try {
      db.prepare(
        `INSERT INTO projects (
          id, title, category, status, tactical_focus, notes, aliases,
          created_at, updated_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      ).run(
        projectId,
        title,
        category,
        input.status || 'emergente',
        input.tactical_focus || null,
        input.notes?.trim() || waiting.notes || null,
        aliasesJson,
        now,
        now,
      )
      syncProjectAliases(projectId, title, aliasesJson)
      reassignLinks(db, 'person', waiting.id, 'project', projectId)
      markPersonMerged(db, waiting.id, projectId, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, result_type: 'project', result_id: projectId }
  }

  // Cross promote: project waiting → new person master
  if (from === 'project' && to === 'person') {
    const waiting = loadWaitingProject(db, waitingId)
    if (!waiting) throw new Error('Proyecto en espera no encontrado')
    const kind = normalizePersonKind(input.kind ?? 'fisica')
    if (!isProfileKind(kind)) {
      throw new Error('Para promover a perfil elegí Física, Jurídica o Ficticia')
    }
    const name = (input.name ?? input.title ?? waiting.title).trim()
    const personId = randomUUID()
    const aliasesJson = JSON.stringify(
      mergeAliases(parseAliases(waiting.aliases), [waiting.title], name),
    )
    db.exec('BEGIN')
    try {
      db.prepare(
        `INSERT INTO persons (id, name, kind, aliases, notes, status, created_at, updated_at, source)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'manual')`,
      ).run(
        personId,
        name,
        kind,
        aliasesJson,
        input.notes?.trim() || waiting.notes || null,
        now,
        now,
      )
      syncPersonAliases(personId, name, aliasesJson)
      reassignLinks(db, 'project', waiting.id, 'person', personId)
      markProjectMerged(db, waiting.id, personId, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, result_type: 'person', result_id: personId }
  }

  // —— Geografía attach / promote ——
  if (action === 'attach' && to === 'geografia') {
    const master = row<Geografia>(
      db
        .prepare(
          `SELECT * FROM geografia
           WHERE id = ? AND source = 'manual'
             AND (merged_into IS NULL OR merged_into = '')`,
        )
        .get(String(input.target_id || '').trim()),
    )
    if (!master) throw new Error('Lugar maestro no encontrado')

    if (from === 'geografia') {
      const waiting = loadWaitingGeografia(db, waitingId)
      if (!waiting) throw new Error('Lugar en espera no encontrado')
      const aliases = mergeAliases(
        parseAliases(master.aliases),
        [waiting.name, ...parseAliases(waiting.aliases)],
        master.name,
      )
      const aliasesJson = JSON.stringify(aliases)
      db.exec('BEGIN')
      try {
        db.prepare(
          `UPDATE geografia SET aliases = ?, updated_at = ? WHERE id = ?`,
        ).run(aliasesJson, now, master.id)
        reassignLinks(db, 'geografia', waiting.id, 'geografia', master.id)
        markGeografiaMerged(db, waiting.id, master.id, now)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return {
        ok: true,
        result_type: 'geografia',
        result_id: master.id,
        alias_added: waiting.name,
      }
    }

    if (from === 'person') {
      const waiting = loadWaitingPerson(db, waitingId)
      if (!waiting) throw new Error('Entidad en espera no encontrada')
      const aliases = mergeAliases(
        parseAliases(master.aliases),
        [waiting.name, ...parseAliases(waiting.aliases)],
        master.name,
      )
      const aliasesJson = JSON.stringify(aliases)
      db.exec('BEGIN')
      try {
        db.prepare(
          `UPDATE geografia SET aliases = ?, updated_at = ? WHERE id = ?`,
        ).run(aliasesJson, now, master.id)
        reassignLinks(db, 'person', waiting.id, 'geografia', master.id)
        markPersonMerged(db, waiting.id, master.id, now)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return {
        ok: true,
        result_type: 'geografia',
        result_id: master.id,
        alias_added: waiting.name,
      }
    }

    if (from === 'project') {
      const waiting = loadWaitingProject(db, waitingId)
      if (!waiting) throw new Error('Proyecto en espera no encontrado')
      const aliases = mergeAliases(
        parseAliases(master.aliases),
        [waiting.title, ...parseAliases(waiting.aliases)],
        master.name,
      )
      const aliasesJson = JSON.stringify(aliases)
      db.exec('BEGIN')
      try {
        db.prepare(
          `UPDATE geografia SET aliases = ?, updated_at = ? WHERE id = ?`,
        ).run(aliasesJson, now, master.id)
        reassignLinks(db, 'project', waiting.id, 'geografia', master.id)
        markProjectMerged(db, waiting.id, master.id, now)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return {
        ok: true,
        result_type: 'geografia',
        result_id: master.id,
        alias_added: waiting.title,
      }
    }
  }

  if (action === 'promote' && to === 'geografia') {
    if (from === 'geografia') {
      const waiting = loadWaitingGeografia(db, waitingId)
      if (!waiting) throw new Error('Lugar en espera no encontrado')
      const name = (input.name ?? waiting.name).trim()
      const kind = normalizeGeoKind(input.kind ?? waiting.kind)
      db.exec('BEGIN')
      try {
        db.prepare(
          `UPDATE geografia
           SET source = 'manual', name = ?, kind = ?,
               notes = COALESCE(?, notes), status = 'active',
               merged_into = NULL, updated_at = ?
           WHERE id = ?`,
        ).run(name, kind, input.notes?.trim() || null, now, waiting.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { ok: true, result_type: 'geografia', result_id: waiting.id }
    }

    if (from === 'person') {
      const waiting = loadWaitingPerson(db, waitingId)
      if (!waiting) throw new Error('Entidad en espera no encontrada')
      const geoId = randomUUID()
      const name = (input.name ?? waiting.name).trim()
      const aliasesJson = JSON.stringify(
        mergeAliases(parseAliases(waiting.aliases), [waiting.name], name),
      )
      db.exec('BEGIN')
      try {
        db.prepare(
          `INSERT INTO geografia (
            id, name, kind, aliases, notes, status, source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 'manual', ?, ?)`,
        ).run(
          geoId,
          name,
          normalizeGeoKind(input.kind ?? 'lugar'),
          aliasesJson,
          input.notes?.trim() || waiting.notes || null,
          now,
          now,
        )
        reassignLinks(db, 'person', waiting.id, 'geografia', geoId)
        markPersonMerged(db, waiting.id, geoId, now)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { ok: true, result_type: 'geografia', result_id: geoId }
    }

    if (from === 'project') {
      const waiting = loadWaitingProject(db, waitingId)
      if (!waiting) throw new Error('Proyecto en espera no encontrado')
      const geoId = randomUUID()
      const name = (input.name ?? input.title ?? waiting.title).trim()
      const aliasesJson = JSON.stringify(
        mergeAliases(parseAliases(waiting.aliases), [waiting.title], name),
      )
      db.exec('BEGIN')
      try {
        db.prepare(
          `INSERT INTO geografia (
            id, name, kind, aliases, notes, status, source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 'manual', ?, ?)`,
        ).run(
          geoId,
          name,
          normalizeGeoKind(input.kind ?? 'lugar'),
          aliasesJson,
          input.notes?.trim() || waiting.notes || null,
          now,
          now,
        )
        reassignLinks(db, 'project', waiting.id, 'geografia', geoId)
        markProjectMerged(db, waiting.id, geoId, now)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { ok: true, result_type: 'geografia', result_id: geoId }
    }
  }

  // Attach geografia waiting → person/project (cross)
  if (action === 'attach' && from === 'geografia' && to === 'person') {
    const waiting = loadWaitingGeografia(db, waitingId)
    if (!waiting) throw new Error('Lugar en espera no encontrado')
    const targetId = String(input.target_id || '').trim()
    const master = row<Person>(
      db.prepare(`SELECT * FROM persons WHERE id = ?`).get(targetId),
    )
    if (!master || master.source !== 'manual') {
      throw new Error('Perfil maestro no encontrado')
    }
    const aliases = mergeAliases(
      parseAliases(master.aliases),
      [waiting.name, ...parseAliases(waiting.aliases)],
      master.name,
    )
    const aliasesJson = JSON.stringify(aliases)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`,
      ).run(aliasesJson, now, master.id)
      syncPersonAliases(master.id, master.name, aliasesJson)
      reassignLinks(db, 'geografia', waiting.id, 'person', master.id)
      markGeografiaMerged(db, waiting.id, master.id, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return {
      ok: true,
      result_type: 'person',
      result_id: master.id,
      alias_added: waiting.name,
    }
  }

  if (action === 'attach' && from === 'geografia' && to === 'project') {
    const waiting = loadWaitingGeografia(db, waitingId)
    if (!waiting) throw new Error('Lugar en espera no encontrado')
    const targetId = String(input.target_id || '').trim()
    const master = row<Project>(
      db.prepare(`SELECT * FROM projects WHERE id = ?`).get(targetId),
    )
    if (!master || master.source !== 'manual') {
      throw new Error('Proyecto maestro no encontrado')
    }
    const aliases = mergeAliases(
      parseAliases(master.aliases),
      [waiting.name, ...parseAliases(waiting.aliases)],
      master.title,
    )
    const aliasesJson = JSON.stringify(aliases)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE projects SET aliases = ?, updated_at = ? WHERE id = ?`,
      ).run(aliasesJson, now, master.id)
      syncProjectAliases(master.id, master.title, aliasesJson)
      reassignLinks(db, 'geografia', waiting.id, 'project', master.id)
      markGeografiaMerged(db, waiting.id, master.id, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return {
      ok: true,
      result_type: 'project',
      result_id: master.id,
      alias_added: waiting.name,
    }
  }

  throw new Error('Combinación from/to/action no soportada')
}

/** Asegura el sink «Ruido» (persona kind=ruido). */
export function ensureRuidoSink(db: DatabaseSync): { id: string; name: string } {
  const byKind = row<{ id: string; name: string }>(
    db
      .prepare(
        `SELECT id, name FROM persons
         WHERE kind = 'ruido'
           AND (merged_into IS NULL OR merged_into = '')
         ORDER BY CASE WHEN lower(name) = 'ruido' THEN 0 ELSE 1 END, created_at
         LIMIT 1`,
      )
      .get(),
  )
  if (byKind) return byKind

  const byName = row<{ id: string; name: string }>(
    db
      .prepare(
        `SELECT id, name FROM persons
         WHERE lower(name) = 'ruido'
           AND (merged_into IS NULL OR merged_into = '')
         LIMIT 1`,
      )
      .get(),
  )
  if (byName) {
    db.prepare(
      `UPDATE persons SET kind = 'ruido', updated_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), byName.id)
    return byName
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO persons (id, name, kind, aliases, notes, status, created_at, updated_at, source)
     VALUES (?, 'Ruido', 'ruido', '[]', 'Sink NER · menciones descartadas', 'active', ?, ?, 'manual')`,
  ).run(id, now, now)
  return { id, name: 'Ruido' }
}

export function discardWaitingToRuido(
  db: DatabaseSync,
  waitingId: string,
  fromType: WaitingEntityType,
): { ok: true; ruido_id: string; name: string } {
  const now = new Date().toISOString()
  const ruido = ensureRuidoSink(db)

  if (fromType === 'person') {
    const waiting = loadWaitingPerson(db, waitingId)
    if (!waiting) throw new Error('Entidad en espera no encontrada')
    if (waiting.id === ruido.id) {
      return { ok: true, ruido_id: ruido.id, name: waiting.name }
    }
    const aliases = mergeAliases(
      parseAliases(
        row<{ aliases: string }>(
          db.prepare(`SELECT aliases FROM persons WHERE id = ?`).get(ruido.id),
        )?.aliases,
      ),
      [waiting.name, ...parseAliases(waiting.aliases)],
      ruido.name,
    )
    const aliasesJson = JSON.stringify(aliases)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`,
      ).run(aliasesJson, now, ruido.id)
      syncPersonAliases(ruido.id, ruido.name, aliasesJson)
      reassignLinks(db, 'person', waiting.id, 'person', ruido.id)
      markPersonMerged(db, waiting.id, ruido.id, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, ruido_id: ruido.id, name: waiting.name }
  }

  if (fromType === 'project') {
    const waiting = loadWaitingProject(db, waitingId)
    if (!waiting) throw new Error('Proyecto en espera no encontrado')
    const aliases = mergeAliases(
      parseAliases(
        row<{ aliases: string }>(
          db.prepare(`SELECT aliases FROM persons WHERE id = ?`).get(ruido.id),
        )?.aliases,
      ),
      [waiting.title, ...parseAliases(waiting.aliases)],
      ruido.name,
    )
    const aliasesJson = JSON.stringify(aliases)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`,
      ).run(aliasesJson, now, ruido.id)
      syncPersonAliases(ruido.id, ruido.name, aliasesJson)
      reassignLinks(db, 'project', waiting.id, 'person', ruido.id)
      markProjectMerged(db, waiting.id, ruido.id, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, ruido_id: ruido.id, name: waiting.title }
  }

  if (fromType === 'geografia') {
    const waiting = loadWaitingGeografia(db, waitingId)
    if (!waiting) throw new Error('Lugar en espera no encontrado')
    const aliases = mergeAliases(
      parseAliases(
        row<{ aliases: string }>(
          db.prepare(`SELECT aliases FROM persons WHERE id = ?`).get(ruido.id),
        )?.aliases,
      ),
      [waiting.name, ...parseAliases(waiting.aliases)],
      ruido.name,
    )
    const aliasesJson = JSON.stringify(aliases)
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?`,
      ).run(aliasesJson, now, ruido.id)
      syncPersonAliases(ruido.id, ruido.name, aliasesJson)
      reassignLinks(db, 'geografia', waiting.id, 'person', ruido.id)
      markGeografiaMerged(db, waiting.id, ruido.id, now)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, ruido_id: ruido.id, name: waiting.name }
  }

  throw new Error('from_type inválido')
}

export function discardWaitingBulk(
  db: DatabaseSync,
  items: Array<{ id: string; from_type: WaitingEntityType }>,
): { discarded: number; failed: number; ruido_id: string } {
  const ruido = ensureRuidoSink(db)
  let discarded = 0
  let failed = 0
  for (const item of items) {
    try {
      discardWaitingToRuido(db, item.id, item.from_type)
      discarded++
    } catch {
      failed++
    }
  }
  return { discarded, failed, ruido_id: ruido.id }
}

