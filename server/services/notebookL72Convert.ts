/**
 * Convertidor L72: segundo reproceso de un cuaderno completo.
 * Usa quántomos por hoja (source_kind=notebook) como referencia y genera
 * exactamente 72 átomos (source_kind=notebook_l72), uno por poder.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type { Notebook, NotebookPage } from '../types.js'
import { distillNotebookL72Domain } from './cohere.js'
import {
  L72_BLOCK,
  L72_CELLS,
  L72_DOMAINS,
  l72PowerLabel,
} from './lattice72.js'
import { listPages } from './notebookPages.js'
import { promoteToPre, sealQuantomo } from './quantomoStages.js'

export type NotebookL72ConvertResult = {
  notebook_id: string
  sealed: number
  replaced: number
  quantomo_ids: string[]
}

function requireCompleteNotebook(notebookId: string): Notebook {
  const nb = row<Notebook>(
    getDb().prepare(`SELECT * FROM notebooks WHERE id = ?`).get(notebookId),
  )
  if (!nb) {
    const err = new Error('Cuaderno no encontrado') as Error & { status?: number }
    err.status = 404
    throw err
  }
  if (nb.kind === 'system') {
    const err = new Error('Trinchera no admite convertidor L72') as Error & {
      status?: number
    }
    err.status = 400
    throw err
  }
  if (nb.index_status !== 'completo') {
    const err = new Error(
      'El cuaderno debe estar completo (todas las hojas con contenido en corpus)',
    ) as Error & { status?: number }
    err.status = 400
    throw err
  }
  return nb
}

function deletePriorL72Pack(notebookId: string): number {
  const db = getDb()
  const prior = rows<{ id: string; entry_id: string }>(
    db
      .prepare(
        `SELECT id, entry_id FROM quantomos
         WHERE source_kind = 'notebook_l72' AND source_id = ?`,
      )
      .all(notebookId),
  )
  if (prior.length === 0) return 0

  db.exec('BEGIN')
  try {
    for (const q of prior) {
      db.prepare(
        `DELETE FROM embeddings WHERE object_type = 'quantomo' AND object_id = ?`,
      ).run(q.id)
      db.prepare(`DELETE FROM quantomo_lattices WHERE quantomo_id = ?`).run(q.id)
      db.prepare(`DELETE FROM quantomos WHERE id = ?`).run(q.id)
      db.prepare(
        `DELETE FROM embeddings WHERE object_type = 'entry' AND object_id = ?`,
      ).run(q.entry_id)
      db.prepare(`DELETE FROM entry_entities_raw WHERE entry_id = ?`).run(
        q.entry_id,
      )
      db.prepare(`DELETE FROM entity_proposals WHERE entry_id = ?`).run(
        q.entry_id,
      )
      db.prepare(`DELETE FROM entity_links WHERE entry_id = ?`).run(q.entry_id)
      db.prepare(`DELETE FROM entries WHERE id = ?`).run(q.entry_id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return prior.length
}

function collectPageContext(pages: NotebookPage[]): {
  pageContext: string
  pageQuantomoRefs: Array<{ id: string; title: string; excerpt: string }>
  pageQuantomoIds: string[]
  avgWeight: number
} {
  const db = getDb()
  const processed = pages.filter((p) => p.status === 'Procesada')
  const chunks: string[] = []
  const refs: Array<{ id: string; title: string; excerpt: string }> = []
  const ids: string[] = []
  let weightSum = 0
  let weightN = 0

  for (const p of processed) {
    const excerpt = [
      p.title ? `Título: ${p.title}` : '',
      p.transcription_spatial
        ? `Transcripción: ${p.transcription_spatial.slice(0, 800)}`
        : '',
      p.explanation ? `Explicación: ${p.explanation.slice(0, 600)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    chunks.push(
      `--- Hoja ${p.numero_logico} (${p.posicion_visual}) slot ${p.slot_index} ---\n${excerpt}`,
    )

    if (p.quantomo_id) {
      const q = row<{
        id: string
        title: string
        content: string | null
        hermetic_weight: number | null
        source_kind: string | null
      }>(
        db
          .prepare(
            `SELECT id, title, content, hermetic_weight, source_kind
             FROM quantomos WHERE id = ?`,
          )
          .get(p.quantomo_id),
      )
      if (q) {
        ids.push(q.id)
        refs.push({
          id: q.id,
          title: q.title,
          excerpt: (q.content || '').slice(0, 400),
        })
        if (typeof q.hermetic_weight === 'number') {
          weightSum += q.hermetic_weight
          weightN += 1
        }
        if (!q.source_kind) {
          db.prepare(
            `UPDATE quantomos SET source_kind = 'notebook', source_id = ?,
             profile_json = ?
             WHERE id = ?`,
          ).run(
            p.notebook_id,
            JSON.stringify({
              layer: 'page',
              slot_index: p.slot_index,
            }),
            q.id,
          )
        }
      }
    }
  }

  return {
    pageContext: chunks.join('\n\n'),
    pageQuantomoRefs: refs,
    pageQuantomoIds: ids,
    avgWeight: weightN > 0 ? Math.round(weightSum / weightN) : 8,
  }
}

export async function convertNotebookToL72(
  notebookId: string,
): Promise<NotebookL72ConvertResult> {
  const nb = requireCompleteNotebook(notebookId)
  const pages = listPages(getDb(), notebookId)
  const ctx = collectPageContext(pages)

  if (ctx.pageQuantomoIds.length === 0) {
    const err = new Error(
      'No hay quántomos por hoja: enviá las páginas al corpus primero',
    ) as Error & { status?: number }
    err.status = 400
    throw err
  }

  const replaced = deletePriorL72Pack(notebookId)
  const drafts: Awaited<ReturnType<typeof distillNotebookL72Domain>> = []

  for (let domainIndex = 0; domainIndex < L72_DOMAINS; domainIndex++) {
    const powerSlots = Array.from({ length: L72_BLOCK }, (_, oficio) => {
      const power_index = domainIndex * L72_BLOCK + oficio
      const label = l72PowerLabel(power_index)
      return {
        power_index,
        visible: label.visible,
        oficio: label.oficio,
      }
    })
    const domainLabel = l72PowerLabel(domainIndex * L72_BLOCK).domain
    const atoms = await distillNotebookL72Domain({
      notebookTitle: nb.title,
      domainIndex,
      domainLabel,
      powerSlots,
      pageContext: ctx.pageContext,
      pageQuantomoRefs: ctx.pageQuantomoRefs,
    })
    drafts.push(...atoms)
  }

  if (drafts.length !== L72_CELLS) {
    throw new Error(`Se esperaban ${L72_CELLS} átomos, salieron ${drafts.length}`)
  }

  const db = getDb()
  const now = new Date().toISOString()
  const createdIds: string[] = []
  const defaultWeight = Math.max(7, Math.min(10, ctx.avgWeight || 8))

  db.exec('BEGIN')
  try {
    for (const draft of drafts) {
      const entryId = randomUUID()
      const quantomoId = randomUUID()
      const power = l72PowerLabel(draft.power_index)
      const title = draft.title.trim() || `${power.visible} ${power.domain}`
      const content = draft.content.trim() || title
      const weight = Math.max(
        7,
        Math.min(10, Math.round(draft.weight || defaultWeight)),
      )
      const pageRefs = (draft.page_refs || []).filter((id) =>
        ctx.pageQuantomoIds.includes(id),
      )
      const profile = JSON.stringify({
        layer: 'l72',
        power_index: power.index,
        power_visible: power.visible,
        domain: power.domain,
        oficio: power.oficio,
        page_quantomo_ids:
          pageRefs.length > 0 ? pageRefs : ctx.pageQuantomoIds.slice(0, 8),
      })

      db.prepare(
        `INSERT INTO entries (
          id, notebook_id, source_type, title, content_raw, vault_path,
          timestamp_exact, status, created_at, title_manual, original_filename,
          human_weight
        ) VALUES (?, ?, 'notebook_l72', ?, ?, NULL, ?, 'approved', ?, 1, ?, ?)`,
      ).run(
        entryId,
        notebookId,
        title,
        content,
        now,
        now,
        `l72-${power.visible}`,
        weight,
      )

      db.prepare(
        `INSERT INTO quantomos (
          id, entry_id, title, content, hermetic_weight, universe, recognized,
          human_weight, suggested_weight, stage, source_kind, source_id,
          profile_json, generation
        ) VALUES (?, ?, ?, ?, ?, 'cuaderno', 0, ?, ?, 'proto', 'notebook_l72', ?, ?, 0)`,
      ).run(
        quantomoId,
        entryId,
        title,
        content,
        weight,
        weight,
        weight,
        notebookId,
        profile,
      )

      createdIds.push(quantomoId)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  let sealed = 0
  for (const qid of createdIds) {
    promoteToPre(qid)
    sealQuantomo(qid)
    sealed += 1
  }

  getDb()
    .prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), notebookId)

  return {
    notebook_id: notebookId,
    sealed,
    replaced,
    quantomo_ids: createdIds,
  }
}
