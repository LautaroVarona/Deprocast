/**
 * Referentes externos: CRUD, captura GitHub, destilado a protoquántomos, vecinos.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDb, getTrincheraNotebookId } from '../db.js'
import { AppError } from '../errors.js'
import { row, rows } from '../sql.js'
import type {
  EmbeddingObjectType,
  KnowledgeAnchor,
  KnowledgeAnchorRole,
  KnowledgeBook,
  KnowledgeCaptureMode,
  KnowledgeEntity,
  KnowledgeKind,
  KnowledgeLegal,
  KnowledgeNeighbor,
  KnowledgePaper,
  KnowledgeRepo,
  KnowledgeStatus,
} from '../types.js'
import { maxQuantomosForWeight } from './audioCriba.js'
import { VAULT_DIR } from './backup.js'
import {
  deleteEmbedding,
  enqueueEmbed,
  similarToStored,
  upsertEmbedding,
} from './embeddings.js'
import { fetchGithubRepo } from './knowledgeGithub.js'
import { generateKnowledgeUtility } from './knowledgeLlm.js'
import {
  detectStackTags,
  parseGithubRepoRef,
  pulseFromRepo,
} from './knowledgeStack.js'
import { claimQueuedJobs, enqueueJob, finishJob, retryJob } from './jobs.js'

const KINDS: KnowledgeKind[] = [
  'repo',
  'paper',
  'legal',
  'book',
  'dataset',
  'curriculum',
  'other',
]

type EntityRow = {
  id: string
  kind: string
  title: string
  authors_org: string
  source_url: string | null
  summary: string
  utility_problem: string
  architecture_tldr: string
  use_cases: string
  captured_at: string
  status: string
  capture_error: string | null
  weight: number | null
  distilled_at: string | null
  domain_ids: string
  tags: string
  notes: string
  capture_mode: string
  created_at: string
  updated_at: string
}

type RepoRow = {
  entity_id: string
  owner: string
  repo_name: string
  default_branch: string | null
  license: string | null
  description_upstream: string
  stack_json: string
  stack_tags: string
  languages_json: string
  topics_json: string
  last_commit_at: string | null
  open_issues: number | null
  stars: number | null
  archived: number
  pushed_at: string | null
  readme_vault_path: string | null
  github_snapshot_json: string
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  } catch {
    return []
  }
}

function asKind(v: unknown): KnowledgeKind {
  const s = String(v ?? '')
  return KINDS.includes(s as KnowledgeKind) ? (s as KnowledgeKind) : 'other'
}

function asStatus(v: unknown): KnowledgeStatus {
  if (v === 'capturing' || v === 'ready' || v === 'error') return v
  return 'ready'
}

function asMode(v: unknown): KnowledgeCaptureMode {
  return v === 'url' ? 'url' : 'manual'
}

function hydrateRepo(r: RepoRow): KnowledgeRepo {
  return {
    entity_id: r.entity_id,
    owner: r.owner,
    repo_name: r.repo_name,
    default_branch: r.default_branch,
    license: r.license,
    description_upstream: r.description_upstream,
    stack_json: r.stack_json,
    stack_tags: parseStringArray(r.stack_tags),
    languages_json: r.languages_json,
    topics_json: r.topics_json,
    last_commit_at: r.last_commit_at,
    open_issues: r.open_issues,
    stars: r.stars,
    archived: r.archived,
    pushed_at: r.pushed_at,
    readme_vault_path: r.readme_vault_path,
    github_snapshot_json: r.github_snapshot_json,
    pulse: pulseFromRepo(r),
  }
}

function hydrateEntity(e: EntityRow): KnowledgeEntity {
  const db = getDb()
  const repo = row<RepoRow>(
    db.prepare(`SELECT * FROM knowledge_repos WHERE entity_id = ?`).get(e.id),
  )
  const paper = row<KnowledgePaper>(
    db.prepare(`SELECT * FROM knowledge_papers WHERE entity_id = ?`).get(e.id),
  )
  const legal = row<KnowledgeLegal>(
    db.prepare(`SELECT * FROM knowledge_legal WHERE entity_id = ?`).get(e.id),
  )
  const book = row<KnowledgeBook>(
    db.prepare(`SELECT * FROM knowledge_books WHERE entity_id = ?`).get(e.id),
  )
  const anchors = rows<KnowledgeAnchor>(
    db
      .prepare(
        `SELECT id, entity_id, matrix_id, row_item_id, col_item_id, role, created_at
         FROM knowledge_anchors WHERE entity_id = ? ORDER BY created_at`,
      )
      .all(e.id),
  )
  return {
    id: e.id,
    kind: asKind(e.kind),
    title: e.title,
    authors_org: e.authors_org,
    source_url: e.source_url,
    summary: e.summary,
    utility_problem: e.utility_problem,
    architecture_tldr: e.architecture_tldr,
    use_cases: e.use_cases,
    captured_at: e.captured_at,
    status: asStatus(e.status),
    capture_error: e.capture_error,
    weight: e.weight,
    distilled_at: e.distilled_at,
    domain_ids: parseStringArray(e.domain_ids),
    tags: parseStringArray(e.tags),
    notes: e.notes,
    capture_mode: asMode(e.capture_mode),
    created_at: e.created_at,
    updated_at: e.updated_at,
    repo: repo ? hydrateRepo(repo) : null,
    paper: paper ?? null,
    legal: legal ?? null,
    book: book ?? null,
    anchors,
  }
}

function getRow(id: string): EntityRow | undefined {
  return row<EntityRow>(
    getDb().prepare(`SELECT * FROM knowledge_entities WHERE id = ?`).get(id),
  )
}

export function getKnowledge(id: string): KnowledgeEntity | null {
  const e = getRow(id)
  return e ? hydrateEntity(e) : null
}

export function listKnowledge(opts?: {
  q?: string
  kind?: string
  pulse?: string
  limit?: number
}): KnowledgeEntity[] {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200)
  let ids: string[] = []
  if (opts?.q?.trim()) {
    const q = opts.q.trim().replace(/"/g, '')
    try {
      const fts = rows<{ entity_id: string }>(
        db
          .prepare(
            `SELECT entity_id FROM knowledge_fts WHERE knowledge_fts MATCH ? LIMIT ?`,
          )
          .all(`"${q.replace(/"/g, '')}"`, limit),
      )
      ids = fts.map((r) => r.entity_id)
    } catch {
      ids = []
    }
    if (ids.length === 0) {
      const like = `%${q.toLowerCase()}%`
      const fallback = rows<{ id: string }>(
        db
          .prepare(
            `SELECT id FROM knowledge_entities
             WHERE lower(title) LIKE ? OR lower(source_url) LIKE ?
             ORDER BY captured_at DESC LIMIT ?`,
          )
          .all(like, like, limit),
      )
      ids = fallback.map((r) => r.id)
    }
  } else {
    const all = rows<{ id: string }>(
      db
        .prepare(
          `SELECT id FROM knowledge_entities ORDER BY captured_at DESC LIMIT ?`,
        )
        .all(limit),
    )
    ids = all.map((r) => r.id)
  }

  const out: KnowledgeEntity[] = []
  for (const id of ids) {
    const e = getKnowledge(id)
    if (!e) continue
    if (opts?.kind && e.kind !== opts.kind) continue
    if (opts?.pulse && e.repo?.pulse !== opts.pulse) continue
    out.push(e)
  }
  return out
}

function embedText(entity: KnowledgeEntity): string {
  const stack = entity.repo?.stack_tags.join(', ') ?? ''
  return [
    entity.title,
    entity.authors_org,
    entity.utility_problem,
    entity.architecture_tldr,
    entity.use_cases,
    stack ? `stack: ${stack}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function scheduleEmbed(id: string): void {
  enqueueEmbed(async () => {
    const entity = getKnowledge(id)
    if (!entity) return
    const text = embedText(entity)
    if (!text.trim()) return
    await upsertEmbedding('knowledge', id, text)
  })
}

function insertEmptySatellite(kind: KnowledgeKind, entityId: string): void {
  const db = getDb()
  if (kind === 'repo') {
    db.prepare(
      `INSERT OR IGNORE INTO knowledge_repos (entity_id, owner, repo_name)
       VALUES (?, '', '')`,
    ).run(entityId)
  } else if (kind === 'paper') {
    db.prepare(
      `INSERT OR IGNORE INTO knowledge_papers (entity_id) VALUES (?)`,
    ).run(entityId)
  } else if (kind === 'legal') {
    db.prepare(
      `INSERT OR IGNORE INTO knowledge_legal (entity_id) VALUES (?)`,
    ).run(entityId)
  } else if (kind === 'book') {
    db.prepare(
      `INSERT OR IGNORE INTO knowledge_books (entity_id) VALUES (?)`,
    ).run(entityId)
  }
}

export function createManualKnowledge(input: {
  kind?: KnowledgeKind
  title: string
  authors_org?: string
  source_url?: string | null
  summary?: string
  utility_problem?: string
  architecture_tldr?: string
  use_cases?: string
  notes?: string
  domain_ids?: string[]
  tags?: string[]
  repo?: {
    owner?: string
    repo_name?: string
    stack_tags?: string[]
    last_commit_at?: string | null
    open_issues?: number | null
    stars?: number | null
    archived?: boolean
    pushed_at?: string | null
    license?: string | null
    description_upstream?: string
    default_branch?: string | null
  }
}): KnowledgeEntity {
  const title = input.title.trim()
  if (!title) throw new AppError('Hace falta un nombre', 400, 'KNOWLEDGE_TITLE')
  const kind = input.kind ?? 'repo'
  const now = new Date().toISOString()
  const id = randomUUID()
  const sourceUrl = input.source_url?.trim() || null
  if (sourceUrl) {
    const existing = row<{ id: string }>(
      getDb()
        .prepare(`SELECT id FROM knowledge_entities WHERE source_url = ?`)
        .get(sourceUrl),
    )
    if (existing) {
      const found = getKnowledge(existing.id)
      if (found) return found
    }
  }

  const db = getDb()
  db.prepare(
    `INSERT INTO knowledge_entities (
      id, kind, title, authors_org, source_url, summary, utility_problem,
      architecture_tldr, use_cases, captured_at, status, capture_error, weight,
      distilled_at, domain_ids, tags, notes, capture_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, NULL, ?, ?, ?, 'manual', ?, ?)`,
  ).run(
    id,
    kind,
    title,
    input.authors_org?.trim() ?? '',
    sourceUrl,
    input.summary ?? '',
    input.utility_problem ?? '',
    input.architecture_tldr ?? '',
    input.use_cases ?? '',
    now,
    JSON.stringify(input.domain_ids ?? []),
    JSON.stringify(input.tags ?? []),
    input.notes ?? '',
    now,
    now,
  )
  insertEmptySatellite(kind, id)
  if (kind === 'repo' && input.repo) {
    const r = input.repo
    db.prepare(
      `UPDATE knowledge_repos SET
        owner = ?, repo_name = ?, default_branch = ?, license = ?,
        description_upstream = ?, stack_tags = ?, last_commit_at = ?,
        open_issues = ?, stars = ?, archived = ?, pushed_at = ?
       WHERE entity_id = ?`,
    ).run(
      r.owner ?? '',
      r.repo_name ?? '',
      r.default_branch ?? null,
      r.license ?? null,
      r.description_upstream ?? '',
      JSON.stringify(r.stack_tags ?? []),
      r.last_commit_at ?? null,
      r.open_issues ?? null,
      r.stars ?? null,
      r.archived ? 1 : 0,
      r.pushed_at ?? null,
      id,
    )
  }
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('No se pudo crear el referente', 500)
  scheduleEmbed(id)
  return entity
}

export function captureFromUrl(rawUrl: string): KnowledgeEntity {
  const ref = parseGithubRepoRef(rawUrl)
  if (!ref) {
    throw new AppError(
      'Pegá un link de GitHub (github.com/owner/repo) o owner/repo',
      400,
      'GITHUB_URL',
    )
  }
  const db = getDb()
  const existing = row<{ id: string }>(
    db
      .prepare(`SELECT id FROM knowledge_entities WHERE source_url = ?`)
      .get(ref.url),
  )
  if (existing) {
    const found = getKnowledge(existing.id)
    if (found) return found
  }

  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO knowledge_entities (
      id, kind, title, authors_org, source_url, summary, utility_problem,
      architecture_tldr, use_cases, captured_at, status, capture_error, weight,
      distilled_at, domain_ids, tags, notes, capture_mode, created_at, updated_at
    ) VALUES (?, 'repo', ?, ?, ?, '', '', '', '', ?, 'capturing', NULL, NULL, NULL, '[]', '[]', '', 'url', ?, ?)`,
  ).run(id, ref.repo, ref.owner, ref.url, now, now, now)
  db.prepare(
    `INSERT INTO knowledge_repos (entity_id, owner, repo_name) VALUES (?, ?, ?)`,
  ).run(id, ref.owner, ref.repo)
  enqueueJob('knowledge', { entityId: id })
  kickKnowledgeJobs()
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('No se pudo encolar la captura', 500)
  return entity
}

export function captureFromHarvest(linkId: string): KnowledgeEntity {
  const link = row<{ url_cruda: string; url_norm: string }>(
    getDb()
      .prepare(`SELECT url_cruda, url_norm FROM link_harvest WHERE id = ?`)
      .get(linkId),
  )
  if (!link) throw new AppError('Link no encontrado', 404, 'LINK_NOT_FOUND')
  const url = link.url_cruda || link.url_norm
  const entity = captureFromUrl(url)
  getDb()
    .prepare(
      `UPDATE link_harvest SET estado_crawler = 'crawled' WHERE id = ?`,
    )
    .run(linkId)
  return entity
}

function writeReadme(entityId: string, readme: string): string | null {
  if (!readme.trim()) return null
  const dir = path.join(VAULT_DIR, 'knowledge', entityId)
  fs.mkdirSync(dir, { recursive: true })
  const rel = path.join('knowledge', entityId, 'readme.md').replaceAll('\\', '/')
  fs.writeFileSync(path.join(VAULT_DIR, rel), readme, 'utf8')
  return rel
}

export async function runGithubCapture(
  entityId: string,
  opts?: { refresh?: boolean },
): Promise<KnowledgeEntity> {
  const entity = getKnowledge(entityId)
  if (!entity) throw new AppError('Referente no encontrado', 404)
  const url = entity.source_url || `${entity.repo?.owner}/${entity.repo?.repo_name}`
  const meta = await fetchGithubRepo(url)
  const stackTags = detectStackTags({
    files: meta.files,
    topics: meta.topics,
    languages: meta.languages,
    readme: meta.readme,
  })
  const vaultPath = writeReadme(entityId, meta.readme)
  const stackJson = {
    files: Object.keys(meta.files),
    package:
      meta.files['package.json'] != null
        ? safeJson(meta.files['package.json']!)
        : null,
  }
  const snapshot = {
    fetched_at: new Date().toISOString(),
    html_url: meta.html_url,
    language: meta.language,
    last_commit_sha: meta.last_commit_sha,
    last_commit_message: meta.last_commit_message,
    manifests: Object.keys(meta.files),
  }

  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE knowledge_repos SET
      owner = ?, repo_name = ?, default_branch = ?, license = ?,
      description_upstream = ?, stack_json = ?, stack_tags = ?,
      languages_json = ?, topics_json = ?, last_commit_at = ?,
      open_issues = ?, stars = ?, archived = ?, pushed_at = ?,
      readme_vault_path = ?, github_snapshot_json = ?
     WHERE entity_id = ?`,
  ).run(
    meta.owner,
    meta.repo,
    meta.default_branch,
    meta.license,
    meta.description,
    JSON.stringify(stackJson),
    JSON.stringify(stackTags),
    JSON.stringify(meta.languages),
    JSON.stringify(meta.topics),
    meta.last_commit_at,
    meta.open_issues,
    meta.stars,
    meta.archived ? 1 : 0,
    meta.pushed_at,
    vaultPath,
    JSON.stringify(snapshot),
    entityId,
  )

  const keepLlm = Boolean(opts?.refresh) && Boolean(entity.utility_problem.trim())
  let summary = entity.summary
  let utility = entity.utility_problem
  let tldr = entity.architecture_tldr
  let uses = entity.use_cases
  if (!keepLlm) {
    const generated = await generateKnowledgeUtility({
      title: meta.repo,
      description: meta.description,
      stackTags,
      languages: Object.keys(meta.languages),
      readme: meta.readme,
    })
    if (generated) {
      summary = generated.summary || summary || meta.description
      utility = generated.utility_problem || utility
      tldr = generated.architecture_tldr || tldr
      uses = generated.use_cases || uses
    } else if (!summary) {
      summary = meta.description
    }
  }

  const keepTitle =
    Boolean(opts?.refresh) &&
    Boolean(entity.title) &&
    entity.title !== entity.repo?.repo_name
  const keepOrg = Boolean(opts?.refresh) && Boolean(entity.authors_org)
  db.prepare(
    `UPDATE knowledge_entities SET
      title = ?, authors_org = ?, source_url = ?, summary = ?,
      utility_problem = ?, architecture_tldr = ?, use_cases = ?,
      status = 'ready', capture_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(
    keepTitle ? entity.title : meta.repo,
    keepOrg ? entity.authors_org : meta.owner,
    meta.html_url,
    summary,
    utility,
    tldr,
    uses,
    now,
    entityId,
  )

  const out = getKnowledge(entityId)
  if (!out) throw new AppError('Referente perdido tras captura', 500)
  scheduleEmbed(entityId)
  return out
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseLangMap(raw: string): Record<string, number> {
  const parsed = safeJson(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

export function patchKnowledge(
  id: string,
  patch: Partial<{
    title: string
    authors_org: string
    source_url: string | null
    summary: string
    utility_problem: string
    architecture_tldr: string
    use_cases: string
    notes: string
    weight: number | null
    domain_ids: string[]
    tags: string[]
    kind: KnowledgeKind
    stack_tags: string[]
    last_commit_at: string | null
    open_issues: number | null
    stars: number | null
    archived: boolean
    license: string | null
    description_upstream: string
    default_branch: string | null
    owner: string
    repo_name: string
  }>,
): KnowledgeEntity {
  const existing = getRow(id)
  if (!existing) throw new AppError('Referente no encontrado', 404)
  const now = new Date().toISOString()
  const db = getDb()
  const title = patch.title !== undefined ? patch.title.trim() : existing.title
  if (!title) throw new AppError('Hace falta un nombre', 400, 'KNOWLEDGE_TITLE')
  let weight = existing.weight
  if (patch.weight !== undefined) {
    if (patch.weight == null) weight = null
    else {
      const w = Math.round(Number(patch.weight))
      if (w < 1 || w > 12) throw new AppError('El peso va de 1 a 12', 400)
      weight = w
    }
  }
  db.prepare(
    `UPDATE knowledge_entities SET
      kind = ?, title = ?, authors_org = ?, source_url = ?, summary = ?,
      utility_problem = ?, architecture_tldr = ?, use_cases = ?, notes = ?,
      weight = ?, domain_ids = ?, tags = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.kind ?? existing.kind,
    title,
    patch.authors_org ?? existing.authors_org,
    patch.source_url !== undefined ? patch.source_url : existing.source_url,
    patch.summary ?? existing.summary,
    patch.utility_problem ?? existing.utility_problem,
    patch.architecture_tldr ?? existing.architecture_tldr,
    patch.use_cases ?? existing.use_cases,
    patch.notes ?? existing.notes,
    weight,
    JSON.stringify(patch.domain_ids ?? parseStringArray(existing.domain_ids)),
    JSON.stringify(patch.tags ?? parseStringArray(existing.tags)),
    now,
    id,
  )

  const repoPatchKeys = [
    'stack_tags',
    'last_commit_at',
    'open_issues',
    'stars',
    'archived',
    'license',
    'description_upstream',
    'default_branch',
    'owner',
    'repo_name',
  ] as const
  if (repoPatchKeys.some((k) => patch[k] !== undefined)) {
    insertEmptySatellite('repo', id)
    const repo = row<RepoRow>(
      db.prepare(`SELECT * FROM knowledge_repos WHERE entity_id = ?`).get(id),
    )
    if (repo) {
      db.prepare(
        `UPDATE knowledge_repos SET
          owner = ?, repo_name = ?, default_branch = ?, license = ?,
          description_upstream = ?, stack_tags = ?, last_commit_at = ?,
          open_issues = ?, stars = ?, archived = ?
         WHERE entity_id = ?`,
      ).run(
        patch.owner ?? repo.owner,
        patch.repo_name ?? repo.repo_name,
        patch.default_branch !== undefined
          ? patch.default_branch
          : repo.default_branch,
        patch.license !== undefined ? patch.license : repo.license,
        patch.description_upstream ?? repo.description_upstream,
        JSON.stringify(patch.stack_tags ?? parseStringArray(repo.stack_tags)),
        patch.last_commit_at !== undefined
          ? patch.last_commit_at
          : repo.last_commit_at,
        patch.open_issues !== undefined ? patch.open_issues : repo.open_issues,
        patch.stars !== undefined ? patch.stars : repo.stars,
        patch.archived !== undefined ? (patch.archived ? 1 : 0) : repo.archived,
        id,
      )
    }
  }

  const out = getKnowledge(id)
  if (!out) throw new AppError('Referente no encontrado', 404)
  scheduleEmbed(id)
  return out
}

export function deleteKnowledge(id: string): boolean {
  const existing = getRow(id)
  if (!existing) return false
  deleteEmbedding('knowledge', id)
  getDb().prepare(`DELETE FROM knowledge_entities WHERE id = ?`).run(id)
  try {
    fs.rmSync(path.join(VAULT_DIR, 'knowledge', id), {
      recursive: true,
      force: true,
    })
  } catch {
    /* ignore */
  }
  return true
}

