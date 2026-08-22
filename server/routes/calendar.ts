import { Router } from 'express'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  CalendarOccurrence,
  CalendarTask,
  Entry,
  PendingTask,
} from '../types.js'

export const calendarRouter = Router()

type WeightRow = { entry_id: string; hermetic_weight: number | null }

type PageRow = {
  id: string
  title: string | null
  numero_logico: number
  status: string
  created_at: string
  updated_at: string
  notebook_title: string | null
}

type BookmarkRow = {
  id: string
  text: string
  author_name: string | null
  author_username: string | null
  created_at_source: string | null
  imported_at: string
  status: string
  source: string | null
  weight: number | null
}

function parseBound(raw: unknown, fallback: Date): Date {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return fallback
  return d
}

function inRange(iso: string | null | undefined, fromMs: number, toMs: number): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  return t >= fromMs && t <= toMs
}

function validIso(iso: string | null | undefined): iso is string {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t)
}

function clipTitle(text: string, max = 72): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function pushOccurrence(
  out: CalendarOccurrence[],
  fromMs: number,
  toMs: number,
  occ: Omit<CalendarOccurrence, 'id'> & { id?: string },
) {
  if (!inRange(occ.at, fromMs, toMs)) return
  out.push({
    ...occ,
    id: occ.id ?? `${occ.record_id}:${occ.pole}`,
  })
}

