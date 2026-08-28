import type { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import {
  backfillCurrentRun,
  closeDb,
  ensureTrincheraSeed,
  getDb,
  getDbPath,
  getTrincheraNotebookId,
  openDbFile,
  rebuildSearchFts,
  reopenDb,
  syncPersonAliases,
  syncProjectAliases,
} from '../db.js'
import { normalizeName } from './entityMatch.js'
import { csvEscape } from './csvSafe.js'
import {
  RESTORE_DB_PATH,
  rmSqliteBundle,
  swapSqliteFile,
} from './restoreSwap.js'

export const BACKUP_FORMAT = 'deprocast-backup'
export const BACKUP_VERSION = 3
export const VAULT_DIR = path.resolve(process.cwd(), 'vault')
export const FEEDBACK_DIR = path.resolve(process.cwd(), 'feedback')

export type BackupPurpose = 'copy' | 'metanalisis'

export const BACKUP_TABLES = [
  'notebooks',
  'entries',
  'quantomos',
  'quantomo_lattices',
  'pending_tasks',
  'validated_file_metadata',
  'pages',
  'persons',
  'projects',
  'entity_aliases',
  'project_aliases',
  'entry_entities_raw',
  'entity_proposals',
  'entity_links',
  'person_relations',
  'person_project_links',
  'graph_link_dismissals',
  'agrupaciones',
  'agrupacion_members',
  'dominios',
  'geografia',
  'geografia_geom',
  'bookmarks',
  'chat_sessions',
  'chat_messages',
  'chat_blocks',
  'dialogo_threads',
  'dialogo_messages',
  'dashboard_pins',
  'link_harvest',
  'sandbox_graphs',
  'sandbox_nodes',
  'sandbox_links',
  'embeddings',
  'notebook_sources',
  'feedback_notes',
  'app_runs',
  'ama_lists',
  'ama_list_items',
  'ama_lista6_parts',
  'ama_places',
  'ama_matrices',
  'ama_cells',
  'ama_neo_cells',
  'ama_flows',
  'ama_links',
  'ama_cycle_state',
  'map_systems',
  'map_layers',
  'map_tags',
  'depro_power_notes',
  'depro_ida_items',
  'depro_ida_cards',
  'depro_research_packs',
  'depro_research_findings',
  'sentinel_agents',
  'sentinel_missions',
  'sentinel_messages',
  'sentinel_events',
  'sentinel_skills',
] as const

export type BackupTableName = (typeof BACKUP_TABLES)[number]

/** Actividad de la RUN: se borra en NUEVO USUARIO. AmazonA/Mapa quedan. */
export const USER_ACTIVITY_TABLES = [
  'notebooks',
  'entries',
  'quantomos',
  'quantomo_lattices',
  'pending_tasks',
  'validated_file_metadata',
  'pages',
  'persons',
  'projects',
  'entity_aliases',
  'project_aliases',
  'entry_entities_raw',
  'entity_proposals',
  'entity_links',
  'person_relations',
  'person_project_links',
  'graph_link_dismissals',
  'agrupaciones',
  'agrupacion_members',
  'bookmarks',
  'chat_sessions',
  'chat_messages',
  'chat_blocks',
  'dialogo_threads',
  'dialogo_messages',
  'dashboard_pins',
  'link_harvest',
  'sandbox_graphs',
  'sandbox_nodes',
  'sandbox_links',
  'embeddings',
  'notebook_sources',
  'feedback_notes',
  'ama_flows',
  'app_runs',
] as const

export type BackupRunMeta = {
  id: string
  operator_name: string
  operator_id: string
  started_at: string
  ended_at: string | null
  day_count: number
}

export type VaultIndexEntry = {
  path: string
  size: number
  mtime: string
}

export type BackupDump = {
  format: typeof BACKUP_FORMAT
  version: number
  purpose: BackupPurpose
  exported_at: string
  include_media: boolean
  run: BackupRunMeta | null
  vault_index: VaultIndexEntry[]
  tables: Record<string, Record<string, unknown>[]>
}

export type BackupSummary = {
  exported_at: string
  include_media: false
  run: BackupRunMeta | null
  tables: Record<string, number>
  vault_files: number
  vault_bytes: number
  feedback_files: number
  feedback_bytes: number
  groups: {
    transcripciones: number
    perfiles: number
    conexiones: number
    quantomos: number
    validaciones: number
    ida: number
    resto: number
  }
}

export type BackupTableCounts = Record<string, number>

export type BackupApplyResult = {
  ok: true
  mode: 'replace' | 'merge'
  tables: BackupTableCounts
  inserted: BackupTableCounts
  skipped: BackupTableCounts
  remapped: { trinchera: { from: string; to: string } | null }
  media: { copied: number; skipped: number; conflicts: number; failed: number }
  mediaStatus: 'ok' | 'failed' | 'partial' | 'skipped'
  dbCommitted: boolean
  profiles: {
    persons_merged: number
    projects_merged: number
  }
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name) as { ok: number } | undefined
  return Boolean(row)
}

