/**
 * Análisis de audio para criba: detección de silencios (ffmpeg) y mejora opcional.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { DiarizationUtterance } from '../types.js'
import { probeAudioDurationSec } from './audioSplit.js'
import { whichFfmpeg } from './instagramMedia.js'

export type TimeRegion = { start: number; end: number }

export type AudioAnalysisPayload = {
  silence_regions: TimeRegion[]
  speech_regions: TimeRegion[]
  duration_sec: number | null
  analyzed_at: string
  enhanced_available?: boolean
}

function env(key: string, fallback: string): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

function envNum(key: string, fallback: number): number {
  const raw = env(key, String(fallback))
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function silenceDetectOpts(): { noiseDb: number; minSec: number } {
  return {
    noiseDb: envNum('AUDIO_SILENCE_NOISE_DB', -35),
    minSec: envNum('AUDIO_SILENCE_MIN_SEC', 3),
  }
}

export function enhanceOnIngest(): boolean {
  return env('AUDIO_ENHANCE_ON_INGEST', '0') === '1'
}

function runCmd(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    const timer =
      opts?.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGTERM')
            reject(
              new Error(`${path.basename(cmd)} timeout ${opts.timeoutMs}ms`),
            )
          }, opts.timeoutMs)
        : null
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

/** Parsea salida de silencedetect de ffmpeg. */
export function parseSilenceDetectOutput(stderr: string): TimeRegion[] {
  const regions: TimeRegion[] = []
  let pendingStart: number | null = null
  for (const line of stderr.split('\n')) {
    const startM = line.match(/silence_start:\s*([\d.]+)/)
    if (startM) {
      pendingStart = Number(startM[1])
      continue
    }
    const endM = line.match(/silence_end:\s*([\d.]+)/)
    if (endM && pendingStart != null) {
      const end = Number(endM[1])
      if (Number.isFinite(pendingStart) && Number.isFinite(end) && end > pendingStart) {
        regions.push({ start: pendingStart, end })
      }
      pendingStart = null
    }
  }
  return mergeRegions(regions, 0.05)
}

