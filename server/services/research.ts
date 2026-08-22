import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import type {
  DeproResearchFinding,
  DeproResearchFindingStatus,
  DeproResearchOrigin,
  DeproResearchPack,
  DeproResearchPackStatus,
} from '../types.js'
import { createIda, shouldEmbedIda } from './deprocast.js'
import { embedIdaItem, enqueueEmbed } from './embeddings.js'
import {
  researchWithPerplexity,
  type PerplexityCitation,
} from './perplexity.js'

const PACK_STATUSES: DeproResearchPackStatus[] = [
  'running',
  'ready',
  'error',
  'closed',
]

const MAX_FINDINGS = 36
const runningJobs = new Set<string>()

type MatrixNode = {
  title: string
  body: string
  url: string | null
  axis_index: number
  node_index: number
  axis_title: string
  sort_index: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function parsePack(raw: Record<string, unknown>): DeproResearchPack {
  let citations: unknown[] = []
  try {
    citations = JSON.parse(String(raw.raw_citations ?? '[]')) as unknown[]
  } catch {
    citations = []
  }
  const originRaw = String(raw.origin ?? 'manual')
  const origin: DeproResearchOrigin =
    originRaw === 'api' ? 'api' : 'manual'
  return {
    id: String(raw.id),
    topic: String(raw.topic),
    agent_id: String(raw.agent_id),
    prompt_key: String(raw.prompt_key ?? raw.agent_id),
    status: raw.status as DeproResearchPackStatus,
    origin,
    parent_finding_id:
      raw.parent_finding_id != null ? String(raw.parent_finding_id) : null,
    parent_pack_id:
      raw.parent_pack_id != null ? String(raw.parent_pack_id) : null,
    raw_content: String(raw.raw_content ?? ''),
    raw_citations: citations,
    error_message:
      raw.error_message != null ? String(raw.error_message) : null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  }
}

function parseFinding(raw: Record<string, unknown>): DeproResearchFinding {
  const axis =
    raw.axis_index == null || raw.axis_index === ''
      ? null
      : Number(raw.axis_index)
  const node =
    raw.node_index == null || raw.node_index === ''
      ? null
      : Number(raw.node_index)
  return {
    id: String(raw.id),
    pack_id: String(raw.pack_id),
    sort_index: Number(raw.sort_index) || 0,
    axis_index: Number.isFinite(axis as number) ? (axis as number) : null,
    node_index: Number.isFinite(node as number) ? (node as number) : null,
    axis_title:
      raw.axis_title != null && String(raw.axis_title)
        ? String(raw.axis_title)
        : null,
    title: String(raw.title),
    body: String(raw.body ?? ''),
    url: raw.url != null && String(raw.url) ? String(raw.url) : null,
    status: raw.status as DeproResearchFindingStatus,
    assimilated_ida_id:
      raw.assimilated_ida_id != null
        ? String(raw.assimilated_ida_id)
        : null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  }
}

export function listResearchPacks(opts?: {
  status?: string
}): DeproResearchPack[] {
  const db = getDb()
  const status = opts?.status?.trim()
  if (status && PACK_STATUSES.includes(status as DeproResearchPackStatus)) {
    return rows(
      db
        .prepare(
          `SELECT * FROM depro_research_packs
           WHERE status = ?
           ORDER BY updated_at DESC`,
        )
        .all(status),
    ).map((r) => parsePack(r as Record<string, unknown>))
  }
  return rows(
    db
      .prepare(
        `SELECT * FROM depro_research_packs ORDER BY updated_at DESC`,
      )
      .all(),
  ).map((r) => parsePack(r as Record<string, unknown>))
}

export function getResearchPack(id: string): DeproResearchPack | null {
  const raw = row(
    getDb().prepare(`SELECT * FROM depro_research_packs WHERE id = ?`).get(id),
  )
  return raw ? parsePack(raw as Record<string, unknown>) : null
}

export function listFindingsForPack(packId: string): DeproResearchFinding[] {
  return rows(
    getDb()
      .prepare(
        `SELECT * FROM depro_research_findings
         WHERE pack_id = ?
         ORDER BY
           CASE WHEN axis_index IS NULL THEN 1 ELSE 0 END,
           axis_index ASC,
           node_index ASC,
           sort_index ASC,
           created_at ASC`,
      )
      .all(packId),
  ).map((r) => parseFinding(r as Record<string, unknown>))
}

export function getResearchPackDetail(id: string): {
  pack: DeproResearchPack
  findings: DeproResearchFinding[]
} | null {
  const pack = getResearchPack(id)
  if (!pack) return null
  return { pack, findings: listFindingsForPack(id) }
}

export function getFinding(id: string): DeproResearchFinding | null {
  const raw = row(
    getDb()
      .prepare(`SELECT * FROM depro_research_findings WHERE id = ?`)
      .get(id),
  )
  return raw ? parseFinding(raw as Record<string, unknown>) : null
}

/** Prompt estricto 6×6 para copiar a Perplexity (modo manual). */
export function buildResearchPrompt(topicInput: unknown): {
  topic: string
  prompt: string
} {
  const topic = String(topicInput ?? '').trim()
  if (!topic) throw new Error('Tema requerido')

  const prompt = `Actúa como un agente de investigación estructurada. Tu objetivo es investigar a fondo sobre: ${topic}.
Debes devolver el resultado ESTRICTAMENTE en un bloque de código JSON, sin texto antes ni después. No uses markdown fuera del bloque de código.
REGLAS DE ESTRUCTURA:
1. La respuesta debe tener exactamente 6 'ejes' (temas principales).
2. Cada 'eje' debe contener exactamente 6 'nodos' (datos clave, conceptos o hitos).
3. Dado que no usaremos la API, DEBES incluir la URL real de la fuente principal de donde extrajiste el dato directamente dentro del campo 'url' de cada nodo.

Utiliza exactamente esta estructura JSON:
\`\`\`json
{
  "topic": ${JSON.stringify(topic)},
  "axes": [
    {
      "title": "Nombre del Eje",
      "summary": "Breve resumen del eje",
      "nodes": [
        {
          "title": "Concepto clave",
          "body": "Explicación detallada del nodo",
          "url": "https://enlace-a-la-fuente.com"
        }
      ]
    }
  ]
}
\`\`\`

Asegúrate de que haya 6 objetos en 'axes', y 6 objetos dentro del array 'nodes' de cada eje. El JSON debe ser válido.`

  return { topic, prompt }
}

export function extractJsonPayload(raw: string): unknown {
  const text = String(raw ?? '').trim()
  if (!text) throw new Error('Payload vacío')

  try {
    return JSON.parse(text)
  } catch {
    /* try fenced block */
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      /* fall through */
    }
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      /* fall through */
    }
  }

  throw new Error('No se pudo parsear JSON del payload')
}