calendarRouter.get('/activity', (req, res) => {
  const now = new Date()
  const from = parseBound(
    req.query.from,
    new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000),
  )
  const to = parseBound(
    req.query.to,
    new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
  )
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  const db = getDb()
  const occurrences: CalendarOccurrence[] = []

  const entries = rows<Entry>(
    db
      .prepare(
        `SELECT * FROM entries
         WHERE status NOT IN ('rejected', 'split_parent')
           AND (
             (created_at >= ? AND created_at <= ?)
             OR (timestamp_exact IS NOT NULL AND timestamp_exact >= ? AND timestamp_exact <= ?)
           )`,
      )
      .all(fromIso, toIso, fromIso, toIso),
  )

  const tasksByEntry = new Map<string, CalendarTask[]>()
  const allTasks = rows<PendingTask>(
    db
      .prepare(
        `SELECT id, entry_id, task_text, tag, status FROM pending_tasks`,
      )
      .all(),
  )
  for (const t of allTasks) {
    if (!t.entry_id) continue
    const list = tasksByEntry.get(t.entry_id) ?? []
    list.push({
      id: t.id,
      entry_id: t.entry_id,
      task_text: t.task_text,
      tag: t.tag,
      status: t.status,
    })
    tasksByEntry.set(t.entry_id, list)
  }

  const weightByEntry = new Map<string, number | null>()
  const weights = rows<WeightRow>(
    db
      .prepare(
        `SELECT entry_id, MAX(hermetic_weight) AS hermetic_weight
         FROM quantomos
         GROUP BY entry_id`,
      )
      .all(),
  )
  for (const w of weights) {
    weightByEntry.set(w.entry_id, w.hermetic_weight)
  }

  for (const entry of entries) {
    const tasks = tasksByEntry.get(entry.id) ?? []
    const hermetic_weight = weightByEntry.get(entry.id) ?? null
    const human_weight = entry.human_weight ?? null
    const ingested = validIso(entry.created_at) ? entry.created_at : null
    const native = validIso(entry.timestamp_exact) ? entry.timestamp_exact : null
    const base = {
      record_id: entry.id,
      source_type: entry.source_type || 'blob',
      title: entry.title || 'Sin título',
      status: entry.status,
      tasks,
      hermetic_weight,
      human_weight,
    }
    if (ingested) {
      pushOccurrence(occurrences, fromMs, toMs, {
        ...base,
        pole: 'ingested',
        at: ingested,
        other_at: native,
      })
    }
    if (native) {
      pushOccurrence(occurrences, fromMs, toMs, {
        ...base,
        pole: 'native',
        at: native,
        other_at: ingested,
      })
    }
  }

  const pages = rows<PageRow>(
    db
      .prepare(
        `SELECT p.id, p.title, p.numero_logico, p.status,
                p.created_at, p.updated_at, n.title AS notebook_title
         FROM pages p
         LEFT JOIN notebooks n ON n.id = p.notebook_id
         WHERE (p.entry_id IS NULL OR p.entry_id = '')
           AND p.status != 'Vacia'`,
      )
      .all(),
  )

  for (const page of pages) {
    const at = validIso(page.updated_at)
      ? page.updated_at
      : validIso(page.created_at)
        ? page.created_at
        : null
    if (!at) continue
    const nb = page.notebook_title?.trim() || 'Cuaderno'
    const leaf = page.title?.trim() || `Hoja ${page.numero_logico}`
    pushOccurrence(occurrences, fromMs, toMs, {
      record_id: `page:${page.id}`,
      pole: 'ingested',
      at,
      source_type: 'notebook_page',
      title: `${nb} · ${leaf}`,
      status: page.status,
      tasks: [],
      hermetic_weight: null,
      human_weight: null,
      other_at: null,
    })
  }

  const bookmarks = rows<BookmarkRow>(
    db
      .prepare(
        `SELECT id, text, author_name, author_username, created_at_source,
                imported_at, status, source, weight
         FROM bookmarks
         WHERE entry_id IS NULL OR entry_id = ''`,
      )
      .all(),
  )

  for (const bm of bookmarks) {
    const source_type = bm.source === 'instagram' ? 'instagram' : 'bookmark'
    const who = bm.author_name || bm.author_username || 'bookmark'
    const title = clipTitle(`${who}: ${bm.text || '(sin texto)'}`)
    const ingested = validIso(bm.imported_at) ? bm.imported_at : null
    const native = validIso(bm.created_at_source) ? bm.created_at_source : null
    const base = {
      record_id: `bookmark:${bm.id}`,
      source_type,
      title,
      status: bm.status,
      tasks: [] as CalendarTask[],
      hermetic_weight: bm.weight,
      human_weight: bm.weight,
    }
    if (ingested) {
      pushOccurrence(occurrences, fromMs, toMs, {
        ...base,
        pole: 'ingested',
        at: ingested,
        other_at: native,
      })
    }
    if (native) {
      pushOccurrence(occurrences, fromMs, toMs, {
        ...base,
        pole: 'native',
        at: native,
        other_at: ingested,
      })
    }
  }

  occurrences.sort((a, b) => {
    const cmp = a.at.localeCompare(b.at)
    if (cmp !== 0) return cmp
    if (a.record_id !== b.record_id) return a.record_id.localeCompare(b.record_id)
    return a.pole.localeCompare(b.pole)
  })

  res.json({ occurrences })
})

calendarRouter.patch('/tasks/:taskId', (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  if (!taskId) {
    res.status(400).json({ error: 'taskId requerido' })
    return
  }

  const db = getDb()
  const current = row<PendingTask>(
    db
      .prepare(
        `SELECT id, entry_id, task_text, tag, status FROM pending_tasks WHERE id = ?`,
      )
      .get(taskId),
  )
  if (!current) {
    res.status(404).json({ error: 'Tarea no encontrada' })
    return
  }

  const body = (req.body ?? {}) as { done?: unknown; status?: unknown }
  let next = current.status
  if (typeof body.status === 'string' && body.status.trim()) {
    next = body.status.trim()
  } else if (typeof body.done === 'boolean') {
    next = body.done ? 'done' : current.status === 'done' ? 'accepted' : current.status
  } else {
    next = current.status === 'done' ? 'accepted' : 'done'
  }

  db.prepare(`UPDATE pending_tasks SET status = ? WHERE id = ?`).run(next, taskId)
  const task = row<PendingTask>(
    db
      .prepare(
        `SELECT id, entry_id, task_text, tag, status FROM pending_tasks WHERE id = ?`,
      )
      .get(taskId),
  )

  res.json({ ok: true, task })
})
