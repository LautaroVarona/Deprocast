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

function slugify(raw: string): string {
  const s = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'cuaderno'
}

function pageFolderName(page: NotebookPage): string {
  const visual = mapVisualSlot(page.slot_index)
  const label = labelForSlot(visual)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${String(page.slot_index).padStart(3, '0')}_${label || 'hoja'}`
}

function pageHasExportContent(page: NotebookPage): boolean {
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

function exportFilename(notebook: Notebook): string {
  const day = new Date().toISOString().slice(0, 10)
  return `cuaderno-${slugify(notebook.title)}-${day}.zip`
}

export function streamNotebookExportZip(
  notebook: Notebook,
  res: Response,
): void {
  const db = getDb()
  const pages = listPages(db, notebook.id).filter(pageHasExportContent)

  const statusCounts = {
    Vacia: 0,
    PendienteVision: 0,
    PendienteValidacion: 0,
    Validada: 0,
    Procesada: 0,
  }
  for (const p of listPages(db, notebook.id)) {
    if (p.status in statusCounts) {
      statusCounts[p.status as keyof typeof statusCounts]++
    }
  }

  const filename = exportFilename(notebook)
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
    notebook: {
      id: notebook.id,
      title: notebook.title,
      kind: notebook.kind,
      cover_url: notebook.cover_url,
      index_status: notebook.index_status,
      created_at: notebook.created_at,
      updated_at: notebook.updated_at,
    },
    summary: {
      pages_exported: pages.length,
      status_counts: statusCounts,
    },
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

  for (const page of pages) {
    const folder = `pages/${pageFolderName(page)}`
    const visual = mapVisualSlot(page.slot_index)
    const split = splitExplanation(page.explanation, page.explanation_user)
    const mentioned = parseMentionedEntities(page.mentioned_entities)
    const graphics = safeParseJson<unknown[]>(page.graphic_elements, [])

    let corpus: {
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
    } | null = null

    if (page.entry_id || page.quantomo_id) {
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

      corpus = {
        entry: entry ?? undefined,
        quantomo: quantomo ?? undefined,
        entities_raw: entitiesRaw,
        entity_links: entityLinks,
      }
    }

    const pageJson = {
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
      corpus,
    }

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