function countTable(db: DatabaseSync, name: string): number {
  if (!tableExists(db, name)) return 0
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as {
    n: number | bigint
  }
  return Number(row.n ?? 0)
}

function dumpTable(
  db: DatabaseSync,
  name: string,
): Record<string, unknown>[] {
  if (!tableExists(db, name)) return []
  return db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]
}

function walkFileIndex(root: string): VaultIndexEntry[] {
  if (!fs.existsSync(root)) return []
  const out: VaultIndexEntry[] = []
  const walk = (dir: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(abs)
        continue
      }
      if (!ent.isFile()) continue
      try {
        const st = fs.statSync(abs)
        out.push({
          path: path.relative(root, abs).replaceAll('\\', '/'),
          size: st.size,
          mtime: st.mtime.toISOString(),
        })
      } catch {
        /* ignore unreadable files */
      }
    }
  }
  walk(root)
  return out
}

function treeStats(root: string): { files: number; bytes: number } {
  const files = walkFileIndex(root)
  return {
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
  }
}

export function dumpBackup(opts?: {
  purpose?: BackupPurpose
  run?: BackupRunMeta | null
  includeMedia?: boolean
}): BackupDump {
  const db = getDb()
  const tables: BackupDump['tables'] = {}
  for (const name of BACKUP_TABLES) {
    tables[name] = dumpTable(db, name)
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    purpose: opts?.purpose ?? 'copy',
    exported_at: new Date().toISOString(),
    include_media: Boolean(opts?.includeMedia),
    run: opts?.run ?? null,
    vault_index: walkFileIndex(VAULT_DIR),
    tables,
  }
}

export function backupSummary(run: BackupRunMeta | null = null): BackupSummary {
  const db = getDb()
  const tables: Record<string, number> = {}
  for (const name of BACKUP_TABLES) {
    tables[name] = countTable(db, name)
  }
  const n = (key: BackupTableName) => tables[key] ?? 0
  const vault = treeStats(VAULT_DIR)
  const feedback = treeStats(FEEDBACK_DIR)
  const ida =
    n('depro_ida_items') +
    n('depro_ida_cards') +
    n('depro_research_packs') +
    n('depro_research_findings')
  return {
    exported_at: new Date().toISOString(),
    include_media: false,
    run,
    tables,
    vault_files: vault.files,
    vault_bytes: vault.bytes,
    feedback_files: feedback.files,
    feedback_bytes: feedback.bytes,
    groups: {
      transcripciones: n('entries') + n('chat_messages') + n('pages'),
      perfiles: n('persons') + n('projects'),
      conexiones:
        n('entity_links') +
        n('person_relations') +
        n('person_project_links') +
        n('entity_proposals') +
        n('agrupacion_members'),
      quantomos: n('quantomos'),
      validaciones: n('validated_file_metadata'),
      ida,
      resto:
        n('notebooks') +
        n('pending_tasks') +
        n('bookmarks') +
        n('chat_sessions') +
        n('chat_blocks') +
        n('dialogo_threads') +
        n('dialogo_messages') +
        n('dashboard_pins') +
        n('link_harvest') +
        n('sandbox_graphs') +
        n('sandbox_nodes') +
        n('sandbox_links') +
        n('embeddings') +
        n('entity_aliases') +
        n('project_aliases') +
        n('entry_entities_raw') +
        n('graph_link_dismissals') +
        n('agrupaciones') +
        n('dominios') +
        n('geografia') +
        n('notebook_sources') +
        n('feedback_notes') +
        n('app_runs') +
        n('ama_lists') +
        n('ama_list_items') +
        n('ama_lista6_parts') +
        n('ama_places') +
        n('ama_matrices') +
        n('ama_cells') +
        n('ama_neo_cells') +
        n('ama_flows') +
        n('ama_links') +
        n('ama_cycle_state') +
        n('map_systems') +
        n('map_layers') +
        n('map_tags') +
        n('depro_power_notes'),
    },
  }
}

export function serializeBackupJson(dump: BackupDump): string {
  return JSON.stringify(dump, null, 2)
}

