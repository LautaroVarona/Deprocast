import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDbFile } from '../server/db.ts'
import {
  getDayEnergy,
  getWeekMatrix,
  hidesHighGravity,
  putDayEnergy,
  putWeekMatrix,
  runWeekSimulations,
} from '../server/services/calendarChronos.ts'
import type { DatabaseSync } from 'node:sqlite'

describe('calendar chronos', () => {
  const dirs: string[] = []
  const dbs: DatabaseSync[] = []

  afterEach(() => {
    for (const database of dbs) {
      try {
        database.close()
      } catch {
        /* ignore */
      }
    }
    dbs.length = 0
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0
  })

  function openTemp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-cal-'))
    dirs.push(dir)
    const database = openDbFile(path.join(dir, 't.db'), { seed: false })
    dbs.push(database)
    return database
  }

  it('persiste la matriz 6x6 y no acepta celdas fuera de rango', () => {
    const db = openTemp()
    const saved = putWeekMatrix(
      '2026-09-07',
      { 'task-a': 3, 'task-b': 99, '': 1 },
      db,
    )
    expect(saved.map['task-a']).toBe(3)
    expect(saved.map['task-b']).toBeUndefined()
    expect(getWeekMatrix('2026-09-07', db).map).toEqual({ 'task-a': 3 })
  })

  it('guarda energía y oculta gravity alta si mente o cuerpo < 5', () => {
    const db = openTemp()
    const energy = putDayEnergy(
      '2026-09-11',
      { cuerpo: 4, mente: 8, alma: 9, split_mode: '2' },
      db,
    )
    expect(energy.split_mode).toBe('2')
    expect(energy.cuerpo).toBe(4)
    expect(hidesHighGravity(energy, 10)).toBe(true)
    expect(hidesHighGravity(getDayEnergy('2026-09-11', db), 6)).toBe(false)
  })

  it('simula las 6 tipologías contra la matriz humana', () => {
    const db = openTemp()
    putWeekMatrix('2026-09-07', { a: 0, b: 7, c: 14 }, db)
    const sims = runWeekSimulations('2026-09-07', { db, uncollapsed: 2 })
    expect(sims).toHaveLength(6)
    expect(sims.every((s) => s.friction >= 0)).toBe(true)
    expect(new Set(sims.map((s) => s.typology)).size).toBe(6)
  })
})
