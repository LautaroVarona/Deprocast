import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb, getTrincheraNotebookId } from '../db.js'
import type { DiarizationPayload, DiarizationUtterance } from '../types.js'
import { analyzeAudioSilence } from './audioAnalysis.js'
import { sanitizePersistUrl } from './urlSanitize.js'

const VAULT_ROOT = path.resolve(process.cwd(), 'vault')

export type CofreIngestResult = {
  id: string
  title: string
  status: string
  timestamp_exact: string
}

type ManifestUtterance = {
  speaker?: unknown
  start?: unknown
  end?: unknown
  transcript?: unknown
}

type ManifestBlock = {
  id?: unknown
  text?: unknown
  at?: unknown
  speaker?: unknown
}

type ManifestTab = {
  at?: unknown
  until?: unknown
  url?: unknown
  title?: unknown
  tabId?: unknown
}

type CofreManifest = {
  started_at?: unknown
  ended_at?: unknown
  capture_mode?: unknown
  include_mic?: unknown
  mic_denied?: unknown
  final_blocks?: unknown
  utterances?: unknown
  tab_timeline?: unknown
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const t = Date.parse(value)
  if (Number.isNaN(t)) return fallback
  return new Date(t).toISOString()
}

function asNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function parseUtterances(raw: unknown): DiarizationUtterance[] {
  if (!Array.isArray(raw)) return []
  const out: DiarizationUtterance[] = []
  for (const item of raw as ManifestUtterance[]) {
    if (!item || typeof item !== 'object') continue
    const transcript =
      typeof item.transcript === 'string' ? item.transcript.trim() : ''
    if (!transcript) continue
    const speaker = asNum(item.speaker) ?? 0
    const start = asNum(item.start) ?? 0
    const end = asNum(item.end) ?? start
    out.push({
      speaker,
      start,
      end: end >= start ? end : start,
      transcript,
    })
  }
  return out
}

function parseBlocks(raw: unknown): Array<{ text: string; at: number; speaker?: number }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ text: string; at: number; speaker?: number }> = []
  for (const item of raw as ManifestBlock[]) {
    if (!item || typeof item !== 'object') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    out.push({
      text,
      at: asNum(item.at) ?? Date.now(),
      speaker: asNum(item.speaker) ?? undefined,
    })
  }
  return out
}

function parseTabs(raw: unknown): Array<{
  at: number
  until: number | null
  url: string
  title: string
  tabId: number
}> {
  if (!Array.isArray(raw)) return []
  const out: Array<{
    at: number
    until: number | null
    url: string
    title: string
    tabId: number
  }> = []
  for (const item of raw as ManifestTab[]) {
    if (!item || typeof item !== 'object') continue
    const url = sanitizePersistUrl(typeof item.url === 'string' ? item.url : '')
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue
    out.push({
      at: asNum(item.at) ?? Date.now(),
      until: asNum(item.until),
      url: clip(url, 2000),
      title: clip(typeof item.title === 'string' ? item.title : '', 200),
      tabId: asNum(item.tabId) ?? -1,
    })
  }
  return out
}

function parseManifest(raw: string): CofreManifest {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('manifest inválido')
  }
  return parsed as CofreManifest
}

function buildTranscript(
  utterances: DiarizationUtterance[],
  blocks: Array<{ text: string }>,
): string {
  if (utterances.length > 0) {
    return utterances.map((u) => u.transcript.trim()).filter(Boolean).join('\n')
  }
  return blocks.map((b) => b.text.trim()).filter(Boolean).join('\n')
}

