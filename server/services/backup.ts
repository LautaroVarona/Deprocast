import type { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import {
  backfillCurrentRun,
  ensureTrincheraSeed,
  getDb,
  rebuildSearchFts,
} from '../db.js'
import { pausePipeline } from './pipeline.js'

export const BACKUP_FORMAT = 'deprocast-backup'
export const BACKUP_VERSION = 2

export type BackupPurpose = 'copy' | 'metanalisis'

export const BACKUP_TABLES = [
  'notebooks',
  'entries',
  'quantomos',
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
] as const

export type BackupTableName = (typeof BACKUP_TABLES)[number]

/** Actividad de la RUN: se borra en NUEVO USUARIO. AmazonA/Mapa quedan. */
export const USER_ACTIVITY_TABLES = [
  'notebooks',
  'entries',
  'quantomos',
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
  include_media: false
  run: BackupRunMeta | null
  vault_index: VaultIndexEntry[]
  tables: Record<string, Record<string, unknown>[]>
}

export type BackupSummary = {
  exported_at: string
  include_media: false
  run: BackupRunMeta | null
  tables: Record<string, number>
  groups: {
    transcripciones: number
    perfiles: number
    conexiones: number
    quantomos: number
    validaciones: number
    resto: number
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

function tableColumns(db: DatabaseSync, name: string): string[] {
  const info = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
    name: string
  }>
  return info.map((c) => c.name)
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

function walkVaultIndex(root: string): VaultIndexEntry[] {
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

export function dumpBackup(opts?: {
  purpose?: BackupPurpose
  run?: BackupRunMeta | null
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
    include_media: false,
    run: opts?.run ?? null,
    vault_index: walkVaultIndex(path.resolve(process.cwd(), 'vault')),
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
  return {
    exported_at: new Date().toISOString(),
    include_media: false,
    run,
    tables,
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
      resto:
        n('notebooks') +
        n('pending_tasks') +
        n('bookmarks') +
        n('chat_sessions') +
        n('chat_blocks') +
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
        n('depro_power_notes') +
        n('depro_ida_items') +
        n('depro_ida_cards') +
        n('depro_research_packs') +
        n('depro_research_findings'),
    },
  }
}

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

export function serializeBackupJson(dump: BackupDump): string {
  return JSON.stringify(dump, null, 2)
}

export function serializeBackupCsv(dump: BackupDump): string {
  const parts: string[] = [
    `# deprocast-backup v${dump.version}`,
    `# purpose ${dump.purpose}`,
    `# exported_at ${dump.exported_at}`,
    `# include_media false`,
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
    `<deprocast format="${BACKUP_FORMAT}" version="${dump.version}" purpose="${dump.purpose}" exported_at="${xmlEscape(dump.exported_at)}" include_media="false"${runAttr}>`,
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
  if (version !== 1 && version !== 2) {
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
    include_media: false,
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

export function restoreBackupFromJson(raw: unknown): {
  ok: true
  tables: Record<string, number>
} {
  const dump = parseDump(raw)
  const db = getDb()
  pausePipeline()

  const deleteOrder = [...BACKUP_TABLES].reverse()

  db.exec('BEGIN')
  try {
    for (const name of deleteOrder) {
      if (tableExists(db, name)) {
        db.exec(`DELETE FROM "${name}"`)
      }
    }

    const inserted: Record<string, number> = {}
    for (const name of BACKUP_TABLES) {
      if (!tableExists(db, name)) {
        inserted[name] = 0
        continue
      }
      const cols = tableColumns(db, name)
      const rows = dump.tables[name] ?? []
      if (rows.length === 0 || cols.length === 0) {
        inserted[name] = 0
        continue
      }
      const placeholders = cols.map(() => '?').join(', ')
      const quoted = cols.map((c) => `"${c}"`).join(', ')
      const stmt = db.prepare(
        `INSERT INTO "${name}" (${quoted}) VALUES (${placeholders})`,
      )
      for (const row of rows) {
        const values = cols.map((c) => cellValue(row[c]))
        stmt.run(...values)
      }
      inserted[name] = rows.length
    }

    rebuildSearchFts(db)
    db.exec('COMMIT')
    ensureTrincheraSeed()
    backfillCurrentRun(db)
    return { ok: true, tables: inserted }
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
  pausePipeline()

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
      if (tableExists(db, name)) {
        db.exec(`DELETE FROM "${name}"`)
      }
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
