import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { backfillCurrentRun, getDb, syncPersonAliases } from '../db.js'
import type { AppRun } from '../types.js'
import { embedPerson, enqueueEmbed } from './embeddings.js'
import {
  dumpBackup,
  serializeBackupJson,
  wipeUserActivity,
  type BackupDump,
  type BackupRunMeta,
} from './backup.js'

const RESPALDOS_DIR = path.resolve(process.cwd(), 'data', 'respaldos')
const MAX_NAME = 120

type AppRunRow = {
  id: string
  operator_id: string
  operator_name: string
  started_at: string
  ended_at: string | null
  status: string
  backup_path: string | null
  created_at: string
}

export function runDayCount(startedAt: string, until: Date = new Date()): number {
  const start = new Date(startedAt)
  if (Number.isNaN(start.getTime())) return 1
  const utcA = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const utcB = Date.UTC(until.getFullYear(), until.getMonth(), until.getDate())
  const n = Math.round((utcB - utcA) / 86400000) + 1
  return n < 1 ? 1 : n
}

function toPublic(row: AppRunRow, until?: Date): AppRun {
  return {
    id: row.id,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status === 'ended' ? 'ended' : 'current',
    backup_path: row.backup_path,
    created_at: row.created_at,
    day_count: runDayCount(row.started_at, until),
  }
}

export function getCurrentRun(): AppRun | null {
  try {
    const db = getDb()
    backfillCurrentRun(db)
    const row = db
      .prepare(
        `SELECT * FROM app_runs WHERE status = 'current' LIMIT 1`,
      )
      .get() as AppRunRow | undefined
    return row ? toPublic(row) : null
  } catch (err) {
    console.error('[run] getCurrentRun', err)
    return null
  }
}

export function toBackupRunMeta(
  run: AppRun | null,
  opts?: { endedAt?: string },
): BackupRunMeta | null {
  if (!run) return null
  const endedAt = opts?.endedAt ?? run.ended_at
  const until = endedAt ? new Date(endedAt) : new Date()
  return {
    id: run.id,
    operator_id: run.operator_id,
    operator_name: run.operator_name,
    started_at: run.started_at,
    ended_at: endedAt,
    day_count: runDayCount(run.started_at, until),
  }
}

export function slugName(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return s || 'operador'
}

export function dayStamp(iso: string): string {
  return iso.slice(0, 10)
}

function normalizeName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME)
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es')
}

function insertOperator(name: string, now: string): { id: string; name: string } {
  const db = getDb()
  const existing = db
    .prepare(
      `SELECT id, name FROM persons
       WHERE lower(name) = lower(?)
         AND (merged_into IS NULL OR merged_into = '')
       ORDER BY CASE WHEN is_operator = 1 THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(name) as { id: string; name: string } | undefined

  db.prepare(`UPDATE persons SET is_operator = 0, updated_at = ?`).run(now)

  if (existing) {
    db.prepare(
      `UPDATE persons SET is_operator = 1, updated_at = ? WHERE id = ?`,
    ).run(now, existing.id)
    return { id: existing.id, name: existing.name }
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO persons (
      id, name, kind, aliases, notes, status, created_at, updated_at,
      source, is_operator
    ) VALUES (?, ?, 'fisica', '[]', NULL, 'active', ?, ?, 'manual', 1)`,
  ).run(id, name, now, now)
  syncPersonAliases(id, name, '[]')
  enqueueEmbed(() => embedPerson(id))
  return { id, name }
}

function insertCurrentRun(
  operator: { id: string; name: string },
  now: string,
  backupPath: string | null = null,
): AppRun {
  const db = getDb()
  db.prepare(`UPDATE app_runs SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE status = 'current'`).run(
    now,
  )
  const id = randomUUID()
  db.prepare(
    `INSERT INTO app_runs (
      id, operator_id, operator_name, started_at, ended_at,
      status, backup_path, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'current', ?, ?)`,
  ).run(id, operator.id, operator.name, now, backupPath, now)
  const row = db.prepare(`SELECT * FROM app_runs WHERE id = ?`).get(id) as AppRunRow
  return toPublic(row)
}

/** Primera RUN o datos existentes sin operador: no destruye. */
export function startRun(rawName: unknown): AppRun {
  const name = normalizeName(rawName)
  if (!name) {
    throw new Error('El nombre es obligatorio')
  }
  const existing = getCurrentRun()
  if (existing) {
    if (namesMatch(existing.operator_name, name)) {
      return existing
    }
    throw new Error('Ya hay una RUN en curso')
  }
  const now = new Date().toISOString()
  const operator = insertOperator(name, now)
  return insertCurrentRun(operator, now)
}

function metanalisisFilename(run: AppRun, endedAt: string): string {
  return `deprocast-${slugName(run.operator_name)}-${dayStamp(run.started_at)}-${dayStamp(endedAt)}.json`
}

export function copyBackupFilename(run: AppRun | null): string {
  const day = dayStamp(new Date().toISOString())
  if (!run) return `deprocast-respaldo-${day}.json`
  return `deprocast-respaldo-${slugName(run.operator_name)}-${day}.json`
}

export type NewUserResult = {
  filename: string
  backup_path: string
  dump: BackupDump
  run: AppRun
}

/** Respaldo a disco + destrucción de actividad + nueva RUN. */
export function newUserRun(opts: {
  confirmDestroy: unknown
  operatorName: unknown
  newName: unknown
}): NewUserResult {
  const current = getCurrentRun()
  if (!current) {
    throw new Error('No hay RUN que destruir. Usá NUEVO USUARIO para empezar.')
  }
  if (String(opts.confirmDestroy ?? '').trim() !== 'DESTRUIR') {
    throw new Error('Escribí DESTRUIR para confirmar')
  }
  if (!namesMatch(String(opts.operatorName ?? ''), current.operator_name)) {
    throw new Error('El nombre del operador no coincide')
  }
  const newName = normalizeName(opts.newName)
  if (!newName) {
    throw new Error('El nombre del nuevo operador es obligatorio')
  }

  const endedAt = new Date().toISOString()
  const dump = dumpBackup({
    purpose: 'metanalisis',
    run: toBackupRunMeta(current, { endedAt }),
  })
  const filename = metanalisisFilename(current, endedAt)
  fs.mkdirSync(RESPALDOS_DIR, { recursive: true })
  const abs = path.join(RESPALDOS_DIR, filename)
  fs.writeFileSync(abs, serializeBackupJson(dump), 'utf8')
  const backupPath = path.relative(process.cwd(), abs).replaceAll('\\', '/')

  wipeUserActivity()

  const now = new Date().toISOString()
  const operator = insertOperator(newName, now)
  const run = insertCurrentRun(operator, now, backupPath)
  return { filename, backup_path: backupPath, dump, run }
}