export function addKnowledgeAnchor(input: {
  entity_id: string
  matrix_id: string
  row_item_id: string
  col_item_id: string
  role?: KnowledgeAnchorRole
}): KnowledgeAnchor {
  if (!getRow(input.entity_id)) throw new AppError('Referente no encontrado', 404)
  const id = randomUUID()
  const now = new Date().toISOString()
  const role: KnowledgeAnchorRole =
    input.role === 'interseccion' ? 'interseccion' : 'conocimiento'
  try {
    getDb()
      .prepare(
        `INSERT INTO knowledge_anchors (
          id, entity_id, matrix_id, row_item_id, col_item_id, role, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.entity_id,
        input.matrix_id,
        input.row_item_id,
        input.col_item_id,
        role,
        now,
      )
  } catch {
    throw new AppError('Esa celda ya está anclada', 409, 'ANCHOR_DUP')
  }
  return {
    id,
    entity_id: input.entity_id,
    matrix_id: input.matrix_id,
    row_item_id: input.row_item_id,
    col_item_id: input.col_item_id,
    role,
    created_at: now,
  }
}

export function deleteKnowledgeAnchor(anchorId: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM knowledge_anchors WHERE id = ?`)
    .run(anchorId)
  return result.changes === 1
}

export function distillKnowledge(
  id: string,
  weightArg?: number,
): { entity: KnowledgeEntity; quantomo_ids: string[] } {
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('Referente no encontrado', 404)
  if (entity.distilled_at) {
    throw new AppError(
      'Ya destilado. Editá el referente o esperá un recorte explícito en V2.',
      409,
      'ALREADY_DISTILLED',
    )
  }
  const weight =
    weightArg != null ? Math.round(Number(weightArg)) : entity.weight
  if (weight == null || weight < 1 || weight > 12) {
    throw new AppError('Votá 1–12 antes de destilar', 400, 'NEED_WEIGHT')
  }
  const cap = maxQuantomosForWeight(weight)
  const atoms: Array<{ title: string; content: string }> = []
  if (entity.utility_problem.trim()) {
    atoms.push({
      title: `Problema: ${entity.title}`,
      content: entity.utility_problem.trim(),
    })
  }
  if (entity.architecture_tldr.trim() && atoms.length < cap) {
    atoms.push({
      title: `Arquitectura: ${entity.title}`,
      content: entity.architecture_tldr.trim(),
    })
  }
  if (entity.use_cases.trim() && atoms.length < cap) {
    atoms.push({
      title: `Usos: ${entity.title}`,
      content: entity.use_cases.trim(),
    })
  }
  if (entity.repo?.stack_tags.length && atoms.length < cap) {
    atoms.push({
      title: `Stack: ${entity.title}`,
      content: entity.repo.stack_tags.join(', '),
    })
  }
  if (atoms.length === 0) {
    const fallback = [entity.summary, entity.notes].filter(Boolean).join('\n')
    if (!fallback.trim()) {
      throw new AppError(
        'No hay vector de utilidad para destilar. Completá el problema o el TL;DR.',
        400,
        'EMPTY_UTILITY',
      )
    }
    atoms.push({ title: entity.title, content: fallback })
  }

  const db = getDb()
  const now = new Date().toISOString()
  const entryId = randomUUID()
  const notebookId = getTrincheraNotebookId()
  const inserted: string[] = []

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO entries (
        id, notebook_id, source_type, title, content_raw, vault_path,
        timestamp_exact, status, created_at, title_manual, original_filename,
        human_weight
      ) VALUES (?, ?, 'knowledge', ?, ?, NULL, ?, 'approved', ?, 1, ?, ?)`,
    ).run(
      entryId,
      notebookId,
      entity.title,
      [entity.utility_problem, entity.architecture_tldr, entity.use_cases]
        .filter(Boolean)
        .join('\n\n'),
      now,
      now,
      entity.source_url || `knowledge:${id}`,
      weight,
    )
    for (const atom of atoms.slice(0, cap)) {
      const qid = randomUUID()
      db.prepare(
        `INSERT INTO quantomos (
          id, entry_id, title, content, hermetic_weight, universe, recognized,
          human_weight, suggested_weight, stage, source_kind, source_id, generation
        ) VALUES (?, ?, ?, ?, ?, 'conocimiento', 0, ?, ?, 'proto', 'knowledge', ?, 0)`,
      ).run(
        qid,
        entryId,
        atom.title,
        atom.content,
        weight,
        weight,
        weight,
        id,
      )
      inserted.push(qid)
    }
    db.prepare(
      `UPDATE knowledge_entities SET weight = ?, distilled_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(weight, now, now, id)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }

  const out = getKnowledge(id)
  if (!out) throw new AppError('Referente no encontrado', 404)
  return { entity: out, quantomo_ids: inserted }
}

