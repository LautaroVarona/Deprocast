import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDbFile } from '../server/db.ts'
import {
  acceptSuggestedTodo,
  computeHoldAt,
  minuteSlices,
  patchSuggestedTodo,
  regenerateSuggestedTodos,
  VARONA_TZ,
} from '../server/services/suggestedTodos.ts'
import type { DatabaseSync } from 'node:sqlite'

describe('suggested todos', () => {
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-todos-'))
    dirs.push(dir)
    const database = openDbFile(path.join(dir, 't.db'), { seed: false })
    dbs.push(database)
    return database
  }

  function nowIso() {
    return '2026-09-09T10:00:00.000Z'
  }

  it('curriculum + proyecto activo + waiting producen ítems con IDs reales', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO knowledge_entities (
        id, kind, title, authors_org, source_url, summary, utility_problem,
        architecture_tldr, use_cases, captured_at, status, capture_error,
        weight, distilled_at, domain_ids, tags, notes, capture_mode,
        created_at, updated_at
      ) VALUES (
        'k-cur', 'curriculum', 'Ruta IDA', '', NULL, '', '', '', '',
        ?, 'ready', NULL, 10, NULL, '[]', '["ruta-1"]', '', 'manual', ?, ?
      )`,
    ).run(at, at, at)
    db.prepare(
      `INSERT INTO projects (
        id, title, category, status, tactical_focus, notes, aliases,
        created_at, updated_at, source
      ) VALUES (
        'p-1', 'Deprocast core', 'proyecto', 'activo', '', '', '[]', ?, ?, 'manual'
      )`,
    ).run(at, at)
    db.prepare(
      `INSERT INTO persons (
        id, name, kind, aliases, notes, status, created_at, updated_at, source
      ) VALUES (
        'w-1', 'Ner Pendiente', 'fisica', '[]', '', 'active', ?, ?, 'extractor'
      )`,
    ).run(at, at)

    const { todos } = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })

    const cur = todos.find((t) => t.source.kind === 'curriculum' && t.source.refs.includes('k-cur'))
    const proj = todos.find((t) => t.source.kind === 'project' && t.source.refs.includes('p-1') && !t.parent_id)
    const wait = todos.find((t) => t.source.kind === 'person_waiting' && t.source.refs.includes('w-1'))
    expect(cur).toBeTruthy()
    expect(cur?.relations.knowledge_ids).toContain('k-cur')
    expect(cur?.why.length).toBeGreaterThan(8)
    expect(cur?.source.kind).toBe('curriculum')
    expect(proj).toBeTruthy()
    expect(proj?.relations.project_ids).toContain('p-1')
    expect(wait).toBeTruthy()
    expect(wait?.source.kind).toBe('person_waiting')
    expect(wait?.title.startsWith('Resolvé')).toBe(true)
  })

  it('no sugiere en sala a extractor ya miembro de agrupación', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO persons (
        id, name, kind, aliases, notes, status, created_at, updated_at, source
      ) VALUES (
        'w-ama', 'Amazonas', 'ficticia', '[]', '', 'active', ?, ?, 'extractor'
      )`,
    ).run(at, at)
    db.prepare(
      `INSERT INTO agrupaciones (id, name, notes, generated_meta, created_at, updated_at)
       VALUES ('ag-1', 'AmazonA', '', '{}', ?, ?)`,
    ).run(at, at)
    db.prepare(
      `INSERT INTO agrupacion_members (id, agrupacion_id, person_id, created_at)
       VALUES ('am-1', 'ag-1', 'w-ama', ?)`,
    ).run(at)

    const { todos } = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    expect(todos.filter((t) => t.source.refs.includes('w-ama'))).toHaveLength(0)
  })

  it('regen no duplica suggested ni pisa accepted', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO projects (
        id, title, category, status, tactical_focus, notes, aliases,
        created_at, updated_at, source
      ) VALUES (
        'p-1', 'Deprocast core', 'proyecto', 'activo', '', '', '[]', ?, ?, 'manual'
      )`,
    ).run(at, at)

    const first = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const target = first.todos.find((t) => t.source.kind === 'project' && t.source.refs.includes('p-1') && !t.parent_id)
    expect(target).toBeTruthy()
    const accepted = acceptSuggestedTodo(
      target!.id,
      { create_calendar_hold: false },
      { db, now: new Date(at) },
    )
    expect(accepted.status).toBe('accepted')
    const originalTitle = accepted.title

    db.prepare(`UPDATE projects SET title = 'Renombrado' WHERE id = 'p-1'`).run()
    const second = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const sameFp = second.todos.filter((t) => t.fingerprint === accepted.fingerprint)
    expect(sameFp).toHaveLength(1)
    expect(sameFp[0].status).toBe('accepted')
    expect(sameFp[0].title).toBe(originalTitle)

    const sameRule = second.todos.filter(
      (t) => t.status === 'suggested' && t.source.rule === 'project.active',
    )
    expect(sameRule).toHaveLength(0)
  })

  it('dismissed no reaparece con el mismo fingerprint', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO persons (
        id, name, kind, aliases, notes, status, created_at, updated_at, source
      ) VALUES (
        'w-1', 'Ner Pendiente', 'fisica', '[]', '', 'active', ?, ?, 'extractor'
      )`,
    ).run(at, at)
    const first = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const wait = first.todos.find((t) => t.source.refs.includes('w-1'))
    expect(wait).toBeTruthy()
    patchSuggestedTodo(wait!.id, { status: 'dismissed' }, { db })

    const second = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const again = second.todos.find((t) => t.fingerprint === wait!.fingerprint)
    expect(again?.status).toBe('dismissed')
    expect(
      second.todos.filter(
        (t) => t.status === 'suggested' && t.source.refs.includes('w-1'),
      ),
    ).toHaveLength(0)
  })

  it('cupo hoy+esta_semana no supera 12', async () => {
    const db = openTemp()
    const at = nowIso()
    const insP = db.prepare(
      `INSERT INTO persons (
        id, name, kind, aliases, notes, status, created_at, updated_at, source
      ) VALUES (?, ?, 'fisica', '[]', '', 'active', ?, ?, 'extractor')`,
    )
    for (let i = 0; i < 20; i++) {
      insP.run(`w-${i}`, `Persona ${i}`, at, at)
    }
    const { todos } = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const near = todos.filter(
      (t) => t.status === 'suggested' && (t.horizon === 'hoy' || t.horizon === 'esta_semana'),
    )
    expect(near.length).toBeLessThanOrEqual(12)
    expect(todos.some((t) => t.horizon === 'cola')).toBe(true)
  })

  it('accept con hold setea hold_at laboral Madrid y no escribe pending_tasks', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO projects (
        id, title, category, status, tactical_focus, notes, aliases,
        created_at, updated_at, source
      ) VALUES (
        'p-1', 'Deprocast core', 'proyecto', 'activo', '', '', '[]', ?, ?, 'manual'
      )`,
    ).run(at, at)
    const { todos } = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const proj = todos.find((t) => t.source.kind === 'project' && t.source.refs.includes('p-1') && !t.parent_id)
    expect(proj).toBeTruthy()
    const accepted = acceptSuggestedTodo(
      proj!.id,
      { create_calendar_hold: true },
      { db, now: new Date(at) },
    )
    expect(accepted.status).toBe('accepted')
    expect(accepted.hold_at).toBeTruthy()
    const hold = new Date(accepted.hold_at!)
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: VARONA_TZ,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(hold)
    const map: Record<string, string> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value
    }
    expect(map.hour).toBe('08')
    expect(map.minute).toBe('30')
    expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(map.weekday)

    const n = db.prepare(`SELECT COUNT(*) AS n FROM pending_tasks`).get() as {
      n: number
    }
    expect(n.n).toBe(0)
  })

  it('sin LLM los títulos salen de reglas', async () => {
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO knowledge_entities (
        id, kind, title, authors_org, source_url, summary, utility_problem,
        architecture_tldr, use_cases, captured_at, status, capture_error,
        weight, distilled_at, domain_ids, tags, notes, capture_mode,
        created_at, updated_at
      ) VALUES (
        'k-cur', 'curriculum', 'Ruta IDA', '', NULL, '', '', '', '',
        ?, 'ready', NULL, 10, NULL, '[]', '["ruta-1"]', '', 'manual', ?, ?
      )`,
    ).run(at, at, at)
    const { todos } = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const cur = todos.find((t) => t.source.rule === 'knowledge.curriculum')
    expect(cur?.title).toBe('Seguí el curriculum «Ruta IDA»')
  })

  it('computeHoldAt cae en ventana laboral si el slot de hoy ya pasó', () => {
    const iso = computeHoldAt(
      { dow: [1, 2, 3, 4, 5], time_local: '08:30' },
      new Date('2026-09-09T10:00:00.000Z'),
      true,
    )
    const hold = new Date(iso)
    expect(hold.getTime()).toBeGreaterThan(Date.parse('2026-09-09T10:00:00.000Z'))
  })

  it('Task-Breaker parte curricula de 90 min en LudusMicrotask con IDs reales', async () => {
    expect(minuteSlices(90)).toEqual([40, 40, 15])
    const db = openTemp()
    const at = nowIso()
    db.prepare(
      `INSERT INTO knowledge_entities (
        id, kind, title, authors_org, source_url, summary, utility_problem,
        architecture_tldr, use_cases, captured_at, status, capture_error,
        weight, distilled_at, domain_ids, tags, notes, capture_mode,
        created_at, updated_at
      ) VALUES (
        'k-cur', 'curriculum', 'Ruta IDA', '', NULL, '', '', '', '',
        ?, 'ready', NULL, 10, NULL, '[]', '["ruta-1"]', '', 'manual', ?, ?
      )`,
    ).run(at, at, at)
    const first = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const parent = first.todos.find(
      (t) => t.source.kind === 'curriculum' && t.source.refs.includes('k-cur'),
    )
    expect(parent).toBeTruthy()
    const kids = first.todos.filter(
      (t) => t.source.kind === 'ludus_microtask' && t.parent_id === parent!.id,
    )
    expect(kids.length).toBeGreaterThanOrEqual(2)
    for (const kid of kids) {
      expect(kid.source.refs).toEqual(['k-cur'])
      expect(kid.estimate_minutes).toBeGreaterThanOrEqual(15)
      expect(kid.estimate_minutes).toBeLessThanOrEqual(40)
      expect(kid.coagulation).toBe('suggestion')
    }
    const accepted = acceptSuggestedTodo(
      kids[0].id,
      { create_calendar_hold: false },
      { db, now: new Date(at) },
    )
    expect(accepted.status).toBe('accepted')
    const second = await regenerateSuggestedTodos({
      db,
      now: new Date(at),
      useLlm: false,
    })
    const sameKids = second.todos.filter(
      (t) => t.source.kind === 'ludus_microtask' && t.parent_id === parent!.id,
    )
    expect(sameKids.filter((t) => t.status === 'accepted')).toHaveLength(1)
    expect(
      sameKids.filter((t) => t.fingerprint === accepted.fingerprint),
    ).toHaveLength(1)
  })
})
