/**
 * Persistencia Chronos: matriz 6×6, energía del día, simulación de tipologías.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  CalendarDayEnergy,
  CalendarDaySplitMode,
  CalendarSimulation,
  CalendarTypology,
  CalendarWeekMatrix,
} from '../types.js'

export const CALENDAR_TYPOLOGIES: CalendarTypology[] = [
  'vectorizador',
  'clasificador',
  'crawler',
  'generativo',
  'ejecutivo',
  'omnivoro',
]

const DEFAULT_ENERGY: Omit<CalendarDayEnergy, 'day'> = {
  cuerpo: 8,
  mente: 8,
  alma: 8,
  source: 'manual',
  split_mode: '3',
}

function useDb(db?: DatabaseSync): DatabaseSync {
  return db ?? getDb()
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const hit = row<{ n: number }>(
    db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name),
  )
  return (hit?.n ?? 0) > 0
}

function clampEnergy(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(12, Math.max(1, Math.round(v)))
}

function asSplit(raw: unknown): CalendarDaySplitMode {
  return raw === '2' ? '2' : '3'
}

export function getWeekMatrix(
  weekMonday: string,
  db?: DatabaseSync,
): CalendarWeekMatrix {
  const database = useDb(db)
  const map: Record<string, number> = {}
  if (!tableExists(database, 'calendar_week_matrix')) {
    return { week: weekMonday, map }
  }
  const found = rows<{ task_id: string; cell: number }>(
    database
      .prepare(
        `SELECT task_id, cell FROM calendar_week_matrix WHERE week_monday = ?`,
      )
      .all(weekMonday),
  )
  for (const r of found) {
    if (r.cell >= 0 && r.cell < 36) map[r.task_id] = r.cell
  }
  return { week: weekMonday, map }
}

export function putWeekMatrix(
  weekMonday: string,
  map: Record<string, number>,
  db?: DatabaseSync,
): CalendarWeekMatrix {
  const database = useDb(db)
  if (!tableExists(database, 'calendar_week_matrix')) {
    return { week: weekMonday, map: {} }
  }
  const now = new Date().toISOString()
  const clean: Record<string, number> = {}
  for (const [id, cell] of Object.entries(map)) {
    if (typeof cell === 'number' && cell >= 0 && cell < 36 && id.trim()) {
      clean[id] = Math.floor(cell)
    }
  }
  database.exec('BEGIN')
  try {
    database
      .prepare(`DELETE FROM calendar_week_matrix WHERE week_monday = ?`)
      .run(weekMonday)
    const ins = database.prepare(
      `INSERT INTO calendar_week_matrix (week_monday, task_id, cell, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    for (const [id, cell] of Object.entries(clean)) {
      ins.run(weekMonday, id, cell, now)
    }
    database.exec('COMMIT')
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  }
  return { week: weekMonday, map: clean }
}

export function placeMatrixCell(
  weekMonday: string,
  taskId: string,
  cell: number,
  db?: DatabaseSync,
): CalendarWeekMatrix {
  const current = getWeekMatrix(weekMonday, db)
  const next = { ...current.map, [taskId]: Math.max(0, Math.min(35, Math.floor(cell))) }
  return putWeekMatrix(weekMonday, next, db)
}

export function getDayEnergy(
  dayKey: string,
  db?: DatabaseSync,
): CalendarDayEnergy {
  const database = useDb(db)
  if (!tableExists(database, 'calendar_day_energy')) {
    return { day: dayKey, ...DEFAULT_ENERGY }
  }
  const r = row<{
    cuerpo: number
    mente: number
    alma: number
    source: string
    split_mode: string
  }>(
    database
      .prepare(
        `SELECT cuerpo, mente, alma, source, split_mode
         FROM calendar_day_energy WHERE day_key = ?`,
      )
      .get(dayKey),
  )
  if (!r) return { day: dayKey, ...DEFAULT_ENERGY }
  return {
    day: dayKey,
    cuerpo: clampEnergy(r.cuerpo, 8),
    mente: clampEnergy(r.mente, 8),
    alma: clampEnergy(r.alma, 8),
    source: r.source || 'manual',
    split_mode: asSplit(r.split_mode),
  }
}

export function putDayEnergy(
  dayKey: string,
  patch: Partial<Omit<CalendarDayEnergy, 'day'>>,
  db?: DatabaseSync,
): CalendarDayEnergy {
  const database = useDb(db)
  const prev = getDayEnergy(dayKey, db)
  const next: CalendarDayEnergy = {
    day: dayKey,
    cuerpo: clampEnergy(patch.cuerpo ?? prev.cuerpo, prev.cuerpo),
    mente: clampEnergy(patch.mente ?? prev.mente, prev.mente),
    alma: clampEnergy(patch.alma ?? prev.alma, prev.alma),
    source: typeof patch.source === 'string' && patch.source.trim()
      ? patch.source.trim()
      : prev.source,
    split_mode: patch.split_mode ? asSplit(patch.split_mode) : prev.split_mode,
  }
  if (!tableExists(database, 'calendar_day_energy')) return next
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO calendar_day_energy
        (day_key, cuerpo, mente, alma, source, split_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_key) DO UPDATE SET
         cuerpo = excluded.cuerpo,
         mente = excluded.mente,
         alma = excluded.alma,
         source = excluded.source,
         split_mode = excluded.split_mode,
         updated_at = excluded.updated_at`,
    )
    .run(
      dayKey,
      next.cuerpo,
      next.mente,
      next.alma,
      next.source,
      next.split_mode,
      now,
    )
  return next
}

function allCells(): number[] {
  return Array.from({ length: 36 }, (_, i) => i)
}

function preferredCells(typology: CalendarTypology): number[] {
  const all = allCells()
  const row = (r: number) => all.filter((c) => Math.floor(c / 6) === r)
  const col = (k: number) => all.filter((c) => c % 6 === k)
  switch (typology) {
    case 'ejecutivo':
      return [...row(0), ...row(1), ...all]
    case 'generativo':
      return [...row(4), ...row(5), ...all]
    case 'crawler':
      return [...row(2), ...row(3), ...all]
    case 'vectorizador':
      return [...col(0), ...col(1), ...all]
    case 'clasificador':
      return [...col(2), ...col(3), ...all]
    default:
      return all.filter((c) => (Math.floor(c / 6) + (c % 6)) % 2 === 0).concat(all)
  }
}

function fillPlan(ids: string[], typology: CalendarTypology): Record<string, number> {
  const preferred = preferredCells(typology)
  const used = new Set<number>()
  const plan: Record<string, number> = {}
  let pi = 0
  for (const id of ids) {
    while (pi < preferred.length && used.has(preferred[pi])) pi += 1
    let cell = preferred[pi]
    if (cell == null || used.has(cell)) {
      cell = allCells().find((c) => !used.has(c)) ?? 0
    }
    used.add(cell)
    plan[id] = cell
    pi += 1
  }
  return plan
}

function frictionScore(
  human: Record<string, number>,
  sim: Record<string, number>,
  uncollapsed: number,
): number {
  const ids = new Set([...Object.keys(human), ...Object.keys(sim)])
  let d = 0
  for (const id of ids) {
    if (human[id] !== sim[id]) d += 1
  }
  return d + uncollapsed * 0.25
}

export function runWeekSimulations(
  weekMonday: string,
  opts?: { db?: DatabaseSync; uncollapsed?: number },
): CalendarSimulation[] {
  const database = useDb(opts?.db)
  const human = getWeekMatrix(weekMonday, database).map
  const ids = Object.keys(human)
  const uncollapsed = opts?.uncollapsed ?? 0
  const now = new Date().toISOString()
  const out: CalendarSimulation[] = []
  if (!tableExists(database, 'calendar_simulations')) return out

  const upsert = database.prepare(
    `INSERT INTO calendar_simulations
      (id, typology, week_monday, plan_json, friction, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(typology, week_monday) DO UPDATE SET
       plan_json = excluded.plan_json,
       friction = excluded.friction,
       created_at = excluded.created_at`,
  )

  for (const typology of CALENDAR_TYPOLOGIES) {
    const plan = fillPlan(ids, typology)
    const friction = frictionScore(human, plan, uncollapsed)
    const id = randomUUID()
    upsert.run(id, typology, weekMonday, JSON.stringify(plan), friction, now)
    const stored = row<{
      id: string
      typology: string
      week_monday: string
      plan_json: string
      friction: number | null
      created_at: string
    }>(
      database
        .prepare(
          `SELECT id, typology, week_monday, plan_json, friction, created_at
           FROM calendar_simulations
           WHERE typology = ? AND week_monday = ?`,
        )
        .get(typology, weekMonday),
    )
    if (!stored) continue
    out.push({
      id: stored.id,
      typology: stored.typology as CalendarTypology,
      week_monday: stored.week_monday,
      plan: JSON.parse(stored.plan_json) as Record<string, number>,
      friction: stored.friction ?? friction,
      created_at: stored.created_at,
    })
  }
  return out
}

export function listWeekSimulations(
  weekMonday: string,
  db?: DatabaseSync,
): CalendarSimulation[] {
  const database = useDb(db)
  if (!tableExists(database, 'calendar_simulations')) return []
  const found = rows<{
    id: string
    typology: string
    week_monday: string
    plan_json: string
    friction: number | null
    created_at: string
  }>(
    database
      .prepare(
        `SELECT id, typology, week_monday, plan_json, friction, created_at
         FROM calendar_simulations
         WHERE week_monday = ?
         ORDER BY typology ASC`,
      )
      .all(weekMonday),
  )
  return found.map((r) => ({
    id: r.id,
    typology: r.typology as CalendarTypology,
    week_monday: r.week_monday,
    plan: JSON.parse(r.plan_json) as Record<string, number>,
    friction: r.friction ?? 0,
    created_at: r.created_at,
  }))
}

export function hidesHighGravity(energy: CalendarDayEnergy, gravity: number | null): boolean {
  if (gravity == null || gravity < 10) return false
  return energy.mente < 5 || energy.cuerpo < 5
}
