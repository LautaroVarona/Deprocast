/**
 * Sentinela: instancias que inspeccionan Deprocast y ejecutan misiones.
 * Tools allowlist. Sin shell y sin escribir código.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db.js'
import { row, rows } from '../sql.js'
import {
  chatWithCorpus,
  chatWithTools,
  isCohereQuotaError,
  type ChatToolSpec,
  type ChatToolTurn,
} from './cohere.js'
import { createIda } from './deprocast.js'
import { deleteEmbedding, searchSimilar, upsertEmbedding } from './embeddings.js'
import { searchGraphContext } from './graph.js'
import { getPipelineStatus } from './pipeline.js'
import { getSentinelBrain } from './appSettings.js'
import { isPayloadTooLargeError } from './llmChat.js'

export type SentinelStatus =
  | 'inspecting'
  | 'ready'
  | 'running'
  | 'paused'
  | 'error'

export type SentinelMissionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'

export type SentinelSkillStatus = 'draft' | 'accepted' | 'rejected'

export type SentinelAgent = {
  id: string
  code: string
  name: string
  status: SentinelStatus
  profile_md: string
  created_at: string
  updated_at: string
}

export type SentinelMission = {
  id: string
  agent_id: string
  intro: string
  instructions: string
  resources: string[]
  expected_output: string
  status: SentinelMissionStatus
  paused_at: string | null
  created_at: string
  updated_at: string
}

export type SentinelMessage = {
  id: string
  mission_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
}

export type SentinelEvent = {
  id: string
  agent_id: string
  mission_id: string | null
  kind: 'note' | 'observation' | 'timing' | 'suggestion' | 'error' | 'tool'
  payload: string
  created_at: string
}

export type SentinelSkill = {
  id: string
  agent_id: string
  name: string
  input: string
  processing: string
  output: string
  kind: string
  body: unknown
  status: SentinelSkillStatus
  weight: number | null
  ida_item_id: string | null
  created_at: string
  updated_at: string
}

const ROOT = process.cwd()
const ALMA_PATH = path.join(ROOT, 'server', 'prompts', 'alma-sentinela.md')
const MAX_SOURCE = 4_000
/** Índice de nacimiento: cabe en Groq TPM on_demand. El código se lee en misión. */
const MAX_HARVEST = 8_000
const MAX_DOC_TEASER = 180
const MAX_DOCS = 8
const MAX_TOOL_RESULT = 2_400
const MAX_PROFILE_IN_MISSION = 2_800
const MAX_ROUNDS = 8

const inspectAbort = new Set<string>()
const inspectBusy = new Set<string>()
const missionAbort = new Set<string>()
const missionBusy = new Set<string>()

function nowIso(): string {
  return new Date().toISOString()
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[cortado ${text.length - max} chars]`
}

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseUnknown(raw: string | null | undefined): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return v == null ? '' : String(v).trim()
}

function loadAlma(): string {
  try {
    return fs.readFileSync(ALMA_PATH, 'utf8')
  } catch {
    return 'Sos la Sentinela de esta RUN. Inspeccioná con evidencia. No inventes.'
  }
}

type AgentRow = {
  id: string
  code: string
  name: string | null
  status: string
  profile_md: string
  created_at: string
  updated_at: string
}

type MissionRow = {
  id: string
  agent_id: string
  intro: string
  instructions: string
  resources_json: string
  expected_output: string
  status: string
  paused_at: string | null
  created_at: string
  updated_at: string
}

type SkillRow = {
  id: string
  agent_id: string
  name: string
  input: string
  processing: string
  output: string
  kind: string
  body_json: string
  status: string
  weight: number | null
  ida_item_id: string | null
  created_at: string
  updated_at: string
}

function mapAgent(r: AgentRow): SentinelAgent {
  return {
    id: r.id,
    code: r.code,
    name: (r.name ?? '').trim() || r.code,
    status: r.status as SentinelStatus,
    profile_md: r.profile_md,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function mapMission(r: MissionRow): SentinelMission {
  return {
    id: r.id,
    agent_id: r.agent_id,
    intro: r.intro,
    instructions: r.instructions,
    resources: parseStringList(r.resources_json),
    expected_output: r.expected_output,
    status: r.status as SentinelMissionStatus,
    paused_at: r.paused_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function mapSkill(r: SkillRow): SentinelSkill {
  return {
    id: r.id,
    agent_id: r.agent_id,
    name: r.name,
    input: r.input,
    processing: r.processing,
    output: r.output,
    kind: r.kind,
    body: parseUnknown(r.body_json),
    status: r.status as SentinelSkillStatus,
    weight: r.weight,
    ida_item_id: r.ida_item_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function nextCode(): string {
  const list = rows<{ code: string }>(
    getDb().prepare('SELECT code FROM sentinel_agents').all(),
  )
  let max = 0
  for (const r of list) {
    const m = /^sentinela_(\d+)$/.exec(r.code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `sentinela_${String(max + 1).padStart(3, '0')}`
}

function logEvent(
  agentId: string,
  kind: SentinelEvent['kind'],
  payload: string,
  missionId: string | null = null,
): void {
  getDb()
    .prepare(
      `INSERT INTO sentinel_events (id, agent_id, mission_id, kind, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), agentId, missionId, kind, clip(payload, 12_000), nowIso())
}