export function serializeBackupCsv(dump: BackupDump): string {
  const parts: string[] = [
    `# deprocast-backup v${dump.version}`,
    `# purpose ${dump.purpose}`,
    `# exported_at ${dump.exported_at}`,
    `# include_media ${dump.include_media}`,
    dump.run
      ? `# run ${dump.run.operator_name} ${dump.run.started_at} day ${dump.run.day_count}`
      : '# run none',
    '',
  ]
  for (const name of BACKUP_TABLES) {
    const rows = dump.tables[name] ?? []
    parts.push(`#TABLE ${name}`)
    if (rows.length === 0) {
      parts.push('')
      continue
    }
    const cols = Object.keys(rows[0])
    parts.push(cols.map(csvEscape).join(','))
    for (const row of rows) {
      parts.push(cols.map((c) => csvEscape(row[c])).join(','))
    }
    parts.push('')
  }
  return parts.join('\n')
}

function xmlEscape(value: unknown): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function serializeBackupXml(dump: BackupDump): string {
  const runAttr = dump.run
    ? ` operator="${xmlEscape(dump.run.operator_name)}" started_at="${xmlEscape(dump.run.started_at)}"`
    : ''
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<deprocast format="${BACKUP_FORMAT}" version="${dump.version}" purpose="${dump.purpose}" exported_at="${xmlEscape(dump.exported_at)}" include_media="${dump.include_media ? 'true' : 'false'}"${runAttr}>`,
  ]
  for (const name of BACKUP_TABLES) {
    const rows = dump.tables[name] ?? []
    lines.push(`  <table name="${xmlEscape(name)}">`)
    for (const row of rows) {
      lines.push('    <row>')
      for (const [key, value] of Object.entries(row)) {
        lines.push(`      <${key}>${xmlEscape(value)}</${key}>`)
      }
      lines.push('    </row>')
    }
    lines.push('  </table>')
  }
  lines.push('</deprocast>')
  return lines.join('\n')
}

function parseRunMeta(raw: unknown): BackupRunMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.operator_name !== 'string') return null
  if (typeof o.operator_id !== 'string' || typeof o.started_at !== 'string') {
    return null
  }
  return {
    id: o.id,
    operator_name: o.operator_name,
    operator_id: o.operator_id,
    started_at: o.started_at,
    ended_at: typeof o.ended_at === 'string' ? o.ended_at : null,
    day_count: typeof o.day_count === 'number' ? o.day_count : 1,
  }
}

function parseVaultIndex(raw: unknown): VaultIndexEntry[] {
  if (!Array.isArray(raw)) return []
  const out: VaultIndexEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.path !== 'string') continue
    out.push({
      path: o.path,
      size: typeof o.size === 'number' ? o.size : 0,
      mtime: typeof o.mtime === 'string' ? o.mtime : '',
    })
  }
  return out
}

function parseDump(raw: unknown): BackupDump {
  if (!raw || typeof raw !== 'object') {
    throw new Error('El archivo no es un JSON de respaldo válido')
  }
  const obj = raw as Record<string, unknown>
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error('El archivo no es un respaldo de Deprocast')
  }
  const version = Number(obj.version)
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error(`Versión de respaldo no soportada: ${String(obj.version)}`)
  }
  if (!obj.tables || typeof obj.tables !== 'object') {
    throw new Error('El respaldo no contiene tablas')
  }
  const tables: BackupDump['tables'] = {}
  const src = obj.tables as Record<string, unknown>
  for (const name of BACKUP_TABLES) {
    const rows = src[name]
    if (rows == null) {
      tables[name] = []
      continue
    }
    if (!Array.isArray(rows)) {
      throw new Error(`Tabla ${name} no es un array`)
    }
    tables[name] = rows.map((r) => {
      if (!r || typeof r !== 'object') {
        throw new Error(`Fila inválida en ${name}`)
      }
      return r as Record<string, unknown>
    })
  }
  const purpose: BackupPurpose =
    obj.purpose === 'metanalisis' ? 'metanalisis' : 'copy'
  return {
    format: BACKUP_FORMAT,
    version,
    purpose,
    exported_at: typeof obj.exported_at === 'string' ? obj.exported_at : '',
    include_media: obj.include_media === true,
    run: parseRunMeta(obj.run),
    vault_index: parseVaultIndex(obj.vault_index),
    tables,
  }
}

function cellValue(
  value: unknown,
): string | number | bigint | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' || typeof value === 'bigint') return value
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function emptyCounts(): BackupTableCounts {
  const out: BackupTableCounts = {}
  for (const name of BACKUP_TABLES) out[name] = 0
  return out
}

function insertTableRows(
  db: DatabaseSync,
  name: string,
  rows: Record<string, unknown>[],
  mode: 'replace' | 'merge',
): { inserted: number; skipped: number } {
  if (!tableExists(db, name)) {
    return { inserted: 0, skipped: rows.length }
  }
  const info = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
    name: string
    notnull: number
    dflt_value: unknown
    pk: number
  }>
  const cols = info.map((c) => c.name)
  if (rows.length === 0 || cols.length === 0) {
    return { inserted: 0, skipped: 0 }
  }
  const meta = new Map(info.map((c) => [c.name, c]))
  const verb = mode === 'merge' ? 'INSERT OR IGNORE' : 'INSERT'
  const stmtCache = new Map<
    string,
    ReturnType<DatabaseSync['prepare']>
  >()
  let inserted = 0
  let skipped = 0
  for (const row of rows) {
    const used: string[] = []
    const values: Array<string | number | bigint | null> = []
    let missingRequired = false
    for (const c of cols) {
      const raw = row[c]
      if (raw !== undefined && raw !== null) {
        used.push(c)
        values.push(cellValue(raw))
        continue
      }
      const col = meta.get(c)
      if (col && col.notnull && col.dflt_value == null && col.pk === 0) {
        missingRequired = true
        break
      }
    }
    if (missingRequired || used.length === 0) {
      skipped++
      continue
    }
    const key = used.join('\0')
    let stmt = stmtCache.get(key)
    if (!stmt) {
      const placeholders = used.map(() => '?').join(', ')
      const quoted = used.map((c) => `"${c}"`).join(', ')
      stmt = db.prepare(
        `${verb} INTO "${name}" (${quoted}) VALUES (${placeholders})`,
      )
      stmtCache.set(key, stmt)
    }
    try {
      const result = stmt.run(...values)
      if (Number(result.changes ?? 0) > 0) inserted++
      else skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`No se pudo escribir la tabla ${name}: ${msg}`)
    }
  }
  return { inserted, skipped }
}

function isTrincheraNotebook(row: Record<string, unknown>): boolean {
  if (String(row.title ?? '') !== 'Trinchera') return false
  const kind = row.kind
  if (kind == null || kind === '') return true
  return String(kind) === 'system'
}

function remapTrinchera(
  dump: BackupDump,
  localId: string,
): { from: string; to: string } | null {
  const nbs = dump.tables.notebooks ?? []
  const tri = nbs.find(isTrincheraNotebook)
  if (!tri || typeof tri.id !== 'string' || tri.id === localId) return null
  const from = tri.id
  for (const name of BACKUP_TABLES) {
    const rows = dump.tables[name] ?? []
    for (const row of rows) {
      if (name === 'notebooks' && row.id === from) row.id = localId
      if (row.notebook_id === from) row.notebook_id = localId
    }
  }
  return { from, to: localId }
}

function prepareMergeRow(
  name: BackupTableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...row }
  if (name === 'app_runs' && String(next.status) === 'current') {
    next.status = 'imported'
    if (next.ended_at == null || next.ended_at === '') {
      next.ended_at = new Date().toISOString()
    }
  }
  if (name === 'persons') {
    const flag = next.is_operator
    if (flag === 1 || flag === true || flag === '1') next.is_operator = 0
  }
  return next
}

function parseAliasList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((a) => String(a).trim()).filter(Boolean)
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((a) => String(a).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function profileKeys(canonical: string, aliasesRaw: unknown): string[] {
  const keys = new Set<string>()
  const add = (s: string) => {
    const k = normalizeName(s)
    if (k) keys.add(k)
  }
  add(canonical)
  for (const a of parseAliasList(aliasesRaw)) add(a)
  return [...keys]
}

function unionAliases(
  canonical: string,
  a: string[],
  b: string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const canon = normalizeName(canonical)
  const add = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    const k = normalizeName(t)
    if (!k || k === canon || seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  for (const x of a) add(x)
  for (const x of b) add(x)
  return out
}

function isLiveProfile(row: Record<string, unknown>): boolean {
  const merged = row.merged_into
  if (merged != null && String(merged).trim() !== '') return false
  return String(row.status ?? '') !== 'merged'
}

function isManualProfile(row: Record<string, unknown>): boolean {
  return String(row.source ?? '') === 'manual'
}

type LocalProfile = {
  id: string
  canonical: string
  aliases: string[]
  source: string
  notes: string
  kind: string
  row: Record<string, unknown>
}

function loadLocalProfiles(
  db: DatabaseSync,
  table: 'persons' | 'projects',
): { byId: Map<string, LocalProfile>; byKey: Map<string, LocalProfile[]> } {
  const byId = new Map<string, LocalProfile>()
  const byKey = new Map<string, LocalProfile[]>()
  if (!tableExists(db, table)) return { byId, byKey }
  const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<
    string,
    unknown
  >[]
  for (const row of rows) {
    if (typeof row.id !== 'string') continue
    const canonical =
      table === 'persons' ? String(row.name ?? '') : String(row.title ?? '')
    const prof: LocalProfile = {
      id: row.id,
      canonical,
      aliases: parseAliasList(row.aliases),
      source: String(row.source ?? ''),
      notes: String(row.notes ?? ''),
      kind: String(row.kind ?? ''),
      row,
    }
    byId.set(prof.id, prof)
    if (!isLiveProfile(row)) continue
    for (const k of profileKeys(canonical, row.aliases)) {
      const list = byKey.get(k) ?? []
      list.push(prof)
      byKey.set(k, list)
    }
  }
  return { byId, byKey }
}

function followMerged(
  start: LocalProfile,
  byId: Map<string, LocalProfile>,
): LocalProfile {
  const seen = new Set<string>()
  let cur = start
  while (true) {
    if (seen.has(cur.id)) return cur
    seen.add(cur.id)
    if (isLiveProfile(cur.row)) return cur
    const nextId = String(cur.row.merged_into ?? '').trim()
    if (!nextId) return cur
    const next = byId.get(nextId)
    if (!next) return cur
    cur = next
  }
}

function pickLocalMatch(
  dumpRow: Record<string, unknown>,
  dumpKeys: string[],
  local: ReturnType<typeof loadLocalProfiles>,
): LocalProfile | null {
  const dumpId = typeof dumpRow.id === 'string' ? dumpRow.id : ''
  if (dumpId && local.byId.has(dumpId)) {
    return followMerged(local.byId.get(dumpId) as LocalProfile, local.byId)
  }
  const seen = new Map<string, LocalProfile>()
  for (const k of dumpKeys) {
    for (const hit of local.byKey.get(k) ?? []) seen.set(hit.id, hit)
  }
  if (seen.size === 0) return null
  const all = [...seen.values()]
  const manuals = all.filter((p) => p.source === 'manual')
  if (manuals.length === 1) return manuals[0]
  if (manuals.length > 1) return null
  if (all.length === 1) return all[0]
  return null
}

function remapValue(
  value: unknown,
  map: Map<string, string>,
): unknown {
  if (typeof value !== 'string') return value
  return map.get(value) ?? value
}

function remapJsonIds(
  raw: unknown,
  personMap: Map<string, string>,
  projectMap: Map<string, string>,
  mode: 'person-ids' | 'entity-refs' | 'project-ids',
): unknown {
  if (raw == null) return raw
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (mode === 'person-ids' && Array.isArray(parsed)) {
    const next = parsed.map((id) =>
      typeof id === 'string' ? (personMap.get(id) ?? id) : id,
    )
    return JSON.stringify(next)
  }
  if (mode === 'project-ids' && Array.isArray(parsed)) {
    const next = parsed.map((id) =>
      typeof id === 'string' ? (projectMap.get(id) ?? id) : id,
    )
    return JSON.stringify(next)
  }
  if (mode === 'entity-refs' && Array.isArray(parsed)) {
    const next = parsed.map((item) => {
      if (!item || typeof item !== 'object') return item
      const o = item as Record<string, unknown>
      const type = String(o.type ?? '')
      const id = typeof o.id === 'string' ? o.id : ''
      if (type === 'person' && personMap.has(id)) {
        return { ...o, id: personMap.get(id) }
      }
      if (type === 'project' && projectMap.has(id)) {
        return { ...o, id: projectMap.get(id) }
      }
      return o
    })
    return JSON.stringify(next)
  }
  return raw
}

function remapSpeakerMapJson(
  raw: unknown,
  personMap: Map<string, string>,
): unknown {
  if (raw == null || personMap.size === 0) return raw
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (!Array.isArray(parsed)) return raw
  const next = parsed.map((item) => {
    if (!item || typeof item !== 'object') return item
    const o = item as Record<string, unknown>
    const pid = typeof o.person_id === 'string' ? o.person_id : ''
    if (pid && personMap.has(pid)) {
      return { ...o, person_id: personMap.get(pid) }
    }
    return o
  })
  return JSON.stringify(next)
}

function applyIdMapsToDump(
  dump: BackupDump,
  personMap: Map<string, string>,
  projectMap: Map<string, string>,
): void {
  if (personMap.size === 0 && projectMap.size === 0) return
  for (const name of BACKUP_TABLES) {
    const rows = dump.tables[name] ?? []
    for (const row of rows) {
      if (name === 'persons' && typeof row.id === 'string' && personMap.has(row.id)) {
        row.id = personMap.get(row.id)
      }
      if (name === 'projects' && typeof row.id === 'string' && projectMap.has(row.id)) {
        row.id = projectMap.get(row.id)
      }
      if (personMap.size > 0) {
        if ('person_id' in row) row.person_id = remapValue(row.person_id, personMap)
        if ('from_person_id' in row) {
          row.from_person_id = remapValue(row.from_person_id, personMap)
        }
        if ('to_person_id' in row) {
          row.to_person_id = remapValue(row.to_person_id, personMap)
        }
        if ('merged_into' in row && name === 'persons') {
          row.merged_into = remapValue(row.merged_into, personMap)
        }
        if (
          name === 'entity_links' &&
          String(row.entity_kind ?? '') === 'person'
        ) {
          row.entity_id = remapValue(row.entity_id, personMap)
        }
        if (name === 'entity_proposals') {
          if (String(row.kind ?? '') === 'person') {
            row.matched_entity_id = remapValue(row.matched_entity_id, personMap)
          }
        }
        if (
          name === 'embeddings' &&
          String(row.object_type ?? '') === 'person'
        ) {
          row.object_id = remapValue(row.object_id, personMap)
        }
        if (name === 'sandbox_nodes' && String(row.kind ?? '') === 'person') {
          row.ref_id = remapValue(row.ref_id, personMap)
        }
        if (name === 'ama_links') {
          if (String(row.object_type ?? '') === 'person') {
            row.object_id = remapValue(row.object_id, personMap)
          }
          if (String(row.target_kind ?? '') === 'person') {
            row.target_id = remapValue(row.target_id, personMap)
          }
        }
        if (name === 'map_tags' && String(row.target_kind ?? '') === 'person') {
          row.target_id = remapValue(row.target_id, personMap)
        }
        if (
          name === 'dashboard_pins' &&
          String(row.ref_type ?? '') === 'person'
        ) {
          row.ref_id = remapValue(row.ref_id, personMap)
        }
        if (name === 'chat_sessions') {
          row.linked_person_ids_json = remapJsonIds(
            row.linked_person_ids_json,
            personMap,
            projectMap,
            'person-ids',
          )
          row.speaker_map_json = remapSpeakerMapJson(
            row.speaker_map_json,
            personMap,
          )
          if ('primary_person_id' in row) {
            row.primary_person_id = remapValue(
              row.primary_person_id,
              personMap,
            )
          }
        }
        if (name === 'chat_blocks') {
          row.linked_person_ids_json = remapJsonIds(
            row.linked_person_ids_json,
            personMap,
            projectMap,
            'person-ids',
          )
        }
      }
      if (projectMap.size > 0) {
        if ('project_id' in row) row.project_id = remapValue(row.project_id, projectMap)
        if ('merged_into' in row && name === 'projects') {
          row.merged_into = remapValue(row.merged_into, projectMap)
        }
        if (name === 'entity_proposals') {
          const kind = String(row.kind ?? '')
          if (kind === 'project') {
            row.matched_entity_id = remapValue(row.matched_entity_id, projectMap)
          }
        }
        if (
          name === 'entity_links' &&
          String(row.entity_kind ?? '') === 'project'
        ) {
          row.entity_id = remapValue(row.entity_id, projectMap)
        }
        if (
          name === 'embeddings' &&
          String(row.object_type ?? '') === 'project'
        ) {
          row.object_id = remapValue(row.object_id, projectMap)
        }
        if (name === 'sandbox_nodes' && String(row.kind ?? '') === 'project') {
          row.ref_id = remapValue(row.ref_id, projectMap)
        }
        if (name === 'ama_links') {
          if (String(row.object_type ?? '') === 'project') {
            row.object_id = remapValue(row.object_id, projectMap)
          }
          if (String(row.target_kind ?? '') === 'project') {
            row.target_id = remapValue(row.target_id, projectMap)
          }
        }
        if (name === 'map_tags' && String(row.target_kind ?? '') === 'project') {
          row.target_id = remapValue(row.target_id, projectMap)
        }
        if (
          name === 'dashboard_pins' &&
          String(row.ref_type ?? '') === 'project'
        ) {
          row.ref_id = remapValue(row.ref_id, projectMap)
        }
        if (name === 'chat_sessions') {
          if ('primary_project_id' in row) {
            row.primary_project_id = remapValue(
              row.primary_project_id,
              projectMap,
            )
          }
          row.linked_project_ids_json = remapJsonIds(
            row.linked_project_ids_json,
            personMap,
            projectMap,
            'project-ids',
          )
        }
        if (name === 'chat_blocks') {
          row.linked_project_ids_json = remapJsonIds(
            row.linked_project_ids_json,
            personMap,
            projectMap,
            'project-ids',
          )
        }
      }
      if (name === 'chat_blocks' && row.linked_entities_json) {
        try {
          const parsed = JSON.parse(String(row.linked_entities_json)) as unknown
          if (Array.isArray(parsed)) {
            row.linked_entities_json = JSON.stringify(
              parsed.map((item) => {
                if (!item || typeof item !== 'object') return item
                const o = { ...(item as Record<string, unknown>) }
                const kind = String(o.kind ?? '')
                const idKey = o.id != null ? 'id' : 'entity_id'
                const id = String(o[idKey] ?? '')
                if (kind === 'person' && personMap.size > 0) {
                  o[idKey] = remapValue(id, personMap)
                } else if (kind === 'project' && projectMap.size > 0) {
                  o[idKey] = remapValue(id, projectMap)
                }
                return o
              }),
            )
          }
        } catch {
          /* ignore */
        }
      }
      if (name === 'dialogo_threads') {
        row.entity_refs = remapJsonIds(
          row.entity_refs,
          personMap,
          projectMap,
          'entity-refs',
        )
      }
    }
  }
}

function foldIncomingProfile(
  db: DatabaseSync,
  table: 'persons' | 'projects',
  local: LocalProfile,
  dumpRow: Record<string, unknown>,
): void {
  const dumpCanonical =
    table === 'persons'
      ? String(dumpRow.name ?? '')
      : String(dumpRow.title ?? '')
  const aliases = unionAliases(local.canonical, local.aliases, [
    dumpCanonical,
    ...parseAliasList(dumpRow.aliases),
  ])
  const aliasesJson = JSON.stringify(aliases)
  const now = new Date().toISOString()
  const dumpNotes = String(dumpRow.notes ?? '').trim()
  const notes = local.notes.trim() || dumpNotes || null
  const promote =
    local.source !== 'manual' && isManualProfile(dumpRow)
  if (table === 'persons') {
    const name = promote ? dumpCanonical || local.canonical : local.canonical
    const kind = promote
      ? String(dumpRow.kind ?? local.kind)
      : String(local.row.kind ?? local.kind)
    const source = promote ? 'manual' : local.source
    db.prepare(
      `UPDATE persons SET aliases = ?, notes = ?, name = ?, kind = ?, source = ?, updated_at = ? WHERE id = ?`,
    ).run(aliasesJson, notes, name, kind, source, now, local.id)
    syncPersonAliases(local.id, name, aliasesJson)
    local.aliases = aliases
    local.canonical = name
    local.source = source
    local.notes = notes ?? ''
  } else {
    const title = promote ? dumpCanonical || local.canonical : local.canonical
    const source = promote ? 'manual' : local.source
    db.prepare(
      `UPDATE projects SET aliases = ?, notes = ?, title = ?, source = ?, updated_at = ? WHERE id = ?`,
    ).run(aliasesJson, notes, title, source, now, local.id)
    syncProjectAliases(local.id, title, aliasesJson)
    local.aliases = aliases
    local.canonical = title
    local.source = source
    local.notes = notes ?? ''
  }
}

function mergeIncomingProfiles(
  db: DatabaseSync,
  dump: BackupDump,
  table: 'persons' | 'projects',
): { remap: Map<string, string>; merged: number } {
  const remap = new Map<string, string>()
  const local = loadLocalProfiles(db, table)
  const incoming = dump.tables[table] ?? []
  let merged = 0
  for (const row of incoming) {
    if (typeof row.id !== 'string' || !isLiveProfile(row)) continue
    const canonical =
      table === 'persons' ? String(row.name ?? '') : String(row.title ?? '')
    const keys = profileKeys(canonical, row.aliases)
    const match = pickLocalMatch(row, keys, local)
    if (!match) continue
    foldIncomingProfile(db, table, match, row)
    for (const k of profileKeys(match.canonical, match.aliases)) {
      const list = local.byKey.get(k) ?? []
      if (!list.some((p) => p.id === match.id)) {
        list.push(match)
        local.byKey.set(k, list)
      }
    }
    if (row.id !== match.id) {
      remap.set(row.id, match.id)
      merged++
    }
  }
  return { remap, merged }
}

function filterMergeRows(
  db: DatabaseSync,
  name: BackupTableName,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (name !== 'geografia_geom' || !tableExists(db, 'geografia')) return rows
  const has = db.prepare(`SELECT 1 AS ok FROM geografia WHERE id = ?`)
  return rows.filter((row) => {
    const id = String(row.geografia_id ?? '')
    if (!id) return false
    return Boolean(has.get(id))
  })
}

export function restoreBackupFromJsonInto(
  raw: unknown,
  db: DatabaseSync,
): BackupApplyResult {
  const dump = parseDump(raw)

  const deleteOrder = [...BACKUP_TABLES].reverse()
  const inserted = emptyCounts()
  const skipped = emptyCounts()

  db.exec('BEGIN')
  try {
    for (const name of deleteOrder) {
      if (tableExists(db, name)) {
        db.exec(`DELETE FROM "${name}"`)
      }
    }

    for (const name of BACKUP_TABLES) {
      const result = insertTableRows(
        db,
        name,
        dump.tables[name] ?? [],
        'replace',
      )
      inserted[name] = result.inserted
      skipped[name] = result.skipped
    }

    rebuildSearchFts(db)
    backfillCurrentRun(db)
    db.exec('COMMIT')
    return {
      ok: true,
      mode: 'replace',
      tables: inserted,
      inserted,
      skipped,
      remapped: { trinchera: null },
      media: { copied: 0, skipped: 0, conflicts: 0, failed: 0 },
      mediaStatus: 'skipped',
      dbCommitted: false,
      profiles: { persons_merged: 0, projects_merged: 0 },
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

export function restoreBackupFromJson(raw: unknown): BackupApplyResult {
  const result = restoreBackupFromJsonInto(raw, getDb())
  ensureTrincheraSeed()
  result.dbCommitted = true
  return result
}

/** Escribe el dump en data/deprocast.restore.db. No toca la DB viva. */
export function restoreBackupToStagingFile(raw: unknown): BackupApplyResult {
  rmSqliteBundle(RESTORE_DB_PATH)
  const staging = openDbFile(RESTORE_DB_PATH, { seed: false })
  try {
    const result = restoreBackupFromJsonInto(raw, staging)
    const violations = staging.prepare('PRAGMA foreign_key_check').all() as Array<
      Record<string, unknown>
    >
    if (violations.length > 0) {
      throw new Error(
        `Restore rechazado: ${violations.length} violación(es) de foreign_key_check`,
      )
    }
    try {
      staging.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    staging.close()
    return result
  } catch (err) {
    try {
      staging.close()
    } catch {
      /* ignore */
    }
    rmSqliteBundle(RESTORE_DB_PATH)
    throw err
  }
}

/** Cierra la DB viva, swap del archivo staging, reabre. */
export function commitStagedRestore(): void {
  closeDb()
  try {
    swapSqliteFile(RESTORE_DB_PATH, getDbPath())
  } catch (err) {
    try {
      reopenDb()
    } catch {
      /* ignore */
    }
    throw err
  }
  reopenDb()
  ensureTrincheraSeed()
  backfillCurrentRun()
}

/** Inserta filas que no existen. Fusiona perfiles homólogos por nombre/alias. */
export function mergeBackupFromJson(raw: unknown): BackupApplyResult {
  const dump = parseDump(raw)
  const db = getDb()
  ensureTrincheraSeed()
  const localTrinchera = getTrincheraNotebookId()
  const trinchera = remapTrinchera(dump, localTrinchera)

  const inserted = emptyCounts()
  const skipped = emptyCounts()
  let personsMerged = 0
  let projectsMerged = 0

  db.exec('BEGIN')
  try {
    const persons = mergeIncomingProfiles(db, dump, 'persons')
    const projects = mergeIncomingProfiles(db, dump, 'projects')
    personsMerged = persons.merged
    projectsMerged = projects.merged
    applyIdMapsToDump(dump, persons.remap, projects.remap)

    for (const name of BACKUP_TABLES) {
      const prepared = filterMergeRows(
        db,
        name,
        (dump.tables[name] ?? []).map((row) => prepareMergeRow(name, row)),
      )
      const result = insertTableRows(db, name, prepared, 'merge')
      inserted[name] = result.inserted
      skipped[name] = result.skipped
    }

    rebuildSearchFts(db)
    db.exec('COMMIT')
    ensureTrincheraSeed()
    backfillCurrentRun(db)
    return {
      ok: true,
      mode: 'merge',
      tables: inserted,
      inserted,
      skipped,
      remapped: { trinchera },
      media: { copied: 0, skipped: 0, conflicts: 0, failed: 0 },
      mediaStatus: 'skipped',
      dbCommitted: true,
      profiles: {
        persons_merged: personsMerged,
        projects_merged: projectsMerged,
      },
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

/** Borra la actividad del usuario. Conserva AmazonA, listas de agentes, el mapa y el núcleo Deprocast. */
export function wipeUserActivity(): void {
  const db = getDb()

  const deleteOrder = [...USER_ACTIVITY_TABLES].reverse()

  db.exec('BEGIN')
  try {
    if (tableExists(db, 'ama_links')) {
      db.exec(
        `DELETE FROM ama_links
         WHERE target_kind IN ('person', 'project', 'agrupacion', 'entry', 'quantomo')
            OR object_type IN ('person', 'project', 'agrupacion', 'entry', 'quantomo')`,
      )
    }
    if (tableExists(db, 'map_tags')) {
      db.exec(
        `DELETE FROM map_tags
         WHERE target_kind IN ('person', 'project', 'agrupacion', 'entry', 'quantomo')`,
      )
    }
    for (const name of deleteOrder) {
      if (!tableExists(db, name)) continue
      if (name === 'embeddings') {
        db.exec(
          `DELETE FROM embeddings
           WHERE object_type NOT IN ('sentinel_profile', 'sentinel_skill', 'doc')`,
        )
        continue
      }
      db.exec(`DELETE FROM "${name}"`)
    }
    rebuildSearchFts(db)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
  ensureTrincheraSeed()
}