export async function neighborsForKnowledge(
  id: string,
  limit = 12,
): Promise<KnowledgeNeighbor[]> {
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('Referente no encontrado', 404)
  const types: EmbeddingObjectType[] = ['knowledge', 'quantomo', 'ida_item']
  let hits = similarToStored('knowledge', id, { types, limit })
  if (hits.length === 0) {
    const { searchSimilar } = await import('./embeddings.js')
    const q = embedText(entity)
    if (q.trim()) {
      hits = (await searchSimilar(q, { types, limit: limit + 1 })).filter(
        (h) => !(h.object_type === 'knowledge' && h.object_id === id),
      )
    }
  }
  return hydrateNeighbors(hits.slice(0, limit), entity)
}

function hydrateNeighbors(
  hits: Array<{
    object_type: EmbeddingObjectType
    object_id: string
    score: number
  }>,
  self: KnowledgeEntity,
): KnowledgeNeighbor[] {
  const db = getDb()
  const selfCols = new Set(self.anchors.map((a) => a.col_item_id))
  const out: KnowledgeNeighbor[] = []
  for (const h of hits) {
    let label = h.object_id
    if (h.object_type === 'knowledge') {
      const r = row<{ title: string }>(
        db.prepare(`SELECT title FROM knowledge_entities WHERE id = ?`).get(h.object_id),
      )
      label = r?.title ?? label
    } else if (h.object_type === 'quantomo') {
      const r = row<{ title: string }>(
        db.prepare(`SELECT title FROM quantomos WHERE id = ?`).get(h.object_id),
      )
      label = r?.title ?? label
    } else if (h.object_type === 'ida_item') {
      const r = row<{ title: string; col_item_id: string | null }>(
        db
          .prepare(`SELECT title, col_item_id FROM depro_ida_items WHERE id = ?`)
          .get(h.object_id),
      )
      label = r?.title ?? label
      if (r?.col_item_id && selfCols.size && selfCols.has(r.col_item_id)) {
        // misma columna AmazonA: sigue valiendo, pero no es cruce radical
        label = `${label} · misma columna`
      }
    }
    out.push({
      object_type: h.object_type,
      object_id: h.object_id,
      label,
      score: h.score,
    })
  }
  return out
}