function mergeRegions(regions: TimeRegion[], gapSec: number): TimeRegion[] {
  if (regions.length === 0) return []
  const sorted = [...regions].sort((a, b) => a.start - b.start)
  const out: TimeRegion[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]!
    const cur = sorted[i]!
    if (cur.start <= prev.end + gapSec) {
      prev.end = Math.max(prev.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/** Gaps entre utterances de Deepgram que superan minSec. */
export function utteranceGapSilences(
  utterances: DiarizationUtterance[],
  minSec: number,
): TimeRegion[] {
  if (utterances.length < 2) return []
  const sorted = [...utterances].sort((a, b) => a.start - b.start)
  const gaps: TimeRegion[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    const gapStart = prev.end
    const gapEnd = cur.start
    if (gapEnd - gapStart >= minSec) {
      gaps.push({ start: gapStart, end: gapEnd })
    }
  }
  return gaps
}

/** Invierte regiones de silencio → regiones de habla. */
export function buildSpeechRegions(
  silenceRegions: TimeRegion[],
  durationSec: number | null,
  utterances?: DiarizationUtterance[],
): TimeRegion[] {
  const minSec = silenceDetectOpts().minSec
  const mergedSilence = mergeRegions(
    [
      ...silenceRegions,
      ...(utterances ? utteranceGapSilences(utterances, minSec) : []),
    ],
    0.15,
  )

  const dur =
    durationSec ??
    (mergedSilence.length > 0
      ? mergedSilence[mergedSilence.length - 1]!.end + 1
      : utterances && utterances.length > 0
        ? Math.max(...utterances.map((u) => u.end)) + 0.5
        : 0)

  if (dur <= 0) {
    if (utterances && utterances.length > 0) {
      return utterances.map((u) => ({ start: u.start, end: u.end }))
    }
    return []
  }

  const speech: TimeRegion[] = []
  let cursor = 0
  for (const s of mergedSilence) {
    if (s.start > cursor + 0.05) {
      speech.push({ start: cursor, end: s.start })
    }
    cursor = Math.max(cursor, s.end)
  }
  if (cursor < dur - 0.05) {
    speech.push({ start: cursor, end: dur })
  }

  return mergeRegions(
    speech.filter((r) => r.end - r.start >= 0.1),
    0.2,
  )
}

export async function detectSilenceRegions(
  absPath: string,
  opts?: { noiseDb?: number; minSec?: number },
): Promise<TimeRegion[]> {
  const ffmpeg = await whichFfmpeg()
  if (!ffmpeg) {
    console.warn('[audio-analysis] ffmpeg no disponible para silencedetect')
    return []
  }

  const { noiseDb, minSec } = { ...silenceDetectOpts(), ...opts }
  const cwd = path.isAbsolute(ffmpeg) ? path.dirname(ffmpeg) : undefined
  const filter = `silencedetect=noise=${noiseDb}dB:d=${minSec}`

  try {
    const r = await runCmd(
      ffmpeg,
      ['-i', absPath, '-af', filter, '-f', 'null', '-'],
      { timeoutMs: 600_000, cwd },
    )
    return parseSilenceDetectOutput(`${r.stderr}\n${r.stdout}`)
  } catch (err) {
    console.warn('[audio-analysis] silencedetect failed:', err)
    return []
  }
}

export async function analyzeAudioSilence(
  absPath: string,
  utterances?: DiarizationUtterance[],
): Promise<AudioAnalysisPayload | null> {
  if (!fs.existsSync(absPath)) return null

  const durationSec = await probeAudioDurationSec(absPath)
  const silence_regions = await detectSilenceRegions(absPath)
  const speech_regions = buildSpeechRegions(
    silence_regions,
    durationSec,
    utterances,
  )

  return {
    silence_regions,
    speech_regions,
    duration_sec: durationSec,
    analyzed_at: new Date().toISOString(),
  }
}

export function enhancedAudioPath(entryVaultPath: string): string {
  const abs = path.resolve(process.cwd(), entryVaultPath)
  return path.join(path.dirname(abs), 'enhanced.m4a')
}

const ENHANCE_FILTER =
  'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=5:release=50,loudnorm=I=-16:TP=-1.5'

export async function enhanceAudio(
  absPath: string,
  outPath: string,
): Promise<boolean> {
  const ffmpeg = await whichFfmpeg()
  if (!ffmpeg) {
    console.warn('[audio-analysis] ffmpeg no disponible para enhance')
    return false
  }
  if (!fs.existsSync(absPath)) return false

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const cwd = path.isAbsolute(ffmpeg) ? path.dirname(ffmpeg) : undefined

  try {
    const r = await runCmd(
      ffmpeg,
      [
        '-y',
        '-i',
        absPath,
        '-af',
        ENHANCE_FILTER,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        outPath,
      ],
      { timeoutMs: 900_000, cwd },
    )
    if (r.code !== 0 || !fs.existsSync(outPath)) {
      console.warn('[audio-analysis] enhance failed:', r.stderr.slice(0, 400))
      return false
    }
    return true
  } catch (err) {
    console.warn('[audio-analysis] enhance error:', err)
    return false
  }
}

export async function ensureEnhancedAudio(
  entryVaultPath: string,
): Promise<string | null> {
  const abs = path.resolve(process.cwd(), entryVaultPath)
  const out = enhancedAudioPath(entryVaultPath)
  if (fs.existsSync(out)) return out
  const ok = await enhanceAudio(abs, out)
  return ok ? out : null
}

export function parseAudioAnalysis(
  raw: string | null | undefined,
): AudioAnalysisPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AudioAnalysisPayload
    if (!parsed || !Array.isArray(parsed.speech_regions)) return null
    return parsed
  } catch {
    return null
  }
}
