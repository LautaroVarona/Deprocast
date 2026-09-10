import type { Response } from 'express'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type { Notebook, NotebookPage } from '../types.js'
import { labelForSlot, mapVisualSlot } from './notebookLayout.js'
import { listPages } from './notebookPages.js'
import { parseMentionedEntities, splitExplanation } from './notebookProcess.js'

const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')

export type NotebookExportFormat = 'zip' | 'json'

type PageCorpus = {
  entry?: {
    id: string
    title: string
    content_raw: string | null
    status: string
    source_type: string
  }
  quantomo?: {
    id: string
    title: string
    content: string | null
    universe: string | null
    hermetic_weight: number | null
    recognized: number | null
  }
  entities_raw?: Array<{
    id: string
    name: string
    type: string
    payload: unknown
  }>
  entity_links?: Array<{
    id: string
    entity_kind: string
    entity_id: string
    role: string
    entity_name?: string | null
  }>
} | null

export type NotebookExportImage = {
  mime: string
  encoding: 'base64'
  data: string
}

export type NotebookExportPage = {
  slot_index: number
  numero_logico: number
  posicion_visual: string
  label: string
  status: string
  title: string | null
  transcription_spatial: string | null
  explanation: string | null
  explanation_user: string | null
  explanation_ai: string | null
  explanation_weight: number | null
  graphic_elements: unknown
  mentioned_entities: unknown
  is_blank: number
  entry_id: string | null
  quantomo_id: string | null
  vision_meta: unknown
  created_at: string
  updated_at: string
  corpus: PageCorpus
  image?: NotebookExportImage | null
}

function slugify(raw: string): string {
  const s = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'cuaderno'
}