export async function regenerateUtility(id: string): Promise<KnowledgeEntity> {
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('Referente no encontrado', 404)
  let readme = ''
  if (entity.repo?.readme_vault_path) {
    try {
      readme = fs.readFileSync(
        path.join(VAULT_DIR, entity.repo.readme_vault_path),
        'utf8',
      )
    } catch {
      readme = entity.notes
    }
  } else {
    readme = entity.notes
  }
  const generated = await generateKnowledgeUtility({
    title: entity.title,
    description: entity.repo?.description_upstream || entity.summary,
    stackTags: entity.repo?.stack_tags,
    languages: entity.repo ? Object.keys(parseLangMap(entity.repo.languages_json)) : [],
    readme,
  })
  if (!generated) {
    throw new AppError(
      'No hay LLM disponible para generar utilidad',
      503,
      'LLM_UNAVAILABLE',
    )
  }
  return patchKnowledge(id, generated)
}

let draining = false

export function kickKnowledgeJobs(): void {
  if (draining) return
  draining = true
  void drainKnowledgeJobs().finally(() => {
    draining = false
  })
}

async function drainKnowledgeJobs(): Promise<void> {
  while (true) {
    const jobs = claimQueuedJobs('knowledge', 1)
    if (jobs.length === 0) break
    const job = jobs[0]!
    let entityId = ''
    try {
      const payload = JSON.parse(job.payload) as {
        entityId?: string
        refresh?: boolean
      }
      entityId = String(payload.entityId ?? '')
      if (!entityId) throw new Error('job sin entityId')
      await runGithubCapture(entityId, { refresh: Boolean(payload.refresh) })
      finishJob(job.id, job.generation, 'done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (entityId) {
        const now = new Date().toISOString()
        getDb()
          .prepare(
            `UPDATE knowledge_entities
             SET status = 'error', capture_error = ?, updated_at = ?
             WHERE id = ? AND status = 'capturing'`,
          )
          .run(msg.slice(0, 400), now, entityId)
      }
      retryJob(job.id, 20_000, msg.slice(0, 400))
    }
  }
}

export function refreshKnowledge(id: string): KnowledgeEntity {
  const entity = getKnowledge(id)
  if (!entity) throw new AppError('Referente no encontrado', 404)
  if (entity.kind !== 'repo' && !parseGithubRepoRef(entity.source_url ?? '')) {
    throw new AppError('Solo se refresca un repo de GitHub', 400)
  }
  getDb()
    .prepare(
      `UPDATE knowledge_entities SET status = 'capturing', capture_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), id)
  enqueueJob('knowledge', { entityId: id, refresh: true })
  kickKnowledgeJobs()
  return getKnowledge(id)!
}

export function findGithubHarvestLinks(limit = 40): Array<{
  id: string
  url_cruda: string
  url_norm: string
  estado_crawler: string
}> {
  const all = rows<{
    id: string
    url_cruda: string
    url_norm: string
    estado_crawler: string
  }>(
    getDb()
      .prepare(
        `SELECT id, url_cruda, url_norm, estado_crawler
         FROM link_harvest
         ORDER BY created_at DESC LIMIT 400`,
      )
      .all(),
  )
  return all
    .filter((l) => parseGithubRepoRef(l.url_cruda || l.url_norm))
    .slice(0, limit)
}