function normalizeMatrixPayload(data: unknown): {
  topic: string
  nodes: MatrixNode[]
} {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON inválido: se esperaba un objeto')
  }
  const root = data as Record<string, unknown>
  const topic = String(root.topic ?? '').trim()
  if (!topic) throw new Error('JSON sin topic')

  const axes = root.axes
  if (!Array.isArray(axes) || axes.length === 0) {
    throw new Error('JSON sin axes')
  }

  const nodes: MatrixNode[] = []
  axes.slice(0, 6).forEach((axisRaw, axisIndex) => {
    if (!axisRaw || typeof axisRaw !== 'object') return
    const axis = axisRaw as Record<string, unknown>
    const axisTitle = String(axis.title ?? `Eje ${axisIndex + 1}`).trim()
    const axisNodes = Array.isArray(axis.nodes) ? axis.nodes : []
    axisNodes.slice(0, 6).forEach((nodeRaw, nodeIndex) => {
      if (!nodeRaw || typeof nodeRaw !== 'object') return
      const n = nodeRaw as Record<string, unknown>
      const title = String(n.title ?? '').trim()
      if (!title) return
      const urlRaw = String(n.url ?? '').trim()
      nodes.push({
        title: title.slice(0, 200),
        body: String(n.body ?? axis.summary ?? '').trim(),
        url: urlRaw || null,
        axis_index: axisIndex,
        node_index: nodeIndex,
        axis_title: axisTitle.slice(0, 200),
        sort_index: axisIndex * 6 + nodeIndex,
      })
    })
  })

  if (nodes.length === 0) {
    throw new Error('JSON sin nodos utilizables')
  }

  return { topic, nodes: nodes.slice(0, MAX_FINDINGS) }
}