function insertMessage(
  missionId: string,
  role: SentinelMessage['role'],
  content: string,
): SentinelMessage {
  const msg: SentinelMessage = {
    id: randomUUID(),
    mission_id: missionId,
    role,
    content,
    created_at: nowIso(),
  }
  getDb()
    .prepare(
      `INSERT INTO sentinel_messages (id, mission_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(msg.id, msg.mission_id, msg.role, msg.content, msg.created_at)
  return msg
}

function setAgentStatus(
  id: string,
  status: SentinelStatus,
  profileMd?: string,
): void {
  const ts = nowIso()
  if (profileMd != null) {
    getDb()
      .prepare(
        `UPDATE sentinel_agents SET status = ?, profile_md = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, profileMd, ts, id)
  } else {
    getDb()
      .prepare(`UPDATE sentinel_agents SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, ts, id)
  }
}

function setMissionStatus(
  id: string,
  status: SentinelMissionStatus,
  extra?: { paused_at?: string | null },
): void {
  const ts = nowIso()
  if (extra && 'paused_at' in extra) {
    getDb()
      .prepare(
        `UPDATE sentinel_missions SET status = ?, paused_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, extra.paused_at ?? null, ts, id)
  } else {
    getDb()
      .prepare(
        `UPDATE sentinel_missions SET status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, ts, id)
  }
}

export function getAgent(id: string): SentinelAgent | null {
  const r = row<AgentRow>(
    getDb()
      .prepare(
        `SELECT id, code, name, status, profile_md, created_at, updated_at
         FROM sentinel_agents WHERE id = ?`,
      )
      .get(id),
  )
  return r ? mapAgent(r) : null
}

export function listAgents(): SentinelAgent[] {
  return rows<AgentRow>(
    getDb()
      .prepare(
        `SELECT id, code, name, status, profile_md, created_at, updated_at
         FROM sentinel_agents ORDER BY created_at DESC`,
      )
      .all(),
  ).map(mapAgent)
}

export function listMissions(agentId: string): SentinelMission[] {
  return rows<MissionRow>(
    getDb()
      .prepare(
        `SELECT * FROM sentinel_missions WHERE agent_id = ? ORDER BY created_at DESC`,
      )
      .all(agentId),
  ).map(mapMission)
}

export function getMission(id: string): SentinelMission | null {
  const r = row<MissionRow>(
    getDb().prepare('SELECT * FROM sentinel_missions WHERE id = ?').get(id),
  )
  return r ? mapMission(r) : null
}

export function listMessages(missionId: string): SentinelMessage[] {
  return rows<SentinelMessage>(
    getDb()
      .prepare(
        `SELECT id, mission_id, role, content, created_at
         FROM sentinel_messages WHERE mission_id = ? ORDER BY created_at ASC`,
      )
      .all(missionId),
  )
}

export function listEvents(agentId: string, limit = 200): SentinelEvent[] {
  return rows<SentinelEvent>(
    getDb()
      .prepare(
        `SELECT id, agent_id, mission_id, kind, payload, created_at
         FROM sentinel_events WHERE agent_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(agentId, limit),
  ).reverse()
}

export function listSkills(agentId: string): SentinelSkill[] {
  return rows<SkillRow>(
    getDb()
      .prepare(
        `SELECT * FROM sentinel_skills WHERE agent_id = ? ORDER BY created_at DESC`,
      )
      .all(agentId),
  ).map(mapSkill)
}

function listRootMarkdown(): string[] {
  return fs
    .readdirSync(ROOT)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort()
}

function readRepoFile(rel: string, max = 14_000): string {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return `(no existe ${rel})`
  return clip(fs.readFileSync(abs, 'utf8'), max)
}

function catalogFileTokens(): Set<string> {
  const tokens = new Set<string>([
    'modules.ts',
    'agents.ts',
    'powers.ts',
    'sentinel.ts',
    'alma-sentinela.md',
  ])
  try {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/lib/deprocast/modules.ts'),
      'utf8',
    )
    for (const m of src.matchAll(/files:\s*'([^']+)'/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim()
        if (t && t !== '—') tokens.add(t)
      }
    }
  } catch {
    /* harvest sigue con tokens base */
  }
  return tokens
}

function isAllowedSource(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (n.includes('..')) return false
  if (path.posix.basename(n) === 'alma-sentinela.md') return false
  if (!n.startsWith('src/') && !n.startsWith('server/')) return false
  if (!/\.(ts|tsx|js|css|md)$/.test(n)) return false
  const base = path.posix.basename(n)
  const tokens = catalogFileTokens()
  if (tokens.has(base) || tokens.has(n)) return true
  for (const t of tokens) {
    if (n.includes(t.replace(/\\/g, '/'))) return true
  }
  return false
}

