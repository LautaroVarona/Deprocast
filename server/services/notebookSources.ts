import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  NotebookPage,
  NotebookSource,
  NotebookSourceKind,
  NotebookSourceStatus,
} from '../types.js'
import { createRequire } from 'node:module'
import { transcribeAudio } from './deepgram.js'
import { getPage, listPages, rebuildNotebookIndex } from './notebookPages.js'

const require = createRequire(import.meta.url)

function notebookVaultDir(notebookId: string): string {
  return path.resolve(process.cwd(), 'vault', 'notebooks', notebookId)
}

const EXPLANATION_SEPARATOR = '____________________'

export type NotebookSourceView = NotebookSource & {
  payload: Record<string, unknown>
}

export type OverlayRow = {
  slot?: number
  numero_logico?: number
  title?: string
  notes?: string
  tags?: string[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function parsePayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}

export function hydrateSource(source: NotebookSource): NotebookSourceView {
  return { ...source, payload: parsePayload(source.payload_json) }
}

function splitExplanation(
  full: string | null | undefined,
  userStored?: string | null,
): { user: string; ai: string } {
  const storedUser = (userStored || '').trim()
  const text = (full || '').trim()
  if (storedUser) {
    const idx = text.indexOf(EXPLANATION_SEPARATOR)
    if (idx >= 0) {
      return {
        user: storedUser,
        ai: text
          .slice(idx + EXPLANATION_SEPARATOR.length)
          .replace(/^\n+/, '')
          .trim(),
      }
    }
    if (text === storedUser) return { user: storedUser, ai: '' }
    if (text.startsWith(storedUser)) {
      return {
        user: storedUser,
        ai: text.slice(storedUser.length).replace(/^\n+/, '').trim(),
      }
    }
    return { user: storedUser, ai: '' }
  }
  const wrapped = `\n${EXPLANATION_SEPARATOR}\n`
  const idx = text.indexOf(wrapped)
  if (idx >= 0) {
    return {
      user: text.slice(0, idx).trim(),
      ai: text.slice(idx + wrapped.length).trim(),
    }
  }
  const idx2 = text.indexOf(EXPLANATION_SEPARATOR)
  if (idx2 >= 0) {
    return {
      user: text.slice(0, idx2).trim(),
      ai: text
        .slice(idx2 + EXPLANATION_SEPARATOR.length)
        .replace(/^\n+/, '')
        .trim(),
    }
  }
  return { user: '', ai: text }
}

function composeExplanation(user: string, ai: string): string {
  const u = user.trim()
  const a = ai.trim()
  if (u && a) return `${u}\n${EXPLANATION_SEPARATOR}\n${a}`
  return u || a
}

export function listNotebookSources(notebookId: string): NotebookSourceView[] {
  const list = rows<NotebookSource>(
    getDb()
      .prepare(
        `SELECT * FROM notebook_sources
         WHERE notebook_id = ?
         ORDER BY created_at ASC`,
      )
      .all(notebookId),
  )
  return list.map(hydrateSource)
}

export function getNotebookSource(
  notebookId: string,
  sourceId: string,
): NotebookSourceView | undefined {
  const found = row<NotebookSource>(
    getDb()
      .prepare(
        `SELECT * FROM notebook_sources WHERE id = ? AND notebook_id = ?`,
      )
      .get(sourceId, notebookId),
  )
  return found ? hydrateSource(found) : undefined
}

function insertSource(opts: {
  notebookId: string
  kind: NotebookSourceKind
  vaultPath: string | null
  originalName: string
  payload?: Record<string, unknown>
}): NotebookSourceView {
  const id = randomUUID()
  const now = nowIso()
  getDb()
    .prepare(
      `INSERT INTO notebook_sources (
        id, notebook_id, kind, vault_path, original_name,
        status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      id,
      opts.notebookId,
      opts.kind,
      opts.vaultPath,
      opts.originalName,
      JSON.stringify(opts.payload ?? {}),
      now,
      now,
    )
  getDb()
    .prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`)
    .run(now, opts.notebookId)
  return getNotebookSource(opts.notebookId, id)!
}

function updateSource(
  sourceId: string,
  patch: {
    status?: NotebookSourceStatus
    payload?: Record<string, unknown>
  },
): void {
  const current = row<NotebookSource>(
    getDb().prepare(`SELECT * FROM notebook_sources WHERE id = ?`).get(sourceId),
  )
  if (!current) return
  const payload = patch.payload
    ? { ...parsePayload(current.payload_json), ...patch.payload }
    : parsePayload(current.payload_json)
  getDb()
    .prepare(
      `UPDATE notebook_sources SET
        status = COALESCE(?, status),
        payload_json = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .run(patch.status ?? null, JSON.stringify(payload), nowIso(), sourceId)
}

export function classifySourceFile(
  originalName: string,
  mime = '',
): NotebookSourceKind | null {
  const name = originalName.toLowerCase()
  const ext = path.extname(name)
  const type = mime.toLowerCase()

  if (ext === '.pdf' || type === 'application/pdf') return 'pdf'
  if (
    type.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.gif', '.bmp', '.tif', '.tiff'].includes(
      ext,
    )
  ) {
    return 'image'
  }
  if (
    type.startsWith('audio/') ||
    ['.m4a', '.mp3', '.ogg', '.oga', '.wav', '.flac', '.aac'].includes(ext)
  ) {
    return 'audio'
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || type.includes('spreadsheet') || type === 'text/csv') {
    return ext === '.json' ? 'json' : 'spreadsheet'
  }
  if (ext === '.json' || type === 'application/json') return 'json'
  if (
    type.startsWith('text/') ||
    ['.txt', '.md', '.markdown'].includes(ext)
  ) {
    return 'note'
  }
  return null
}

function sourceDir(notebookId: string, sourceId: string): string {
  return path.join(notebookVaultDir(notebookId), 'sources', sourceId)
}

function copyToVault(
  notebookId: string,
  sourceId: string,
  tmpPath: string,
  originalName: string,
): string {
  const dir = sourceDir(notebookId, sourceId)
  fs.mkdirSync(dir, { recursive: true })
  const safe = path.basename(originalName).replace(/[<>:"|?*]/g, '_') || 'file'
  const dest = path.join(dir, safe)
  fs.copyFileSync(tmpPath, dest)
  return path.posix.join(
    'vault',
    'notebooks',
    notebookId,
    'sources',
    sourceId,
    safe,
  )
}

export function addNotebookSourceFromFile(
  notebookId: string,
  file: { path: string; originalname: string; mimetype?: string },
): NotebookSourceView {
  const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
  const kind = classifySourceFile(originalName, file.mimetype || '')
  if (!kind) {
    const err = new Error(
      `Tipo no soportado: ${originalName}. Usá PDF, imagen, audio, nota, Excel/CSV o JSON.`,
    ) as Error & { status?: number }
    err.status = 400
    throw err
  }
  const id = randomUUID()
  const rel = copyToVault(notebookId, id, file.path, originalName)
  const now = nowIso()
  getDb()
    .prepare(
      `INSERT INTO notebook_sources (
        id, notebook_id, kind, vault_path, original_name,
        status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', '{}', ?, ?)`,
    )
    .run(id, notebookId, kind, rel, originalName, now, now)
  getDb()
    .prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`)
    .run(now, notebookId)
  return getNotebookSource(notebookId, id)!
}

export function addNotebookNoteSource(
  notebookId: string,
  text: string,
  originalName = 'nota.txt',
): NotebookSourceView {
  const trimmed = text.trim()
  if (!trimmed) {
    const err = new Error('La nota está vacía') as Error & { status?: number }
    err.status = 400
    throw err
  }
  return insertSource({
    notebookId,
    kind: 'note',
    vaultPath: null,
    originalName,
    payload: { text: trimmed },
  })
}

export function deleteNotebookSource(
  notebookId: string,
  sourceId: string,
): void {
  const source = getNotebookSource(notebookId, sourceId)
  if (!source) {
    const err = new Error('Fuente no encontrada') as Error & { status?: number }
    err.status = 404
    throw err
  }
  getDb()
    .prepare(`DELETE FROM notebook_sources WHERE id = ? AND notebook_id = ?`)
    .run(sourceId, notebookId)
  const abs = path.join(notebookVaultDir(notebookId), 'sources', sourceId)
  try {
    if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true })
  } catch (err) {
    console.warn('[notebook/sources] vault cleanup:', err)
  }
  getDb()
    .prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`)
    .run(nowIso(), notebookId)
}

const processQueue: string[] = []
let processRunning = false

export function enqueueSourceProcessing(sourceIds: string[]): void {
  for (const id of sourceIds) {
    if (!processQueue.includes(id)) processQueue.push(id)
  }
  void drainSourceQueue()
}

async function drainSourceQueue(): Promise<void> {
  if (processRunning) return
  processRunning = true
  try {
    while (processQueue.length > 0) {
      const id = processQueue.shift()!
      try {
        await processNotebookSource(id)
      } catch (err) {
        console.error('[notebook/sources] process failed', id, err)
        updateSource(id, {
          status: 'error',
          payload: {
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }
  } finally {
    processRunning = false
  }
}

async function processNotebookSource(sourceId: string): Promise<void> {
  const source = row<NotebookSource>(
    getDb().prepare(`SELECT * FROM notebook_sources WHERE id = ?`).get(sourceId),
  )
  if (!source) return
  if (source.status === 'ready') return
  updateSource(sourceId, { status: 'processing' })

  const abs = source.vault_path
    ? path.resolve(process.cwd(), source.vault_path)
    : null

  if (source.kind === 'pdf') {
    if (!abs || !fs.existsSync(abs)) throw new Error('PDF ausente en vault')
    const { ingestNotebookPdf } = await import('./notebookIngest.js')
    const ingest = await ingestNotebookPdf(source.notebook_id, abs)
    updateSource(sourceId, {
      status: 'ready',
      payload: { ingest },
    })
    return
  }

  if (source.kind === 'image') {
    if (!abs || !fs.existsSync(abs)) throw new Error('Imagen ausente en vault')
    const { ingestNotebookImages } = await import('./notebookIngest.js')
    const ingest = await ingestNotebookImages(source.notebook_id, [abs], {
      mode: 'append',
    })
    updateSource(sourceId, {
      status: 'ready',
      payload: { ingest },
    })
    return
  }

  if (source.kind === 'audio') {
    if (!abs || !fs.existsSync(abs)) throw new Error('Audio ausente en vault')
    const result = await transcribeAudio(abs, source.original_name)
    updateSource(sourceId, {
      status: 'ready',
      payload: {
        transcript: result.text,
        stub: result.stub,
        utterances: result.utterances,
      },
    })
    return
  }

  if (source.kind === 'note') {
    const payload = parsePayload(source.payload_json)
    let text = String(payload.text || '')
    if (!text && abs && fs.existsSync(abs)) {
      text = fs.readFileSync(abs, 'utf8')
    }
    const applied = applyNoteToPages(source.notebook_id, text)
    updateSource(sourceId, {
      status: 'ready',
      payload: {
        text,
        annex: applied.slots.length === 0,
        applied_slots: applied.slots,
      },
    })
    return
  }

  if (source.kind === 'spreadsheet' || source.kind === 'json') {
    if (!abs || !fs.existsSync(abs)) throw new Error('Planilla ausente en vault')
    const parsed = await parseOverlayFile(abs, source.kind, source.original_name)
    const applied = applyOverlayRows(source.notebook_id, parsed.rows)
    updateSource(sourceId, {
      status: 'ready',
      payload: {
        rows: parsed.rows,
        annex: parsed.rows.length === 0 || applied.slots.length === 0,
        applied_slots: applied.slots,
        warning: parsed.warning,
      },
    })
    return
  }
}

const PAGE_REF_RE =
  /(?:p[áa]g(?:ina)?\.?|hoja|slot|pág\.?|pag\.?)\s*(\d+)/gi

function applyNoteToPages(
  notebookId: string,
  text: string,
): { slots: number[] } {
  const body = text.trim()
  if (!body) return { slots: [] }

  const sections = splitNoteByPageHeaders(body)
  if (sections.length === 0) {
    return { slots: [] }
  }

  const slots: number[] = []
  for (const section of sections) {
    const page = resolvePageRef(notebookId, section)
    if (!page) continue
    appendPageUserNote(page, section.text)
    slots.push(page.slot_index)
  }
  if (slots.length > 0) rebuildNotebookIndex(getDb(), notebookId)
  return { slots: [...new Set(slots)] }
}

function splitNoteByPageHeaders(
  text: string,
): Array<{ slot?: number; numero_logico?: number; text: string }> {
  const lines = text.split(/\r?\n/)
  const sections: Array<{
    slot?: number
    numero_logico?: number
    lines: string[]
  }> = []
  let current: { slot?: number; numero_logico?: number; lines: string[] } | null =
    null

  const headerOnly = (line: string) => {
    PAGE_REF_RE.lastIndex = 0
    const trimmed = line.trim()
    const m = [...trimmed.matchAll(PAGE_REF_RE)]
    if (m.length === 0) return null
    const rest = trimmed
      .replace(/p[áa]g(?:ina)?\.?|hoja|slot|pág\.?|pag\.?/gi, '')
      .replace(/\s*\d+/g, '')
      .replace(/^[#\-*:\s]+/, '')
      .trim()
    if (rest.length > 80) return null
    const kind = trimmed.toLowerCase()
    const num = Number(m[0][1])
    if (!Number.isFinite(num)) return null
    if (/\bslot\b/i.test(kind)) return { slot: num }
    return { numero_logico: num }
  }

  for (const line of lines) {
    const header = headerOnly(line)
    if (header) {
      if (current) sections.push(current)
      current = { ...header, lines: [] }
      continue
    }
    if (!current) {
      current = { lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  if (current) sections.push(current)

  const withRef = sections.filter(
    (s) => s.slot != null || s.numero_logico != null,
  )
  if (withRef.length === 0) {
    const refs = [...text.matchAll(
      /(?:p[áa]g(?:ina)?\.?|hoja|slot|pág\.?|pag\.?)\s*(\d+)/gi,
    )].map((m) => Number(m[1]))
    if (refs.length === 0) return []
    return refs.map((num) => ({
      numero_logico: num,
      text,
    }))
  }
  return withRef.map((s) => ({
    slot: s.slot,
    numero_logico: s.numero_logico,
    text: s.lines.join('\n').trim() || text,
  }))
}

function resolvePageRef(
  notebookId: string,
  ref: { slot?: number; numero_logico?: number },
): NotebookPage | undefined {
  if (ref.slot != null && Number.isInteger(ref.slot)) {
    return getPage(getDb(), notebookId, ref.slot)
  }
  if (ref.numero_logico != null && Number.isFinite(ref.numero_logico)) {
    const pages = listPages(getDb(), notebookId)
    return pages.find((p) => p.numero_logico === ref.numero_logico)
  }
  return undefined
}

function appendPageUserNote(page: NotebookPage, note: string): void {
  const add = note.trim()
  if (!add) return
  const split = splitExplanation(page.explanation, page.explanation_user)
  if (split.user.includes(add)) return
  const user = split.user ? `${split.user}\n\n${add}` : add
  const composed = composeExplanation(user, split.ai)
  getDb()
    .prepare(
      `UPDATE pages SET explanation = ?, explanation_user = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(composed || null, user, nowIso(), page.id)
}

function applyOverlayRows(
  notebookId: string,
  overlayRows: OverlayRow[],
): { slots: number[] } {
  const slots: number[] = []
  for (const item of overlayRows) {
    const page = resolvePageRef(notebookId, item)
    if (!page) continue
    const now = nowIso()
    if (item.title?.trim()) {
      getDb()
        .prepare(`UPDATE pages SET title = ?, is_blank = 0, updated_at = ? WHERE id = ?`)
        .run(item.title.trim(), now, page.id)
    }
    if (item.notes?.trim()) {
      const fresh = getPage(getDb(), notebookId, page.slot_index)
      if (fresh) appendPageUserNote(fresh, item.notes)
    }
    slots.push(page.slot_index)
  }
  if (slots.length > 0) rebuildNotebookIndex(getDb(), notebookId)
  return { slots: [...new Set(slots)] }
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function rowFromRecord(rec: Record<string, unknown>): OverlayRow | null {
  const keys = Object.keys(rec)
  const get = (...aliases: string[]) => {
    for (const key of keys) {
      const n = normalizeHeader(key)
      if (aliases.includes(n)) return rec[key]
    }
    return undefined
  }
  const slotRaw = get('slot', 'slot_index', 'slotindex')
  const pageRaw = get(
    'page',
    'pagina',
    'pag',
    'hoja',
    'numero_logico',
    'numerologico',
    'nro',
    'n',
  )
  const titleRaw = get('title', 'titulo', 'nombre')
  const notesRaw = get(
    'notes',
    'note',
    'nota',
    'notas',
    'explicacion',
    'explanation',
    'comentario',
  )
  const tagsRaw = get('tags', 'tag', 'etiquetas')

  const slot =
    slotRaw != null && String(slotRaw).trim() !== ''
      ? Number(slotRaw)
      : undefined
  const numero_logico =
    pageRaw != null && String(pageRaw).trim() !== ''
      ? Number(pageRaw)
      : undefined
  const title = titleRaw != null ? String(titleRaw).trim() : ''
  const notes = notesRaw != null ? String(notesRaw).trim() : ''
  let tags: string[] | undefined
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw.map(String)
  } else if (typeof tagsRaw === 'string' && tagsRaw.trim()) {
    tags = tagsRaw.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
  }

  if (
    (slot == null || !Number.isFinite(slot)) &&
    (numero_logico == null || !Number.isFinite(numero_logico))
  ) {
    return null
  }
  if (!title && !notes && !tags?.length) return null
  return {
    slot: slot != null && Number.isFinite(slot) ? slot : undefined,
    numero_logico:
      numero_logico != null && Number.isFinite(numero_logico)
        ? numero_logico
        : undefined,
    title: title || undefined,
    notes: notes || undefined,
    tags,
  }
}

function parseCsv(text: string): string[][] {
  const rowsOut: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rowsOut.push(row)
      row = []
      cell = ''
      continue
    }
    if (ch === '\r') continue
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rowsOut.push(row)
  }
  return rowsOut.filter((r) => r.some((c) => c.trim()))
}

function overlayFromTable(table: string[][]): OverlayRow[] {
  if (table.length < 2) return []
  const headers = table[0].map((h) => h.trim())
  const out: OverlayRow[] = []
  for (const line of table.slice(1)) {
    const rec: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      rec[h || `col_${i}`] = line[i] ?? ''
    })
    const parsed = rowFromRecord(rec)
    if (parsed) out.push(parsed)
  }
  return out
}

function overlayFromJson(raw: unknown): OverlayRow[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).pages ??
          (raw as Record<string, unknown>).rows ??
          (raw as Record<string, unknown>).items)
      : null
  if (!Array.isArray(list)) return []
  const out: OverlayRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const parsed = rowFromRecord(item as Record<string, unknown>)
    if (parsed) out.push(parsed)
  }
  return out
}

async function parseOverlayFile(
  absPath: string,
  kind: 'spreadsheet' | 'json',
  originalName: string,
): Promise<{ rows: OverlayRow[]; warning?: string }> {
  const ext = path.extname(originalName).toLowerCase()
  if (kind === 'json' || ext === '.json') {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8')) as unknown
    const overlayRows = overlayFromJson(raw)
    return {
      rows: overlayRows,
      warning:
        overlayRows.length === 0
          ? 'JSON sin columnas de página/slot reconocibles; queda como anexo'
          : undefined,
    }
  }
  if (ext === '.csv') {
    const overlayRows = overlayFromTable(
      parseCsv(fs.readFileSync(absPath, 'utf8')),
    )
    return {
      rows: overlayRows,
      warning:
        overlayRows.length === 0
          ? 'CSV sin columnas de página/slot reconocibles; queda como anexo'
          : undefined,
    }
  }

  const ExcelJS = require('exceljs') as typeof import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(absPath)
  const sheet = wb.worksheets[0]
  if (!sheet) {
    return { rows: [], warning: 'El Excel no tiene hojas' }
  }
  const table: string[][] = []
  sheet.eachRow((excelRow) => {
    const values = Array.isArray(excelRow.values) ? excelRow.values.slice(1) : []
    table.push(values.map((v) => (v == null ? '' : String(v))))
  })
  const overlayRows = overlayFromTable(table)
  return {
    rows: overlayRows,
    warning:
      overlayRows.length === 0
        ? 'Excel sin columnas de página/slot reconocibles; queda como anexo'
        : undefined,
  }
}

export function collectNotebookExplainContext(
  notebookId: string,
  slotIndex: number,
): string {
  const sources = listNotebookSources(notebookId)
  const page = getPage(getDb(), notebookId, slotIndex)
  const chunks: string[] = []

  const audios = sources.filter(
    (s) => s.kind === 'audio' && s.status === 'ready',
  )
  const transcripts = audios
    .map((s) => String(s.payload.transcript || '').trim())
    .filter(Boolean)
  if (transcripts.length > 0) {
    chunks.push(
      `Audio del operador (STT, cuaderno entero):\n${transcripts.join('\n\n').slice(0, 6000)}`,
    )
  }

  const notes = sources.filter((s) => s.kind === 'note' && s.status === 'ready')
  const annexNotes = notes
    .filter((s) => s.payload.annex === true)
    .map((s) => String(s.payload.text || '').trim())
    .filter(Boolean)
  if (annexNotes.length > 0) {
    chunks.push(`Notas de cuaderno:\n${annexNotes.join('\n\n').slice(0, 3000)}`)
  }

  const overlays = sources.filter(
    (s) =>
      (s.kind === 'spreadsheet' || s.kind === 'json') && s.status === 'ready',
  )
  const overlayBits: string[] = []
  for (const src of overlays) {
    const overlayRows = Array.isArray(src.payload.rows)
      ? (src.payload.rows as OverlayRow[])
      : []
    for (const item of overlayRows) {
      const matchSlot =
        item.slot === slotIndex ||
        (page && item.numero_logico === page.numero_logico)
      if (!matchSlot) continue
      const bit = [item.title, item.notes].filter(Boolean).join(' — ')
      if (bit) overlayBits.push(bit)
    }
    if (src.payload.annex === true && overlayRows.length === 0) {
      overlayBits.push(`Anexo ${src.original_name}`)
    }
  }
  if (overlayBits.length > 0) {
    chunks.push(`Planilla de esta hoja:\n${overlayBits.join('\n').slice(0, 2000)}`)
  }

  return chunks.join('\n\n').trim()
}
