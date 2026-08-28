import type { DiarizationUtterance } from '../types'

export type TranscriptBlock = {
  speaker: number
  start: number
  end: number
  text: string
}

const SPEAKER_RE = /\[Speaker\s+(\d+)\]/gi

const STOP = new Set([
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'un',
  'una',
  'y',
  'o',
  'que',
  'en',
  'a',
  'por',
  'con',
  'es',
  'se',
  'no',
  'si',
  'al',
  'lo',
  'su',
  'yo',
  'me',
  'mi',
  'tu',
  'te',
  'le',
  'les',
  'nos',
  'ya',
  'pero',
  'como',
  'mas',
  'más',
  'este',
  'esta',
  'esto',
  'hay',
  'son',
  'fue',
  'era',
  'the',
  'and',
  'for',
  'of',
  'to',
  'in',
  'on',
  'is',
  'it',
  'that',
  'this',
  'with',
  'speaker',
])

export function stripSpeakerTags(text: string): string {
  return text.replace(/\[Speaker\s+\d+\]\s*/gi, '').trim()
}

export function parseSpeakerTagged(
  raw: string,
): Array<{ speaker: number; text: string }> {
  const text = raw.replace(/\r\n/g, '\n')
  if (!text.trim()) return []
  const matches = [...text.matchAll(SPEAKER_RE)]
  if (matches.length === 0) {
    return [{ speaker: 0, text: text.trim() }]
  }
  const out: Array<{ speaker: number; text: string }> = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const speaker = Number(m[1])
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length
    out.push({ speaker, text: text.slice(start, end).trim() })
  }
  return out
}

export function serializeTranscriptBlocks(
  blocks: Array<{ speaker: number; text: string }>,
): string {
  const lines: string[] = []
  let last = -1
  for (const u of blocks) {
    const t = u.text.trim()
    if (!t) continue
    if (u.speaker !== last) {
      lines.push(`\n[Speaker ${u.speaker}] ${t}`)
      last = u.speaker
    } else {
      lines.push(t)
    }
  }
  return lines.join('\n').trim()
}

export function blocksFromDiarization(
  utterances: DiarizationUtterance[],
  contentRaw: string,
): TranscriptBlock[] {
  const dia: TranscriptBlock[] = utterances.map((u) => ({
    speaker: u.speaker,
    start: u.start,
    end: u.end,
    text: stripSpeakerTags(u.transcript),
  }))
  if (dia.length === 0) {
    const parsed = parseSpeakerTagged(contentRaw)
    if (parsed.length === 0) {
      return [{ speaker: 0, start: 0, end: 0, text: contentRaw }]
    }
    return parsed.map((p) => ({ ...p, start: 0, end: 0 }))
  }
  const parsed = parseSpeakerTagged(contentRaw)
  if (parsed.length === dia.length) {
    return dia.map((u, i) => ({
      ...u,
      speaker: parsed[i]?.speaker ?? u.speaker,
      text: parsed[i]?.text ?? u.text,
    }))
  }
  return dia
}

export function activeBlockIndex(blocks: TranscriptBlock[], time: number): number {
  if (blocks.length === 0) return -1
  const timed = blocks.some((b) => b.end > b.start)
  if (!timed) return -1
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (time >= b.start && time < Math.max(b.end, b.start + 0.05)) return i
  }
  let best = 0
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.start <= time) best = i
  }
  return best
}

export function extractNameCandidates(text: string): string[] {
  const clean = stripSpeakerTags(text)
  const found = new Set<string>()

  for (const m of clean.matchAll(
    /@((?:[\p{L}0-9][\wÀ-ÿ'’.-]*)(?:[ \t]+[\p{Lu}][\p{L}'’.-]*){0,4})/gu,
  )) {
    const q = m[1]!.trim().replace(/[.,;:!?]+$/u, '')
    if (q.length >= 2) found.add(q)
  }

  const capRe =
    /(?:^|[^\p{L}])([\p{Lu}][\p{L}'’.-]*(?:[ \t]+[\p{Lu}][\p{L}'’.-]*){1,4})/gu
  for (const m of clean.matchAll(capRe)) {
    const s = m[1]!.trim()
    const words = s.split(/\s+/)
    if (words.some((w) => STOP.has(w.toLowerCase()))) continue
    if (s.length >= 4 && s.length <= 48) found.add(s)
  }

  return [...found].slice(0, 16)
}

export function autosizeTextarea(ta: HTMLTextAreaElement | null) {
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.height = `${Math.max(ta.scrollHeight, 28)}px`
}