function insertMatrixFindings(
  packId: string,
  items: MatrixNode[],
  at: string,
): void {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO depro_research_findings (
      id, pack_id, sort_index, axis_index, node_index, axis_title,
      title, body, url, status, assimilated_ida_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
  )
  for (const item of items) {
    stmt.run(
      randomUUID(),
      packId,
      item.sort_index,
      item.axis_index,
      item.node_index,
      item.axis_title,
      item.title,
      item.body,
      item.url,
      at,
      at,
    )
  }
}

function insertFlatFindings(
  packId: string,
  items: Array<{ title: string; body: string; url: string | null }>,
  at: string,
): void {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO depro_research_findings (
      id, pack_id, sort_index, axis_index, node_index, axis_title,
      title, body, url, status, assimilated_ida_id, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 'pending', NULL, ?, ?)`,
  )
  items.forEach((item, i) => {
    stmt.run(
      randomUUID(),
      packId,
      i,
      item.title,
      item.body,
      item.url,
      at,
      at,
    )
  })
}

function touchPack(
  id: string,
  patch: {
    status?: DeproResearchPackStatus
    raw_content?: string
    raw_citations?: unknown
    error_message?: string | null
  },
): void {
  const at = nowIso()
  const cur = getResearchPack(id)
  if (!cur) return
  getDb()
    .prepare(
      `UPDATE depro_research_packs SET
        status = ?,
        raw_content = ?,
        raw_citations = ?,
        error_message = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? cur.status,
      patch.raw_content !== undefined ? patch.raw_content : cur.raw_content,
      patch.raw_citations !== undefined
        ? JSON.stringify(patch.raw_citations)
        : JSON.stringify(cur.raw_citations),
      patch.error_message !== undefined
        ? patch.error_message
        : cur.error_message,
      at,
      id,
    )
}

/** Inyecta JSON pegado desde Perplexity (origen manual). */
export function ingestResearchJson(input: {
  payload?: unknown
  agent_id?: unknown
  prompt_key?: unknown
  parent_finding_id?: unknown
  parent_pack_id?: unknown
}): { pack: DeproResearchPack; findings: DeproResearchFinding[] } {
  const rawText =
    typeof input.payload === 'string'
      ? input.payload
      : JSON.stringify(input.payload ?? '')
  const parsed = extractJsonPayload(rawText)
  const { topic, nodes } = normalizeMatrixPayload(parsed)

  const agentId = String(input.agent_id ?? 'explorador').trim() || 'explorador'
  const promptKey =
    String(input.prompt_key ?? agentId).trim() || agentId
  const parentFindingId = input.parent_finding_id
    ? String(input.parent_finding_id)
    : null
  const parentPackId = input.parent_pack_id
    ? String(input.parent_pack_id)
    : null

  const at = nowIso()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO depro_research_packs (
        id, topic, agent_id, prompt_key, status, origin,
        parent_finding_id, parent_pack_id,
        raw_content, raw_citations, error_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ready', 'manual', ?, ?, ?, '[]', NULL, ?, ?)`,
    )
    .run(
      id,
      topic,
      agentId,
      promptKey,
      parentFindingId,
      parentPackId,
      rawText.trim(),
      at,
      at,
    )

  insertMatrixFindings(id, nodes, at)

  const detail = getResearchPackDetail(id)
  if (!detail) throw new Error('No se pudo leer el pack ingestado')
  return detail
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url.slice(0, 80)
  }
}

function titleFromBlock(block: string, fallback: string): string {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l))
  if (heading) return heading.replace(/^#{1,6}\s+/, '').slice(0, 160)
  const bullet = lines.find((l) => /^[-*•]\s+/.test(l))
  if (bullet) return bullet.replace(/^[-*•]\s+/, '').slice(0, 160)
  const first = lines[0] ?? fallback
  return first.slice(0, 160)
}