function resolveRel(rel: string): string | null {
  const n = rel.replace(/\\/g, '/').replace(/^\.?\//, '')
  const abs = path.resolve(ROOT, n)
  if (!abs.startsWith(ROOT)) return null
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  return abs
}

function readAllowedSource(rel: string): string {
  if (!isAllowedSource(rel)) throw new Error(`Ruta no permitida: ${rel}`)
  const abs = resolveRel(rel)
  if (!abs) throw new Error(`No existe: ${rel}`)
  return clip(fs.readFileSync(abs, 'utf8'), MAX_SOURCE)
}

function readRootDoc(name: string): string {
  const base = path.basename(name)
  if (!base.toLowerCase().endsWith('.md')) {
    throw new Error('Solo markdown de la raíz')
  }
  if (base === 'alma-sentinela.md') {
    throw new Error('El alma no se lee como doc de misión')
  }
  const abs = path.join(ROOT, base)
  if (!fs.existsSync(abs)) throw new Error(`No está en la raíz: ${base}`)
  return clip(fs.readFileSync(abs, 'utf8'), MAX_SOURCE)
}

export function censusSnapshot(): Record<string, unknown> {
  const db = getDb()
  const entryRows = rows<{ status: string; n: number }>(
    db.prepare('SELECT status, COUNT(*) AS n FROM entries GROUP BY status').all(),
  )
  const entries: Record<string, number> = {}
  let entriesTotal = 0
  for (const r of entryRows) {
    entries[r.status] = r.n
    entriesTotal += r.n
  }
  const countOf = (table: string): number => {
    const r = row<{ n: number }>(
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
    )
    return r?.n ?? 0
  }
  const pipe = getPipelineStatus()
  return {
    entries_total: entriesTotal,
    entries_by_status: entries,
    quantomos: countOf('quantomos'),
    persons: countOf('persons'),
    projects: countOf('projects'),
    pipeline: {
      running: pipe.running,
      paused: pipe.paused,
      queued: pipe.queued,
      stage: pipe.stage,
      stageLabel: pipe.stageLabel,
    },
    cohere_key: Boolean(
      process.env.COHERE_API_KEY?.replace(/^["']|["']$/g, ''),
    ),
    groq_key: Boolean(
      process.env.GROQ_API_KEY?.replace(/^["']|["']$/g, ''),
    ),
    sentinel_brain: getSentinelBrain(),
    root_md: listRootMarkdown(),
  }
}

function catalogSnapshot(kind: string): string {
  if (kind === 'agents') return compactAgents()
  if (kind === 'powers') {
    return clip(readRepoFile('src/lib/deprocast/powers.ts', 2_400), 2_400)
  }
  return compactModules()
}

function compactModules(): string {
  try {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/lib/deprocast/modules.ts'),
      'utf8',
    )
    const lines: string[] = []
    for (const m of src.matchAll(
      /id:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'[\s\S]*?does:\s*'([^']+)'/g,
    )) {
      lines.push(`- ${m[1]} · ${m[2]}: ${m[3]}`)
    }
    return lines.length ? lines.join('\n') : clip(src, 2_000)
  } catch {
    return '(sin módulos)'
  }
}

function compactAgents(): string {
  try {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/lib/deprocast/agents.ts'),
      'utf8',
    )
    const lines: string[] = []
    for (const m of src.matchAll(
      /id:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?module:\s*'([^']+)'/g,
    )) {
      lines.push(`- ${m[1]} (${m[2]}) → ${m[3]}`)
    }
    return lines.length ? clip(lines.join('\n'), 2_200) : clip(src, 2_000)
  } catch {
    return '(sin agentes)'
  }
}

function harvestText(): string {
  const parts: string[] = []
  parts.push('# Censo\n' + JSON.stringify(censusSnapshot()))
  parts.push('# Módulos\n' + compactModules())
  parts.push('# Agentes\n' + compactAgents())
  const allDocs = listRootMarkdown()
  const docs = allDocs.slice(0, MAX_DOCS)
  const teasers: string[] = []
  for (const md of docs) {
    try {
      const body = fs.readFileSync(path.join(ROOT, md), 'utf8').trim()
      const first =
        body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? body
      teasers.push(
        `- ${md}: ${clip(first.replace(/\s+/g, ' '), MAX_DOC_TEASER)}`,
      )
    } catch {
      teasers.push(`- ${md}`)
    }
  }
  const extra = allDocs.length - docs.length
  parts.push(
    '# Docs\n' +
      teasers.join('\n') +
      (extra > 0
        ? `\n(+${extra} más: ${allDocs.slice(MAX_DOCS).join(', ')})`
        : ''),
  )
  parts.push(
    'El código fuente no va en el harvest de nacimiento. En misión usá tools de lectura.',
  )
  return clip(parts.join('\n\n'), MAX_HARVEST)
}

async function embedDocs(): Promise<void> {
  for (const md of listRootMarkdown()) {
    try {
      const body = fs.readFileSync(path.join(ROOT, md), 'utf8')
      await upsertEmbedding('doc', md, `${md}\n${clip(body, 6_000)}`)
    } catch (err) {
      console.warn('[sentinela] embed doc', md, err)
    }
  }
}

function fallbackProfile(code: string, harvest: string, err?: string): string {
  return [
    `# Perfil ${code}`,
    err
      ? `Inspección heurística (LLM no disponible: ${err}).`
      : 'Inspección heurística.',
    '',
    '## Qué es Deprocast',
    'Workspace local-first: captura → criba HITL 1–12 → quántomos → Mnemosyne → grafo.',
    '',
    '## Harvest (recorte)',
    clip(harvest, 8_000),
    '',
    '## Cómo operar',
    'Misiones por comando escrito. Tools allowlist. Skills en borrador hasta HITL.',
  ].join('\n')
}

async function inspectAgent(id: string): Promise<void> {
  if (inspectBusy.has(id)) return
  inspectBusy.add(id)
  const t0 = Date.now()
  try {
    const agent = getAgent(id)
    if (!agent) return
    logEvent(id, 'observation', `Nacimiento ${agent.code}: harvest…`)
    const harvest = harvestText()
    logEvent(
      id,
      'timing',
      `Harvest compacto ${harvest.length} chars · ${Date.now() - t0}ms`,
    )
    void embedDocs().catch((err) => console.warn('[sentinela] embed docs', err))

    let profile = ''
    try {
      profile = await chatWithCorpus({
        role: 'sentinel',
        system:
          loadAlma() +
          '\n\nEstás NACIENDO. El harvest es un ÍNDICE (censo + IPO de módulos/agentes + teasers de docs), no el repo entero. Escribí un PERFIL en markdown: qué es Deprocast, mapa de módulos con IPO, huecos, contratos a vigilar, cómo inspeccionar en misión. Máx 1200 palabras. No inventes archivos ausentes. No copies el alma.',
        messages: [
          {
            role: 'user',
            content: `Código ${agent.code}. Harvest:\n\n${harvest}`,
          },
        ],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (getAgent(id)) logEvent(id, 'error', `LLM perfil: ${msg}`)
      profile = fallbackProfile(agent.code, harvest, msg)
    }

    if (inspectAbort.has(id) || !getAgent(id)) {
      inspectAbort.delete(id)
      if (getAgent(id)) {
        setAgentStatus(
          id,
          'error',
          profile || fallbackProfile(agent.code, harvest, 'abortada'),
        )
        logEvent(id, 'error', 'Inspección abortada')
      }
      return
    }

    setAgentStatus(id, 'ready', profile)
    logEvent(id, 'observation', `Perfil listo · ${Date.now() - t0}ms`)
    void upsertEmbedding('sentinel_profile', id, `${agent.code}\n${profile}`).catch(
      (err) => console.warn('[sentinela] embed profile', err),
    )
  } catch (err) {
    if (!getAgent(id)) return
    const msg = err instanceof Error ? err.message : String(err)
    logEvent(id, 'error', msg)
    setAgentStatus(id, 'error')
  } finally {
    inspectBusy.delete(id)
  }
}

export function createAgent(): SentinelAgent {
  const id = randomUUID()
  const ts = nowIso()
  const code = nextCode()
  getDb()
    .prepare(
      `INSERT INTO sentinel_agents (id, code, name, status, profile_md, created_at, updated_at)
       VALUES (?, ?, ?, 'inspecting', '', ?, ?)`,
    )
    .run(id, code, code, ts, ts)
  logEvent(id, 'observation', `Creada ${code}`)
  void inspectAgent(id)
  return getAgent(id)!
}

export function abortInspect(id: string): SentinelAgent {
  const agent = getAgent(id)
  if (!agent) throw new Error('Sentinela no encontrada')
  if (agent.status !== 'inspecting') return agent
  inspectAbort.add(id)
  setAgentStatus(id, 'error')
  logEvent(id, 'error', 'Operador abortó la inspección')
  return getAgent(id)!
}

export function renameAgent(id: string, rawName: string): SentinelAgent {
  const agent = getAgent(id)
  if (!agent) throw new Error('Sentinela no encontrada')
  const name = rawName.replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('El nombre está vacío')
  if (name.length > 80) throw new Error('Nombre demasiado largo (máx. 80)')
  if (name === agent.name) return agent
  getDb()
    .prepare(
      `UPDATE sentinel_agents SET name = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, nowIso(), id)
  logEvent(id, 'observation', `Renombrada: ${agent.name} → ${name}`)
  return getAgent(id)!
}

export function deleteAgent(id: string): void {
  const agent = getAgent(id)
  if (!agent) throw new Error('Sentinela no encontrada')
  inspectAbort.add(id)
  const missions = listMissions(id)
  for (const m of missions) missionAbort.add(m.id)
  const skills = listSkills(id)
  const db = getDb()
  db.exec('BEGIN')
  try {
    for (const m of missions) {
      db.prepare('DELETE FROM sentinel_messages WHERE mission_id = ?').run(m.id)
    }
    db.prepare('DELETE FROM sentinel_missions WHERE agent_id = ?').run(id)
    db.prepare('DELETE FROM sentinel_events WHERE agent_id = ?').run(id)
    db.prepare('DELETE FROM sentinel_skills WHERE agent_id = ?').run(id)
    db.prepare('DELETE FROM sentinel_agents WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  deleteEmbedding('sentinel_profile', id)
  for (const s of skills) deleteEmbedding('sentinel_skill', s.id)
}

const TOOL_SPECS: ChatToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'read_doc',
      description: 'Lee un .md de la raíz del repo.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_source',
      description: 'Lee un archivo bajo src/ o server/ citado en catálogos.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'catalog',
      description: 'Catálogo IPO: modules | agents | powers.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['modules', 'agents', 'powers'] },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'census',
      description: 'Conteos SQLite y estado del pipeline.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'probe_get',
      description: 'GET nombrado: pipeline | entries | quantomos | health.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: ['pipeline', 'entries', 'quantomos', 'health'],
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_corpus',
      description: 'RAG: quántomos, perfil, skills, docs, grafo.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: 'Persiste nota/observación/sugerencia/timing.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['note', 'observation', 'timing', 'suggestion'],
          },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_skill',
      description: 'Crea skill en borrador. body.steps = receta de tools.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          input: { type: 'string' },
          processing: { type: 'string' },
          output: { type: 'string' },
          kind: { type: 'string' },
          body: { type: 'object' },
        },
        required: ['name', 'input', 'processing', 'output'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_skill',
      description: 'Ejecuta una skill aceptada de esta instancia.',
      parameters: {
        type: 'object',
        properties: { skill_id: { type: 'string' } },
        required: ['skill_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_pause',
      description: 'Pide pausa de la misión actual.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  },
]

function hydrateHit(objectType: string, objectId: string): string {
  const db = getDb()
  if (objectType === 'quantomo') {
    const r = row<{ title: string; content: string | null }>(
      db.prepare('SELECT title, content FROM quantomos WHERE id = ?').get(objectId),
    )
    return r ? `quantomo ${r.title}: ${(r.content ?? '').slice(0, 280)}` : objectId
  }
  if (objectType === 'person') {
    const r = row<{ name: string }>(
      db.prepare('SELECT name FROM persons WHERE id = ?').get(objectId),
    )
    return r ? `person ${r.name}` : objectId
  }
  if (objectType === 'project') {
    const r = row<{ title: string }>(
      db.prepare('SELECT title FROM projects WHERE id = ?').get(objectId),
    )
    return r ? `project ${r.title}` : objectId
  }
  if (objectType === 'entry') {
    const r = row<{ title: string }>(
      db.prepare('SELECT title FROM entries WHERE id = ?').get(objectId),
    )
    return r ? `entry ${r.title}` : objectId
  }
  if (objectType === 'sentinel_skill') {
    const r = row<{ name: string }>(
      db.prepare('SELECT name FROM sentinel_skills WHERE id = ?').get(objectId),
    )
    return r ? `skill ${r.name}` : objectId
  }
  if (objectType === 'doc') return `doc ${objectId}`
  if (objectType === 'sentinel_profile') return `perfil ${objectId}`
  return `${objectType}:${objectId}`
}

async function execTool(
  agentId: string,
  missionId: string,
  name: string,
  args: Record<string, unknown>,
  depth = 0,
): Promise<string> {
  const t0 = Date.now()
  let result = ''
  try {
    switch (name) {
      case 'read_doc':
        result = readRootDoc(strArg(args, 'name'))
        break
      case 'read_source':
        result = readAllowedSource(strArg(args, 'path'))
        break
      case 'catalog':
        result = catalogSnapshot(strArg(args, 'kind') || 'modules')
        break
      case 'census':
        result = JSON.stringify(censusSnapshot())
        break
      case 'probe_get': {
        const probe = strArg(args, 'name')
        if (probe === 'pipeline') result = JSON.stringify(getPipelineStatus())
        else if (probe === 'health') {
          result = JSON.stringify({
            ok: true,
            cohere_key: Boolean(
              process.env.COHERE_API_KEY?.replace(/^["']|["']$/g, ''),
            ),
            groq_key: Boolean(
              process.env.GROQ_API_KEY?.replace(/^["']|["']$/g, ''),
            ),
            sentinel_brain: getSentinelBrain(),
          })
        } else if (probe === 'entries' || probe === 'quantomos') {
          result = JSON.stringify(censusSnapshot())
        } else result = `probe desconocido: ${probe}`
        break
      }
      case 'search_corpus': {
        const q = strArg(args, 'query')
        const hits = await searchSimilar(q, {
          types: [
            'quantomo',
            'person',
            'project',
            'entry',
            'sentinel_profile',
            'sentinel_skill',
            'doc',
          ],
          limit: 8,
        })
        const lines = hits.map(
          (h) =>
            `${h.score.toFixed(3)} ${hydrateHit(h.object_type, h.object_id)}`,
        )
        const graph = await searchGraphContext(q)
        result = `hits:\n${lines.join('\n') || '(nada — embed Cohere en pausa o sin hits)'}\n\ngrafo:\n${clip(graph, 1_200)}`
        break
      }
      case 'write_note': {
        const kind = strArg(args, 'kind') || 'note'
        const allowed = ['note', 'observation', 'timing', 'suggestion'] as const
        const k = (allowed as readonly string[]).includes(kind)
          ? (kind as SentinelEvent['kind'])
          : 'note'
        logEvent(agentId, k, strArg(args, 'text'), missionId)
        result = 'nota guardada'
        break
      }
      case 'propose_skill': {
        const skillId = randomUUID()
        const ts = nowIso()
        getDb()
          .prepare(
            `INSERT INTO sentinel_skills (
              id, agent_id, name, input, processing, output, kind, body_json,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          )
          .run(
            skillId,
            agentId,
            strArg(args, 'name') || 'skill',
            strArg(args, 'input'),
            strArg(args, 'processing'),
            strArg(args, 'output'),
            strArg(args, 'kind') || 'prompt',
            JSON.stringify(args.body ?? {}),
            ts,
            ts,
          )
        logEvent(
          agentId,
          'suggestion',
          `Skill borrador ${skillId}: ${strArg(args, 'name')}`,
          missionId,
        )
        result = `skill draft id=${skillId}`
        break
      }
      case 'run_skill': {
        if (depth > 2) {
          result = 'tope de anidamiento de skills'
          break
        }
        const skill = listSkills(agentId).find(
          (s) => s.id === strArg(args, 'skill_id') && s.status === 'accepted',
        )
        if (!skill) {
          result = 'skill no encontrada o no aceptada'
          break
        }
        const body = skill.body as {
          steps?: Array<{ tool?: string; args?: Record<string, unknown> }>
        }
        const steps = Array.isArray(body?.steps) ? body.steps : []
        const out: string[] = []
        for (const step of steps.slice(0, 6)) {
          const tool = String(step.tool ?? '')
          if (!tool || tool === 'run_skill' || tool === 'propose_skill') continue
          out.push(
            await execTool(agentId, missionId, tool, step.args ?? {}, depth + 1),
          )
        }
        result = out.join('\n---\n') || 'skill sin pasos ejecutables'
        break
      }
      case 'request_pause':
        setMissionStatus(missionId, 'paused', { paused_at: nowIso() })
        setAgentStatus(agentId, 'paused')
        logEvent(
          agentId,
          'note',
          `Pausa pedida: ${strArg(args, 'reason') || 'sin motivo'}`,
          missionId,
        )
        result = 'misión pausada'
        break
      default:
        result = `tool desconocida: ${name}`
    }
  } catch (err) {
    result = `error: ${err instanceof Error ? err.message : String(err)}`
  }
  logEvent(
    agentId,
    'tool',
    `${name} · ${Date.now() - t0}ms\n${clip(result, 500)}`,
    missionId,
  )
  logEvent(agentId, 'timing', `${name}: ${Date.now() - t0}ms`, missionId)
  return clip(result, MAX_TOOL_RESULT)
}

function missionSystem(agent: SentinelAgent, mission: SentinelMission): string {
  const skills = listSkills(agent.id).filter((s) => s.status === 'accepted')
  const skillBlock =
    skills.length === 0
      ? '(ninguna todavía)'
      : skills
          .map((s) => `- ${s.name} [${s.id.slice(0, 8)}]`)
          .join('\n')
  return [
    clip(loadAlma(), 1_400),
    '',
    `Instancia: ${agent.name} (${agent.code}, ${agent.status}).`,
    '',
    '## Perfil (recorte)',
    clip(agent.profile_md || '(aún sin perfil)', MAX_PROFILE_IN_MISSION),
    '',
    '## Misión',
    `Instrucciones: ${clip(mission.instructions, 700)}`,
    `Output esperado: ${clip(mission.expected_output || 'informe con evidencia', 280)}`,
    '',
    '## Skills aceptadas',
    skillBlock,
    '',
    'Usá tools para leer código o docs. No reenvíes el harvest completo.',
  ].join('\n')
}

function compactTurns(turns: ChatToolTurn[]): ChatToolTurn[] {
  return turns.slice(-8).map((t) => {
    if (!('content' in t) || typeof t.content !== 'string') return t
    return { ...t, content: clip(t.content, 1_800) }
  })
}

function missionErrorForChat(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (isPayloadTooLargeError(err) || /TPM|request too large|413/i.test(msg)) {
    return 'Groq rechazó el turno: el contexto superó el tope TPM (8k en GPT-OSS 120B on_demand). No es un corte de Cohere. El motor ya recorta y, si hace falta, reintenta en GPT-OSS 20B. Podés elegir 20B en Motor de Inferencia para más holgura.'
  }
  if (isCohereQuotaError(err)) {
    return 'Cohere sin créditos este mes (embeddings / Mnemosyne). El chat de Sentinela usa Groq; la memoria semántica queda en pausa hasta el próximo ciclo de billing.'
  }
  return `Error: ${msg.slice(0, 280)}`
}

async function runMission(missionId: string): Promise<void> {
  if (missionBusy.has(missionId)) return
  missionBusy.add(missionId)
  const t0 = Date.now()
  try {
    const mission = getMission(missionId)
    if (!mission) return
    const agent = getAgent(mission.agent_id)
    if (!agent) return
    setMissionStatus(missionId, 'running')
    setAgentStatus(agent.id, 'running')

    const history = listMessages(missionId)
    const turns: ChatToolTurn[] = []
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant') {
        turns.push({ role: m.role, content: m.content })
      }
    }
    if (turns.length === 0) {
      turns.push({ role: 'user', content: mission.instructions })
    }

    const system = missionSystem(agent, mission)
    let rounds = 0
    while (rounds < MAX_ROUNDS) {
      if (missionAbort.has(missionId)) break
      const fresh = getMission(missionId)
      if (!fresh || fresh.status === 'paused') break
      rounds += 1
      const turn = await chatWithTools({
        role: 'sentinel',
        system,
        messages: compactTurns(turns),
        tools: TOOL_SPECS,
      })
      if (turn.toolCalls.length === 0) {
        insertMessage(
          missionId,
          'assistant',
          turn.text || 'Sin texto. Revisá el log de tools.',
        )
        setMissionStatus(missionId, 'done')
        setAgentStatus(agent.id, 'ready')
        logEvent(
          agent.id,
          'timing',
          `Misión cerrada en ${Date.now() - t0}ms · ${rounds} rondas`,
          missionId,
        )
        return
      }
      const raw = turn.rawAssistant
      if (raw && typeof raw === 'object') {
        turns.push(raw as ChatToolTurn)
      } else {
        turns.push({
          role: 'assistant',
          content: turn.text,
          tool_calls: turn.toolCalls,
        })
      }
      for (const call of turn.toolCalls) {
        const result = await execTool(
          agent.id,
          missionId,
          call.name,
          call.arguments,
        )
        turns.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        })
        if (getMission(missionId)?.status === 'paused') break
      }
    }

    const latest = getMission(missionId)
    if (latest?.status === 'running') {
      insertMessage(
        missionId,
        'assistant',
        'Tope de rondas de tools. Pausá, cambiá instrucciones o reanudá para seguir.',
      )
      setMissionStatus(missionId, 'paused', { paused_at: nowIso() })
      setAgentStatus(agent.id, 'paused')
    } else if (latest?.status === 'paused') {
      setAgentStatus(agent.id, 'paused')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const mission = getMission(missionId)
    if (mission) {
      insertMessage(missionId, 'assistant', missionErrorForChat(err))
      setMissionStatus(missionId, 'error')
      setAgentStatus(mission.agent_id, 'ready')
      logEvent(mission.agent_id, 'error', msg.slice(0, 500), missionId)
    }
  } finally {
    missionAbort.delete(missionId)
    missionBusy.delete(missionId)
  }
}