export function pageFolderName(page: Pick<NotebookPage, 'slot_index'>): string {
  const visual = mapVisualSlot(page.slot_index)
  const label = labelForSlot(visual)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${String(page.slot_index).padStart(3, '0')}_${label || 'hoja'}`
}

export function pageHasExportContent(
  page: Pick<
    NotebookPage,
    | 'image_path'
    | 'title'
    | 'transcription_spatial'
    | 'explanation'
    | 'entry_id'
    | 'quantomo_id'
  >,
): boolean {
  if (page.image_path) return true
  if (page.title?.trim()) return true
  if (page.transcription_spatial?.trim()) return true
  if (page.explanation?.trim()) return true
  if (page.entry_id || page.quantomo_id) return true
  return false
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function notebookExportBasename(notebook: Pick<Notebook, 'title'>): string {
  const day = new Date().toISOString().slice(0, 10)
  return `cuaderno-${slugify(notebook.title)}-${day}`
}

function mimeForImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

export function readExportImage(
  imagePath: string | null | undefined,
): NotebookExportImage | null {
  if (!imagePath) return null
  const abs = path.resolve(process.cwd(), imagePath)
  if (!fs.existsSync(abs)) return null
  const data = fs.readFileSync(abs).toString('base64')
  return { mime: mimeForImagePath(abs), encoding: 'base64', data }
}

function statusCountsFor(pages: NotebookPage[]) {
  const statusCounts = {
    Vacia: 0,
    PendienteVision: 0,
    PendienteValidacion: 0,
    Validada: 0,
    Procesada: 0,
  }
  for (const p of pages) {
    if (p.status in statusCounts) {
      statusCounts[p.status as keyof typeof statusCounts]++
    }
  }
  return statusCounts
}

function loadPageCorpus(
  db: ReturnType<typeof getDb>,
  page: NotebookPage,
): PageCorpus {
  if (!page.entry_id && !page.quantomo_id) return null

  const entry = page.entry_id
    ? row<{
        id: string
        title: string
        content_raw: string | null
        status: string
        source_type: string
      }>(
        db
          .prepare(
            `SELECT id, title, content_raw, status, source_type
             FROM entries WHERE id = ?`,
          )
          .get(page.entry_id),
      )
    : null
  const quantomo = page.quantomo_id
    ? row<{
        id: string
        title: string
        content: string | null
        universe: string | null
        hermetic_weight: number | null
        recognized: number | null
      }>(
        db
          .prepare(
            `SELECT id, title, content, universe, hermetic_weight, recognized
             FROM quantomos WHERE id = ?`,
          )
          .get(page.quantomo_id),
      )
    : null

  const entitiesRaw = page.entry_id
    ? rows<{
        id: string
        name: string
        type: string
        payload: string
      }>(
        db
          .prepare(
            `SELECT id, name, type, payload FROM entry_entities_raw
             WHERE entry_id = ? ORDER BY rowid ASC`,
          )
          .all(page.entry_id),
      ).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        payload: safeParseJson(e.payload, {}),
      }))
    : []

  const links = page.entry_id
    ? rows<{
        id: string
        entity_kind: string
        entity_id: string
        role: string
      }>(
        db
          .prepare(
            `SELECT id, entity_kind, entity_id, role
             FROM entity_links WHERE entry_id = ?`,
          )
          .all(page.entry_id),
      )
    : []

  const entityLinks = links.map((l) => {
    let entity_name: string | null = null
    if (l.entity_kind === 'person') {
      entity_name =
        row<{ name: string }>(
          db.prepare(`SELECT name FROM persons WHERE id = ?`).get(l.entity_id),
        )?.name ?? null
    } else if (l.entity_kind === 'project') {
      entity_name =
        row<{ title: string }>(
          db
            .prepare(`SELECT title FROM projects WHERE id = ?`)
            .get(l.entity_id),
        )?.title ?? null
    } else if (l.entity_kind === 'agrupacion') {
      entity_name =
        row<{ name: string }>(
          db
            .prepare(`SELECT name FROM agrupaciones WHERE id = ?`)
            .get(l.entity_id),
        )?.name ?? null
    }
    return {
      id: l.id,
      entity_kind: l.entity_kind,
      entity_id: l.entity_id,
      role: l.role,
      entity_name,
    }
  })

  return {
    entry: entry ?? undefined,
    quantomo: quantomo ?? undefined,
    entities_raw: entitiesRaw,
    entity_links: entityLinks,
  }
}

export function buildPageExportRecord(
  db: ReturnType<typeof getDb>,
  page: NotebookPage,
  opts: { includeImage?: boolean } = {},
): NotebookExportPage {
  const visual = mapVisualSlot(page.slot_index)
  const split = splitExplanation(page.explanation, page.explanation_user)
  const mentioned = parseMentionedEntities(page.mentioned_entities)
  const graphics = safeParseJson<unknown[]>(page.graphic_elements, [])
  const record: NotebookExportPage = {
    slot_index: page.slot_index,
    numero_logico: page.numero_logico,
    posicion_visual: page.posicion_visual,
    label: labelForSlot(visual),
    status: page.status,
    title: page.title,
    transcription_spatial: page.transcription_spatial,
    explanation: page.explanation,
    explanation_user: split.user || page.explanation_user,
    explanation_ai: split.ai || null,
    explanation_weight: page.explanation_weight ?? null,
    graphic_elements: graphics,
    mentioned_entities: mentioned,
    is_blank: page.is_blank,
    entry_id: page.entry_id,
    quantomo_id: page.quantomo_id,
    vision_meta: safeParseJson(page.vision_meta, null),
    created_at: page.created_at,
    updated_at: page.updated_at,
    corpus: loadPageCorpus(db, page),
  }
  if (opts.includeImage) {
    record.image = readExportImage(page.image_path)
  }
  return record
}

function notebookMeta(notebook: Notebook) {
  return {
    id: notebook.id,
    title: notebook.title,
    kind: notebook.kind,
    cover_url: notebook.cover_url,
    index_status: notebook.index_status,
    created_at: notebook.created_at,
    updated_at: notebook.updated_at,
  }
}

export function streamNotebookExportZip(
  notebook: Notebook,
  res: Response,
): void {
  const db = getDb()
  const allPages = listPages(db, notebook.id)
  const pages = allPages.filter(pageHasExportContent)

  const filename = `${notebookExportBasename(notebook)}.zip`
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  )

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('error', (err) => {
    console.error('[notebook/export]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Error al exportar' })
    } else {
      res.end()
    }
  })
  archive.pipe(res)

  const manifest = {
    exported_at: new Date().toISOString(),
    source: 'deprocast-biblioteca',
    format: 'zip' as const,
    notebook: notebookMeta(notebook),
    summary: {
      pages_exported: pages.length,
      status_counts: statusCountsFor(allPages),
    },
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

  for (const page of pages) {
    const folder = `pages/${pageFolderName(page)}`
    const pageJson = buildPageExportRecord(db, page)
    archive.append(JSON.stringify(pageJson, null, 2), {
      name: `${folder}/page.json`,
    })

    if (page.image_path) {
      const abs = path.resolve(process.cwd(), page.image_path)
      if (fs.existsSync(abs)) {
        archive.file(abs, { name: `${folder}/image.png` })
      }
    }
  }

  void archive.finalize()
}

export function assembleNotebookJsonDocument(
  header: Record<string, unknown>,
  pages: NotebookExportPage[],
): string {
  const prelude = JSON.stringify(header, null, 2)
  const chunks = [`${prelude.slice(0, -2)},\n  "pages": [\n`]
  for (let i = 0; i < pages.length; i++) {
    const body = JSON.stringify(pages[i], null, 2)
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
    chunks.push(body)
    chunks.push(i < pages.length - 1 ? ',\n' : '\n')
  }
  chunks.push('  ]\n}\n')
  return chunks.join('')
}

export function streamNotebookExportJson(
  notebook: Notebook,
  res: Response,
): void {
  const db = getDb()
  const allPages = listPages(db, notebook.id)
  const pages = allPages.filter(pageHasExportContent)
  const filename = `${notebookExportBasename(notebook)}.json`

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  )

  const header = {
    exported_at: new Date().toISOString(),
    source: 'deprocast-biblioteca',
    format: 'json' as const,
    notebook: notebookMeta(notebook),
    summary: {
      pages_exported: pages.length,
      status_counts: statusCountsFor(allPages),
    },
  }
  const records: NotebookExportPage[] = []
  for (const page of pages) {
    records.push(buildPageExportRecord(db, page, { includeImage: true }))
  }
  res.end(assembleNotebookJsonDocument(header, records))
}