/** Parte prosa/markdown en hallazgos locales (tope MAX_FINDINGS). API path. */
export function chunkResearchContent(
  content: string,
  citations: PerplexityCitation[],
): Array<{ title: string; body: string; url: string | null }> {
  const text = content.trim()
  const findings: Array<{ title: string; body: string; url: string | null }> =
    []

  if (text) {
    let blocks = text
      .split(/\n(?=#{1,3}\s)/)
      .map((b) => b.trim())
      .filter(Boolean)

    if (blocks.length <= 1) {
      blocks = text
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter((b) => b.length > 40)
    }

    if (blocks.length === 0 && text) blocks = [text]

    for (const block of blocks) {
      if (findings.length >= MAX_FINDINGS) break
      findings.push({
        title: titleFromBlock(block, 'Hallazgo'),
        body: block,
        url: null,
      })
    }
  }

  for (const c of citations) {
    if (findings.length >= MAX_FINDINGS) break
    const url = c.url?.trim()
    if (!url) continue
    findings.push({
      title: (c.title?.trim() || hostFromUrl(url)).slice(0, 160),
      body: (c.snippet?.trim() || `Fuente: ${url}`).slice(0, 4000),
      url,
    })
  }

  if (findings.length === 0) {
    findings.push({
      title: 'Sin contenido',
      body: 'La investigación no produjo texto utilizable.',
      url: null,
    })
  }

  return findings.slice(0, MAX_FINDINGS)
}

async function executePackJob(packId: string): Promise<void> {
  if (runningJobs.has(packId)) return
  runningJobs.add(packId)
  try {
    const pack = getResearchPack(packId)
    if (!pack || pack.status !== 'running') return

    const result = await researchWithPerplexity({
      topic: pack.topic,
      agentId: pack.agent_id,
      promptKey: pack.prompt_key,
    })
    const chunks = chunkResearchContent(result.content, result.citations)
    const at = nowIso()
    insertFlatFindings(packId, chunks, at)
    touchPack(packId, {
      status: 'ready',
      raw_content: result.content,
      raw_citations: result.citations,
      error_message: null,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error en investigación'
    touchPack(packId, { status: 'error', error_message: message })
  } finally {
    runningJobs.delete(packId)
  }
}

/** Camino API (futuro). V1 preferido: generate prompt + ingest JSON. */
export function startResearchRun(input: {
  topic?: unknown
  agent_id?: unknown
  prompt_key?: unknown
  parent_finding_id?: string | null
  parent_pack_id?: string | null
}): DeproResearchPack {
  const topic = String(input.topic ?? '').trim()
  if (!topic) throw new Error('Tema requerido')
  const agentId = String(input.agent_id ?? 'explorador').trim() || 'explorador'
  const promptKey =
    String(input.prompt_key ?? agentId).trim() || agentId
  const at = nowIso()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO depro_research_packs (
        id, topic, agent_id, prompt_key, status, origin,
        parent_finding_id, parent_pack_id,
        raw_content, raw_citations, error_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', 'api', ?, ?, '', '[]', NULL, ?, ?)`,
    )
    .run(
      id,
      topic,
      agentId,
      promptKey,
      input.parent_finding_id ?? null,
      input.parent_pack_id ?? null,
      at,
      at,
    )

  void executePackJob(id)
  return getResearchPack(id)!
}

function buildFractalTopic(
  parentPack: DeproResearchPack,
  finding: DeproResearchFinding,
): string {
  const parts = [
    `Dentro del contexto de «${parentPack.topic}», profundiza en: ${finding.title}.`,
  ]
  if (finding.body.trim()) parts.push(finding.body.trim())
  if (finding.url) parts.push(`Fuente ancla: ${finding.url}`)
  return parts.join('\n\n')
}

/** Marca fractalizado y devuelve prompt para copiar a Perplexity (manual). */
export function fractalizeFinding(findingId: string): {
  topic: string
  prompt: string
  parent_finding_id: string
  parent_pack_id: string
} {
  const finding = getFinding(findingId)
  if (!finding) throw new Error('Hallazgo no encontrado')
  if (finding.status !== 'pending') {
    throw new Error('Solo se puede fractalizar un hallazgo pendiente')
  }
  const parentPack = getResearchPack(finding.pack_id)
  if (!parentPack) throw new Error('Pack padre no encontrado')

  const topic = buildFractalTopic(parentPack, finding)
  const { prompt } = buildResearchPrompt(topic)

  const at = nowIso()
  getDb()
    .prepare(
      `UPDATE depro_research_findings
       SET status = 'fractalized', updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(at, finding.id)

  return {
    topic,
    prompt,
    parent_finding_id: finding.id,
    parent_pack_id: parentPack.id,
  }
}

export function assimilateFinding(
  findingId: string,
  opts?: {
    row_item_id?: unknown
    col_item_id?: unknown
    matrix_id?: unknown
    domain_ids?: unknown
  },
): { finding: DeproResearchFinding; item: ReturnType<typeof createIda> } {
  const finding = getFinding(findingId)
  if (!finding) throw new Error('Hallazgo no encontrado')
  if (finding.status !== 'pending') {
    throw new Error('El hallazgo ya no está pendiente')
  }
  const pack = getResearchPack(finding.pack_id)
  const bodyParts = [finding.body.trim()]
  if (finding.axis_title) {
    bodyParts.unshift(`Eje: ${finding.axis_title}`)
  }
  if (finding.url) bodyParts.push(`Fuente: ${finding.url}`)
  const tags = ['research', 'cuarentena', pack?.prompt_key ?? 'explorador']
  if (pack?.origin === 'manual') tags.push('manual')
  const item = createIda({
    title: finding.title,
    body: bodyParts.filter(Boolean).join('\n\n'),
    stage: 'investigacion',
    kind: 'aprendizaje',
    agent_ids: pack ? [pack.agent_id] : ['explorador'],
    tags,
    row_item_id: opts?.row_item_id,
    col_item_id: opts?.col_item_id,
    matrix_id: opts?.matrix_id,
    domain_ids: opts?.domain_ids,
  })
  if (shouldEmbedIda(item)) {
    enqueueEmbed(() => embedIdaItem(item.id))
  }
  const at = nowIso()
  getDb()
    .prepare(
      `UPDATE depro_research_findings
       SET status = 'assimilated', assimilated_ida_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(item.id, at, finding.id)
  const updated = getFinding(findingId)!
  return { finding: updated, item }
}

export function discardFinding(findingId: string): DeproResearchFinding {
  const finding = getFinding(findingId)
  if (!finding) throw new Error('Hallazgo no encontrado')
  if (finding.status !== 'pending') {
    throw new Error('El hallazgo ya no está pendiente')
  }
  const at = nowIso()
  getDb()
    .prepare(
      `UPDATE depro_research_findings
       SET status = 'discarded', updated_at = ?
       WHERE id = ?`,
    )
    .run(at, findingId)
  return getFinding(findingId)!
}

export function assimilatePending(
  packId: string,
  opts?: {
    row_item_id?: unknown
    col_item_id?: unknown
    matrix_id?: unknown
    domain_ids?: unknown
  },
): { items: ReturnType<typeof createIda>[]; count: number } {
  const pack = getResearchPack(packId)
  if (!pack) throw new Error('Pack no encontrado')
  const pending = listFindingsForPack(packId).filter(
    (f) => f.status === 'pending',
  )
  const items: ReturnType<typeof createIda>[] = []
  for (const f of pending) {
    const { item } = assimilateFinding(f.id, opts)
    items.push(item)
  }
  return { items, count: items.length }
}

export function discardPending(packId: string): { count: number } {
  const pack = getResearchPack(packId)
  if (!pack) throw new Error('Pack no encontrado')
  const at = nowIso()
  const result = getDb()
    .prepare(
      `UPDATE depro_research_findings
       SET status = 'discarded', updated_at = ?
       WHERE pack_id = ? AND status = 'pending'`,
    )
    .run(at, packId)
  return { count: Number(result.changes ?? 0) }
}

/** Borra pack + hallazgos de cuarentena. No toca fichas IDA ya asimiladas. */
export function deleteResearchPack(packId: string): boolean {
  const pack = getResearchPack(packId)
  if (!pack) return false
  const db = getDb()
  db.prepare(`DELETE FROM depro_research_findings WHERE pack_id = ?`).run(
    packId,
  )
  db.prepare(`DELETE FROM depro_research_packs WHERE id = ?`).run(packId)
  return true
}