export function createMission(
  agentId: string,
  input: {
    instructions: string
    expected_output?: string
    resources?: string[]
  },
): SentinelMission {
  const agent = getAgent(agentId)
  if (!agent) throw new Error('Sentinela no encontrada')
  if (agent.status === 'inspecting') {
    throw new Error('Todavía está inspeccionando')
  }
  const instructions = input.instructions.trim()
  if (!instructions) throw new Error('Instrucciones vacías')
  const running = listMissions(agentId).find((m) => m.status === 'running')
  if (running) throw new Error('Ya hay una misión en curso; pausala antes')

  const id = randomUUID()
  const ts = nowIso()
  const intro = clip(agent.profile_md.split('\n').slice(0, 8).join('\n'), 1_200)
  getDb()
    .prepare(
      `INSERT INTO sentinel_missions (
        id, agent_id, intro, instructions, resources_json, expected_output,
        status, paused_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    )
    .run(
      id,
      agentId,
      intro,
      instructions,
      JSON.stringify(input.resources ?? []),
      input.expected_output ?? '',
      ts,
      ts,
    )
  insertMessage(id, 'user', instructions)
  logEvent(
    agentId,
    'observation',
    `Misión ${id.slice(0, 8)}: ${instructions.slice(0, 180)}`,
    id,
  )
  void runMission(id)
  return getMission(id)!
}

export function appendMissionMessage(
  missionId: string,
  content: string,
): SentinelMission {
  const text = content.trim()
  if (!text) throw new Error('Mensaje vacío')
  const mission = getMission(missionId)
  if (!mission) throw new Error('Misión no encontrada')
  if (mission.status === 'running') {
    throw new Error('Misión en curso: pausá para hablar')
  }
  insertMessage(missionId, 'user', text)
  getDb()
    .prepare(
      `UPDATE sentinel_missions SET instructions = ?, updated_at = ? WHERE id = ?`,
    )
    .run(text, nowIso(), missionId)
  void runMission(missionId)
  return getMission(missionId)!
}

export function pauseMission(missionId: string): SentinelMission {
  const mission = getMission(missionId)
  if (!mission) throw new Error('Misión no encontrada')
  missionAbort.add(missionId)
  setMissionStatus(missionId, 'paused', { paused_at: nowIso() })
  setAgentStatus(mission.agent_id, 'paused')
  logEvent(mission.agent_id, 'note', 'Pausa del operador', missionId)
  return getMission(missionId)!
}

export function resumeMission(missionId: string): SentinelMission {
  const mission = getMission(missionId)
  if (!mission) throw new Error('Misión no encontrada')
  missionAbort.delete(missionId)
  setMissionStatus(missionId, 'pending', { paused_at: null })
  const lastUser = [...listMessages(missionId)]
    .reverse()
    .find((m) => m.role === 'user')
  if (!lastUser || lastUser.content !== mission.instructions) {
    insertMessage(
      missionId,
      'user',
      `Reanuda. Instrucciones vigentes:\n${mission.instructions}`,
    )
  }
  logEvent(mission.agent_id, 'note', 'Reanuda', missionId)
  void runMission(missionId)
  return getMission(missionId)!
}

export function patchMission(
  missionId: string,
  patch: { instructions?: string; expected_output?: string },
): SentinelMission {
  const mission = getMission(missionId)
  if (!mission) throw new Error('Misión no encontrada')
  const instructions =
    patch.instructions != null
      ? patch.instructions.trim() || mission.instructions
      : mission.instructions
  const expected =
    patch.expected_output != null
      ? patch.expected_output
      : mission.expected_output
  getDb()
    .prepare(
      `UPDATE sentinel_missions
       SET instructions = ?, expected_output = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(instructions, expected, nowIso(), missionId)
  logEvent(
    mission.agent_id,
    'note',
    `Instrucciones actualizadas: ${instructions.slice(0, 240)}`,
    missionId,
  )
  return getMission(missionId)!
}

export function acceptSkill(
  skillId: string,
  opts?: { weight?: number; promote_ida?: boolean },
): SentinelSkill {
  const r = row<SkillRow>(
    getDb().prepare('SELECT * FROM sentinel_skills WHERE id = ?').get(skillId),
  )
  if (!r) throw new Error('Skill no encontrada')
  let weight =
    typeof opts?.weight === 'number' && Number.isFinite(opts.weight)
      ? Math.round(opts.weight)
      : null
  if (weight != null) weight = Math.min(12, Math.max(1, weight))
  let idaId = r.ida_item_id
  if (opts?.promote_ida) {
    const item = createIda({
      title: `Sentinela · ${r.name}`,
      body: `IPO\ninput: ${r.input}\nprocessing: ${r.processing}\noutput: ${r.output}\n\n${JSON.stringify(parseUnknown(r.body_json), null, 2)}`,
      stage: 'investigacion',
      kind: 'organismo',
      agent_ids: ['sentinela'],
      tags: ['sentinela', 'skill'],
      power_indexes: [71],
      weight: weight ?? undefined,
    })
    idaId = item.id
  }
  const ts = nowIso()
  getDb()
    .prepare(
      `UPDATE sentinel_skills
       SET status = 'accepted', weight = ?, ida_item_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(weight, idaId, ts, skillId)
  const skill = mapSkill({
    ...r,
    status: 'accepted',
    weight,
    ida_item_id: idaId,
    updated_at: ts,
  })
  void upsertEmbedding(
    'sentinel_skill',
    skill.id,
    `${skill.name}\n${skill.input}\n${skill.processing}\n${skill.output}`,
  ).catch((err) => console.warn('[sentinela] embed skill', err))
  logEvent(
    r.agent_id,
    'suggestion',
    `Skill aceptada: ${r.name} peso=${weight ?? '—'}`,
  )
  return skill
}

export function rejectSkill(skillId: string): SentinelSkill {
  const r = row<SkillRow>(
    getDb().prepare('SELECT * FROM sentinel_skills WHERE id = ?').get(skillId),
  )
  if (!r) throw new Error('Skill no encontrada')
  const ts = nowIso()
  getDb()
    .prepare(
      `UPDATE sentinel_skills SET status = 'rejected', updated_at = ? WHERE id = ?`,
    )
    .run(ts, skillId)
  return mapSkill({ ...r, status: 'rejected', updated_at: ts })
}

export function agentBundle(id: string): {
  agent: SentinelAgent
  missions: SentinelMission[]
  skills: SentinelSkill[]
  events: SentinelEvent[]
  messages: SentinelMessage[]
  brain: { provider: string; model: string; label: string }
} | null {
  const agent = getAgent(id)
  if (!agent) return null
  const missions = listMissions(id)
  const current = missions[0]
  return {
    agent,
    missions,
    skills: listSkills(id),
    events: listEvents(id),
    messages: current ? listMessages(current.id) : [],
    brain: getSentinelBrain(),
  }
}