function formatTitle(startedAt: string): string {
  const d = new Date(startedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Cofre ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export async function ingestCofre(opts: {
  audioPath: string
  originalFilename: string
  manifestRaw: string
}): Promise<CofreIngestResult> {
  const now = new Date()
  const nowIso = now.toISOString()
  const manifest = parseManifest(opts.manifestRaw)
  const startedAt = asIso(manifest.started_at, nowIso)
  const endedAt = asIso(manifest.ended_at, nowIso)
  const utterances = parseUtterances(manifest.utterances)
  const blocks = parseBlocks(manifest.final_blocks)
  const tabs = parseTabs(manifest.tab_timeline)
  const captureMode =
    manifest.capture_mode === 'tab' || manifest.capture_mode === 'desktop'
      ? manifest.capture_mode
      : 'desktop'

  if (utterances.length === 0 && blocks.length > 0) {
    const t0 = Date.parse(startedAt)
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!
      const start = Number.isNaN(t0) ? 0 : Math.max(0, (b.at - t0) / 1000)
      const next = blocks[i + 1]
      const end = next
        ? Math.max(start, (next.at - t0) / 1000)
        : start + 2
      utterances.push({
        speaker: b.speaker ?? 0,
        start,
        end,
        transcript: b.text,
      })
    }
  }

  const content = buildTranscript(utterances, blocks)
  const speakers = [...new Set(utterances.map((u) => u.speaker))].sort(
    (a, b) => a - b,
  )
  if (speakers.length === 0) speakers.push(0)
  const diarization: DiarizationPayload = { utterances, speakers }
  const speakerMap = speakers.map((speaker) => ({
    speaker,
    person_id: null,
    person_name: null,
  }))

  const durationFromClock = Math.max(
    0,
    (Date.parse(endedAt) - Date.parse(startedAt)) / 1000,
  )
  const uniqueUrls = new Set(tabs.map((t) => t.url)).size
  const operatorNote = [
    `El Cofre · captura ${captureMode}`,
    `${Math.round(durationFromClock / 60)} min`,
    `${uniqueUrls} pestaña${uniqueUrls === 1 ? '' : 's'}`,
    `${utterances.length || blocks.length} bloques STT`,
    manifest.include_mic ? 'mic on' : 'mic off',
    manifest.mic_denied ? 'mic denegado' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const entryId = randomUUID()
  const originalName = path.basename(opts.originalFilename).replace(
    /[<>:"|?*]/g,
    '_',
  )
  const safeName = originalName || `cofre-${entryId.slice(0, 8)}.webm`
  const dir = path.join(VAULT_ROOT, entryId)
  fs.mkdirSync(dir, { recursive: true })
  const absAudio = path.join(dir, safeName)
  fs.renameSync(opts.audioPath, absAudio)

  const vaultPath = path.relative(process.cwd(), absAudio).split(path.sep).join('/')
  const sidecar = {
    started_at: startedAt,
    ended_at: endedAt,
    capture_mode: captureMode,
    include_mic: Boolean(manifest.include_mic),
    mic_denied: Boolean(manifest.mic_denied),
    final_blocks: blocks,
    utterances,
    tab_timeline: tabs,
  }
  fs.writeFileSync(
    path.join(dir, 'cofre.json'),
    `${JSON.stringify(sidecar, null, 2)}\n`,
    'utf8',
  )

  const title = formatTitle(startedAt)
  const db = getDb()
  const notebookId = getTrincheraNotebookId()

  db.prepare(
    `INSERT INTO entries (
      id, notebook_id, source_type, title, content_raw,
      vault_path, timestamp_exact, status, created_at, title_manual,
      original_filename, batch_id, manual_tags, operator_note,
      diarization_json, speaker_map, duration_sec
    ) VALUES (?, ?, 'audio', ?, ?, ?, ?, 'pending_criba', ?, 0, ?, ?, '[]', ?, ?, ?, ?)`,
  ).run(
    entryId,
    notebookId,
    title,
    content || null,
    vaultPath,
    startedAt,
    nowIso,
    safeName,
    randomUUID(),
    operatorNote,
    JSON.stringify(diarization),
    JSON.stringify(speakerMap),
    durationFromClock || null,
  )

  console.log(`[ingest/cofre] «${title}» → ${entryId}`)

  void analyzeAudioSilence(absAudio, utterances)
    .then((analysis) => {
      if (!analysis) return
      getDb()
        .prepare(
          `UPDATE entries
           SET audio_analysis_json = ?,
               duration_sec = COALESCE(?, duration_sec)
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(analysis),
          analysis.duration_sec,
          entryId,
        )
    })
    .catch((err: unknown) => {
      console.warn('[ingest/cofre] analysis', err)
    })

  return {
    id: entryId,
    title,
    status: 'pending_criba',
    timestamp_exact: startedAt,
  }
}
