import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { formatDuration, useSmartAudioPlayback } from '../hooks/useSmartAudioPlayback'
import {
  activeBlockIndex,
  autosizeTextarea,
  blocksFromDiarization,
  extractNameCandidates,
  serializeTranscriptBlocks,
  type TranscriptBlock,
} from '../lib/audioTranscript'
import { getTextareaCaretRect } from '../lib/textareaCaret'
import { api } from '../services/api'
import type {
  AudioAnalysisPayload,
  BookmarkManualTag,
  DiarizationPayload,
  Entry,
  SpeakerAssignment,
} from '../types'
import { mentionKindLabel, MentionMenu, type MentionMenuHit } from './MentionMenu'
import { SpeakerBadge } from './SpeakerBadge'
import { TagField } from './TagField'

type Props = {
  refreshKey: number
  onChanged: () => void
}

type OperatorInfo = { id: string; name: string }

const TAG_KINDS: BookmarkManualTag['kind'][] = [
  'person',
  'project',
  'dominio',
  'agrupacion',
  'geografia',
]

function isTagKind(v: string): v is BookmarkManualTag['kind'] {
  return (TAG_KINDS as string[]).includes(v)
}

function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && /[\wÀ-ÿ]/.test(before[at - 1] ?? '')) return null
  const fragment = before.slice(at + 1)
  if (/[\s\n]/.test(fragment)) return null
  if (fragment.length > 48) return null
  return { start: at, query: fragment }
}

function keyToWeight(e: KeyboardEvent): number | null {
  const k = e.key
  if (k >= '1' && k <= '9') return Number(k)
  if (k === '0' || k === 'q' || k === 'Q') return 10
  if (k === "'" || k === '.' || k === 'w' || k === 'W') return 11
  if (k === '¡' || k === 'Enter' || k === 'e' || k === 'E') return 12
  return null
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function parseTags(raw: string | null | undefined): BookmarkManualTag[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is BookmarkManualTag =>
        !!t &&
        typeof t === 'object' &&
        isTagKind(String((t as BookmarkManualTag).kind)) &&
        typeof (t as BookmarkManualTag).entity_id === 'string' &&
        typeof (t as BookmarkManualTag).entity_name === 'string',
    )
  } catch {
    return []
  }
}

function parseSpeakerMap(raw: string | null | undefined): SpeakerAssignment[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is SpeakerAssignment =>
        !!s && typeof s === 'object' && Number.isFinite(Number(s.speaker)),
    )
  } catch {
    return []
  }
}

function parseDiarization(raw: string | null | undefined): DiarizationPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DiarizationPayload
    if (!parsed || !Array.isArray(parsed.utterances)) return null
    return parsed
  } catch {
    return null
  }
}

function parseAnalysis(raw: string | null | undefined): AudioAnalysisPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AudioAnalysisPayload
    if (!parsed || !Array.isArray(parsed.speech_regions)) return null
    return parsed
  } catch {
    return null
  }
}

function tagKey(t: BookmarkManualTag): string {
  return `${t.kind}:${t.entity_id}`
}

function AudioTimeline({
  analysis,
  currentTime,
  onSeek,
}: {
  analysis: AudioAnalysisPayload
  currentTime: number
  onSeek: (sec: number) => void
}) {
  const total =
    analysis.duration_sec ??
    Math.max(
      0,
      ...analysis.speech_regions.map((r) => r.end),
      ...analysis.silence_regions.map((r) => r.end),
    )
  if (total <= 0) return null

  const segments = useMemo(() => {
    type Seg = { start: number; end: number; kind: 'speech' | 'silence' }
    const merged: Seg[] = [
      ...analysis.speech_regions.map((r) => ({
        start: r.start,
        end: r.end,
        kind: 'speech' as const,
      })),
      ...analysis.silence_regions.map((r) => ({
        start: r.start,
        end: r.end,
        kind: 'silence' as const,
      })),
    ].sort((a, b) => a.start - b.start)
    return merged
  }, [analysis])

  const playheadPct = Math.min(100, Math.max(0, (currentTime / total) * 100))

  return (
    <div
      className="audio-timeline"
      role="slider"
      aria-label="Línea de tiempo del audio"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={currentTime}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = (e.clientX - rect.left) / rect.width
        onSeek(Math.max(0, Math.min(total, ratio * total)))
      }}
    >
      <div className="audio-timeline-track">
        {segments.map((seg, i) => {
          const widthPct = ((seg.end - seg.start) / total) * 100
          const leftPct = (seg.start / total) * 100
          return (
            <div
              key={`${seg.kind}-${seg.start}-${i}`}
              className={`audio-timeline-seg is-${seg.kind}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
          )
        })}
        <div className="audio-timeline-playhead" style={{ left: `${playheadPct}%` }} />
      </div>
    </div>
  )
}

export function AudioCribaPanel({ refreshKey, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [operator, setOperator] = useState<OperatorInfo | null>(null)
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [timestamp, setTimestamp] = useState('')
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([])
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<BookmarkManualTag[]>([])
  const [speakers, setSpeakers] = useState<SpeakerAssignment[]>([])
  const [analysis, setAnalysis] = useState<AudioAnalysisPayload | null>(null)

  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionHits, setMentionHits] = useState<MentionMenuHit[]>([])
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionBusy, setMentionBusy] = useState(false)
  const [mentionBlock, setMentionBlock] = useState<number | null>(null)
  const [mentionRange, setMentionRange] = useState<{
    start: number
    end: number
  } | null>(null)
  const [mentionAnchor, setMentionAnchor] = useState<{
    top: number
    left: number
    height: number
  } | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const blockTaRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const blockEls = useRef<(HTMLElement | null)[]>([])
  const loadInFlight = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef<Entry | null>(null)
  const analysisRequested = useRef<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbort = useRef<AbortController | null>(null)
  const autoAbort = useRef<AbortController | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissedAuto = useRef<Set<string>>(new Set())
  const autoKeys = useRef<Set<string>>(new Set())
  const suppressPersist = useRef(true)

  const active = entries[idx] ?? null
  activeRef.current = active

  const transcript = useMemo(() => serializeTranscriptBlocks(blocks), [blocks])

  const requestAnalysis = useCallback(async () => {
    const entry = activeRef.current
    if (!entry || analysisBusy) return
    if (analysisRequested.current === entry.id) return
    analysisRequested.current = entry.id
    setAnalysisBusy(true)
    try {
      const { analysis: next } = await api.getEntryAudioAnalysis(entry.id)
      setAnalysis(next)
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? {
                ...e,
                audio_analysis_json: JSON.stringify(next),
                duration_sec: next.duration_sec ?? e.duration_sec,
              }
            : e,
        ),
      )
    } catch {
      analysisRequested.current = null
    } finally {
      setAnalysisBusy(false)
    }
  }, [analysisBusy])

  const playback = useSmartAudioPlayback(audioRef, {
    analysis,
    entryId: active?.id ?? null,
    onRequestAnalysis: () => void requestAnalysis(),
  })

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const data = await api.getCribaAudios()
      setEntries(data.entries)
      setOperator(data.operator)
      setIdx((prev) => {
        if (data.entries.length === 0) return 0
        const keepId = activeRef.current?.id
        if (keepId) {
          const found = data.entries.findIndex((e) => e.id === keepId)
          if (found >= 0) return found
        }
        if (prev >= data.entries.length) return 0
        return prev
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar criba')
    } finally {
      loadInFlight.current = false
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    const id = window.setInterval(() => void load({ silent: true }), 5000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    analysisRequested.current = null
    dismissedAuto.current = new Set()
    autoKeys.current = new Set()
    suppressPersist.current = true
    setMentionOpen(false)
    setMentionHits([])
    setMentionRange(null)
    setMentionBlock(null)
    if (!active) {
      setTitle('')
      setTimestamp('')
      setBlocks([])
      setNote('')
      setTags([])
      setSpeakers([])
      setAnalysis(null)
      return
    }
    setTitle(active.title)
    setTimestamp(toDatetimeLocal(active.timestamp_exact))
    const dia = parseDiarization(active.diarization_json)
    setBlocks(blocksFromDiarization(dia?.utterances ?? [], active.content_raw ?? ''))
    setNote(active.operator_note ?? '')
    setTags(parseTags(active.manual_tags))
    setAnalysis(parseAnalysis(active.audio_analysis_json))
    const mapped = parseSpeakerMap(active.speaker_map)
    if (mapped.length > 0) {
      setSpeakers(mapped)
    } else if (dia?.speakers?.length) {
      setSpeakers(
        dia.speakers.map((speaker) => ({
          speaker,
          person_id: null,
          person_name: null,
        })),
      )
    } else {
      setSpeakers([{ speaker: 0, person_id: null, person_name: null }])
    }
    const t = window.setTimeout(() => {
      suppressPersist.current = false
    }, 120)
    return () => window.clearTimeout(t)
  }, [active?.id])

  const personTags = useMemo(
    () => tags.filter((t) => t.kind === 'person'),
    [tags],
  )

  const taggedIds = useMemo(
    () => new Set(tags.map((t) => tagKey(t))),
    [tags],
  )

  const karaokeIdx = useMemo(
    () => activeBlockIndex(blocks, playback.currentTime),
    [blocks, playback.currentTime],
  )

  useEffect(() => {
    const el = karaokeIdx >= 0 ? blockEls.current[karaokeIdx] : null
    if (!el) return
    const focused = document.activeElement
    if (
      focused instanceof HTMLTextAreaElement &&
      !el.contains(focused)
    ) {
      return
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [karaokeIdx])

  useEffect(() => {
    blockTaRefs.current.forEach((ta) => autosizeTextarea(ta))
  }, [blocks.length, active?.id])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchAbort.current?.abort()
      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoAbort.current?.abort()
    }
  }, [])

  const runMentionSearch = useCallback((query: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchAbort.current?.abort()
    if (!query.trim()) {
      setMentionBusy(false)
      return
    }
    setMentionBusy(true)
    searchTimer.current = setTimeout(() => {
      const ac = new AbortController()
      searchAbort.current = ac
      void (async () => {
        try {
          const res = await api.typeaheadEntities(query, {
            kinds: TAG_KINDS,
            limit: 10,
            scope: 'masters',
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          const hits: MentionMenuHit[] = res.results
            .filter((h): h is typeof h & { kind: BookmarkManualTag['kind'] } =>
              isTagKind(h.kind),
            )
            .map((h) => ({
              kind: h.kind,
              entity_id: h.id,
              entity_name: h.label,
              subtitle: h.subtitle,
            }))
          setMentionHits(hits)
          setMentionIdx(0)
        } catch {
          if (!ac.signal.aborted) setMentionHits([])
        } finally {
          if (!ac.signal.aborted) setMentionBusy(false)
        }
      })()
    }, 150)
  }, [])

  const applyTranscriptMention = useCallback(
    (hit: MentionMenuHit, multi = false) => {
      if (mentionBlock == null || !mentionRange) return
      if (!isTagKind(hit.kind)) return
      const block = blocks[mentionBlock]
      const ta = blockTaRefs.current[mentionBlock]
      if (!block || !ta) return
      const before = block.text.slice(0, mentionRange.start)
      const after = block.text.slice(mentionRange.end)
      const insert = multi ? `@${hit.entity_name} @` : `@${hit.entity_name} `
      const nextText = `${before}${insert}${after}`
      const nextTags = [
        ...tags.filter(
          (t) => !(t.kind === hit.kind && t.entity_id === hit.entity_id),
        ),
        {
          kind: hit.kind,
          entity_id: hit.entity_id,
          entity_name: hit.entity_name,
        } satisfies BookmarkManualTag,
      ]
      setBlocks((prev) =>
        prev.map((b, i) => (i === mentionBlock ? { ...b, text: nextText } : b)),
      )
      setTags(nextTags)
      setMentionOpen(false)
      setMentionHits([])
      setMentionRange(null)
      requestAnimationFrame(() => {
        const pos = before.length + insert.length
        ta.focus()
        ta.setSelectionRange(pos, pos)
        autosizeTextarea(ta)
        if (multi) {
          const q = mentionQueryAt(nextText, pos)
          if (q) {
            setMentionOpen(true)
            setMentionRange({ start: q.start, end: pos })
            setMentionAnchor(getTextareaCaretRect(ta, pos))
            runMentionSearch(q.query)
          }
        }
      })
    },
    [mentionBlock, mentionRange, blocks, tags, runMentionSearch],
  )

  const onBlockChange = (blockIdx: number, value: string) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === blockIdx ? { ...b, text: value } : b)),
    )
    const ta = blockTaRefs.current[blockIdx]
    autosizeTextarea(ta)
    const caret = ta?.selectionStart ?? value.length
    const q = mentionQueryAt(value, caret)
    if (!q) {
      setMentionOpen(false)
      setMentionHits([])
      setMentionRange(null)
      setMentionBlock(null)
      return
    }
    setMentionBlock(blockIdx)
    setMentionOpen(true)
    setMentionRange({ start: q.start, end: caret })
    if (ta) setMentionAnchor(getTextareaCaretRect(ta, caret))
    runMentionSearch(q.query)
  }

  const onBlockKeyDown = (
    e: ReactKeyboardEvent<HTMLTextAreaElement>,
    blockIdx: number,
  ) => {
    if (!mentionOpen || mentionBlock !== blockIdx) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (mentionHits.length > 0) {
        setMentionIdx((i) => (i + 1) % mentionHits.length)
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (mentionHits.length > 0) {
        setMentionIdx((i) => (i - 1 + mentionHits.length) % mentionHits.length)
      }
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && mentionHits.length > 0) {
      e.preventDefault()
      applyTranscriptMention(mentionHits[mentionIdx]!, e.ctrlKey || e.metaKey)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMentionOpen(false)
    }
  }

  useEffect(() => {
    if (!active || mentionOpen) return
    const corpus = `${transcript}\n${note}`
    const candidates = extractNameCandidates(corpus)
    if (candidates.length === 0) return
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoAbort.current?.abort()
    autoTimer.current = setTimeout(() => {
      const ac = new AbortController()
      autoAbort.current = ac
      void (async () => {
        const found: BookmarkManualTag[] = []
        for (const q of candidates) {
          if (ac.signal.aborted) return
          try {
            const res = await api.typeaheadEntities(q, {
              kinds: TAG_KINDS,
              limit: 3,
              scope: 'masters',
              signal: ac.signal,
            })
            const hit = res.results.find((h) => isTagKind(h.kind))
            if (!hit || !isTagKind(hit.kind)) continue
            const short = q.trim().length < 5
            if (short && hit.score < 0.92) continue
            if (hit.score < 0.72) continue
            const key = `${hit.kind}:${hit.id}`
            if (dismissedAuto.current.has(key)) continue
            found.push({
              kind: hit.kind,
              entity_id: hit.id,
              entity_name: hit.label,
            })
          } catch {
            /* ignore */
          }
        }
        if (ac.signal.aborted || found.length === 0) return
        setTags((prev) => {
          const seen = new Set(prev.map(tagKey))
          const add = found.filter((t) => !seen.has(tagKey(t)))
          if (add.length === 0) return prev
          return [...prev, ...add]
        })
        for (const t of found) autoKeys.current.add(tagKey(t))
      })()
    }, 480)
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoAbort.current?.abort()
    }
  }, [active, transcript, note, mentionOpen])

  const operatorTag = useMemo((): BookmarkManualTag | null => {
    if (!operator) return null
    return { kind: 'person', entity_id: operator.id, entity_name: operator.name }
  }, [operator])

  const suggestOperatorForSpeaker = useMemo(() => {
    if (!operator || speakers.length !== 1) return false
    const s = speakers[0]
    return !s?.person_id
  }, [operator, speakers])

  const cribaPatch = useCallback(
    (entry: Entry) => ({
      content_raw: transcript,
      operator_note: note,
      manual_tags: tags,
      speaker_map: speakers,
      title: title.trim() || entry.title,
      timestamp_exact: fromDatetimeLocal(timestamp) ?? undefined,
    }),
    [transcript, note, tags, speakers, title, timestamp],
  )

  useEffect(() => {
    if (suppressPersist.current || !activeRef.current) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      const entry = activeRef.current
      if (!entry || suppressPersist.current) return
      void api.patchAudioCriba(entry.id, cribaPatch(entry)).catch(() => {
        /* el voto persiste el mismo payload */
      })
    }, 800)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [cribaPatch])

  const vote = useCallback(
    async (weight: number) => {
      if (!active || busy) return
      if (persistTimer.current) {
        clearTimeout(persistTimer.current)
        persistTimer.current = null
      }
      setBusy(true)
      setError(null)
      try {
        await api.voteAudioCriba(active.id, weight, cribaPatch(active))
        onChanged()
        setEntries((prev) => prev.filter((e) => e.id !== active.id))
        setIdx(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo votar')
      } finally {
        setBusy(false)
      }
    },
    [active, busy, cribaPatch, onChanged],
  )

  const seekRel = useCallback(
    (dir: 1 | -1) => {
      const t = playback.currentTime
      const timed = blocks.filter((b) => b.end > b.start)
      if (timed.length === 0) {
        if (dir === 1) playback.nextSegment()
        else playback.prevSegment()
        return
      }
      if (dir === 1) {
        const next = timed.find((b) => b.start >= t + 0.15)
        if (next) playback.seekTo(next.start)
        else playback.nextSegment()
        return
      }
      let prev: TranscriptBlock | null = null
      for (const b of timed) {
        if (b.start >= t - 0.2) break
        prev = b
      }
      if (prev) playback.seekTo(prev.start)
      else playback.prevSegment()
    },
    [blocks, playback],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (t?.closest('.mention-pop, .speaker-pop')) return
      if (mentionOpen) return
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (t?.isContentEditable) return

      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        seekRel(1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        seekRel(-1)
        return
      }

      const w = keyToWeight(e)
      if (w == null) return
      e.preventDefault()
      void vote(w)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vote, seekRel, mentionOpen])

  function assignSpeaker(speaker: number, tag: BookmarkManualTag | null) {
    setSpeakers((prev) =>
      prev.map((s) =>
        s.speaker === speaker
          ? {
              speaker,
              person_id: tag?.entity_id ?? null,
              person_name: tag?.entity_name ?? null,
            }
          : s,
      ),
    )
    if (tag?.kind === 'person') {
      setTags((prev) => {
        if (prev.some((t) => t.kind === 'person' && t.entity_id === tag.entity_id)) {
          return prev
        }
        return [...prev, tag]
      })
    }
  }

  function assignmentFor(speaker: number): SpeakerAssignment | undefined {
    return speakers.find((s) => s.speaker === speaker)
  }

  function removeTag(tag: BookmarkManualTag) {
    const key = tagKey(tag)
    dismissedAuto.current.add(key)
    autoKeys.current.delete(key)
    setTags((prev) =>
      prev.filter((t) => !(t.kind === tag.kind && t.entity_id === tag.entity_id)),
    )
  }

  function focusTagInTranscript(tag: BookmarkManualTag) {
    const needle = tag.entity_name.trim().toLowerCase()
    if (!needle) return
    const i = blocks.findIndex((b) => b.text.toLowerCase().includes(needle))
    if (i < 0) return
    const el = blockEls.current[i]
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const b = blocks[i]
    if (b && b.end > b.start) playback.seekTo(b.start)
    blockTaRefs.current[i]?.focus()
  }

  if (loading && entries.length === 0) {
    return <p className="muted empty">Cargando criba de audios…</p>
  }

  if (!active) {
    return (
      <p className="muted empty">
        No hay audios en criba. Subí un lote en Zona franca; tras el STT aparecen acá.
      </p>
    )
  }

  return (
    <div className="audio-criba">
      <div className="audio-criba-identity">
        <p className="criba-counter audio-criba-counter">
          <span className="mono">
            {idx + 1}/{entries.length}
          </span>
        </p>
        <label className="field">
          <span className="field-label-row">
            <span>Nombre</span>
            {active.original_filename ? (
              <span className="og-filename" title={active.original_filename}>
                (og: &quot;{active.original_filename}&quot;)
              </span>
            ) : null}
          </span>
          <input
            type="text"
            className="title-input"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Fecha y hora</span>
          <input
            type="datetime-local"
            value={timestamp}
            disabled={busy}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="status-line err">{error}</p>}

      <div className="audio-criba-player">
        <audio ref={audioRef} key={active.id} controls preload="metadata" />
        <div className="audio-criba-player-tools">
          <label className="audio-criba-toggle">
            <input
              type="checkbox"
              checked={playback.skipSilence}
              onChange={(e) => playback.setSkipSilence(e.target.checked)}
            />
            Saltar silencios
          </label>
          <label className="audio-criba-toggle">
            <input
              type="checkbox"
              checked={playback.enhanced}
              disabled={playback.enhancing}
              onChange={(e) => playback.setEnhanced(e.target.checked)}
            />
            Audio mejorado
            {playback.enhancing ? '…' : ''}
          </label>
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() => seekRel(-1)}
            title="Segmento anterior (← / p)"
          >
            ‹ Seg
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() => seekRel(1)}
            title="Siguiente segmento (→ / n)"
          >
            Seg ›
          </button>
          <span className="audio-criba-durations mono">
            {playback.speechDurationLabel} habla / {playback.totalDurationLabel} total
          </span>
          {!analysis && (
            <button
              type="button"
              className="btn btn-tiny"
              disabled={analysisBusy}
              onClick={() => void requestAnalysis()}
            >
              {analysisBusy ? 'Analizando…' : 'Analizar silencios'}
            </button>
          )}
        </div>
        {analysis ? (
          <AudioTimeline
            analysis={analysis}
            currentTime={playback.currentTime}
            onSeek={playback.seekTo}
          />
        ) : null}
      </div>

      <div className="audio-criba-main">
        <div className="audio-criba-transcript">
          <div className="audio-transcript-head">
            <span>Transcripción</span>
            <span className="audio-transcript-head-meta mono">
              {blocks.length} bloque{blocks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="audio-transcript-blocks" role="list">
            {blocks.map((b, i) => {
              const showBadge = i === 0 || blocks[i - 1]?.speaker !== b.speaker
              const isActive = i === karaokeIdx
              const assignment = assignmentFor(b.speaker)
              return (
                <article
                  key={`${b.start}-${b.speaker}-${i}`}
                  ref={(el) => {
                    blockEls.current[i] = el
                  }}
                  className={
                    isActive ? 'audio-utterance is-active' : 'audio-utterance'
                  }
                  role="listitem"
                >
                  <button
                    type="button"
                    className="audio-utterance-gutter mono"
                    title="Ir a este momento"
                    onClick={() => {
                      if (b.end > b.start) playback.seekTo(b.start)
                    }}
                  >
                    {b.end > b.start ? formatDuration(b.start) : '—'}
                  </button>
                  <div className="audio-utterance-body">
                    {showBadge ? (
                      <SpeakerBadge
                        speaker={b.speaker}
                        assignment={assignment}
                        operatorTag={operatorTag}
                        personTags={personTags}
                        suggested={
                          suggestOperatorForSpeaker &&
                          b.speaker === speakers[0]?.speaker
                        }
                        disabled={busy}
                        onAssign={(tag) => assignSpeaker(b.speaker, tag)}
                      />
                    ) : null}
                    <textarea
                      ref={(el) => {
                        blockTaRefs.current[i] = el
                      }}
                      className="audio-utterance-ta"
                      value={b.text}
                      rows={1}
                      spellCheck
                      disabled={busy}
                      placeholder={
                        i === 0
                          ? 'Texto de la intervención… @ para etiquetar'
                          : undefined
                      }
                      onChange={(e) => onBlockChange(i, e.target.value)}
                      onKeyDown={(e) => onBlockKeyDown(e, i)}
                      onInput={(e) =>
                        autosizeTextarea(e.currentTarget)
                      }
                      onFocus={() => {
                        if (b.end > b.start) playback.seekTo(b.start)
                      }}
                      onScroll={() => {
                        if (mentionOpen && mentionBlock === i) {
                          const ta = blockTaRefs.current[i]
                          if (ta) {
                            setMentionAnchor(
                              getTextareaCaretRect(ta, ta.selectionStart),
                            )
                          }
                        }
                      }}
                      onClick={() => {
                        if (mentionOpen && mentionBlock === i) {
                          const ta = blockTaRefs.current[i]
                          if (ta) {
                            setMentionAnchor(
                              getTextareaCaretRect(ta, ta.selectionStart),
                            )
                          }
                        }
                      }}
                    />
                  </div>
                </article>
              )
            })}
          </div>
          <MentionMenu
            open={mentionOpen}
            hits={mentionHits}
            activeIdx={mentionIdx}
            busy={mentionBusy}
            anchor={mentionAnchor}
            taggedIds={taggedIds}
            onHoverIdx={setMentionIdx}
            onPick={applyTranscriptMention}
          />
        </div>

        <div className="audio-criba-side">
          <div>
            <p className="blob-composer-label">Voces</p>
            <ul className="audio-voice-legend">
              {speakers.map((s) => (
                <li key={s.speaker}>
                  <SpeakerBadge
                    speaker={s.speaker}
                    assignment={s}
                    operatorTag={operatorTag}
                    personTags={personTags}
                    suggested={
                      suggestOperatorForSpeaker &&
                      s.speaker === speakers[0]?.speaker
                    }
                    disabled={busy}
                    onAssign={(tag) => assignSpeaker(s.speaker, tag)}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="blob-composer-label">Tags</p>
            {tags.length > 0 ? (
              <ul className="audio-entity-chips">
                {tags.map((tag) => {
                  const auto = autoKeys.current.has(tagKey(tag))
                  return (
                    <li key={tagKey(tag)}>
                      <button
                        type="button"
                        className={`audio-entity-chip kind-${tag.kind}${
                          auto ? ' is-auto' : ''
                        }`}
                        title={`${mentionKindLabel(tag.kind)} · vinculado al grafo`}
                        onClick={() => focusTagInTranscript(tag)}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' || e.key === 'Delete') {
                            e.preventDefault()
                            removeTag(tag)
                          }
                        }}
                      >
                        <span className="audio-entity-chip-kind">
                          {mentionKindLabel(tag.kind)}
                        </span>
                        <span className="audio-entity-chip-name">
                          @{tag.entity_name}
                        </span>
                        <span
                          role="button"
                          tabIndex={-1}
                          className="audio-entity-chip-x"
                          aria-label={`Quitar ${tag.entity_name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeTag(tag)
                          }}
                        >
                          ×
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted audio-tags-empty">
                Entidades detectadas aparecen acá. @ en el texto también.
              </p>
            )}
            <TagField
              tags={tags}
              note={note}
              disabled={busy}
              placeholder="@ personas, grupos, lugares o proyectos. Nota libre opcional."
              showChips={false}
              onChange={({ tags: nextTags, note: nextNote }) => {
                setTags(nextTags)
                setNote(nextNote)
              }}
            />
          </div>
        </div>
      </div>

      <div className="audio-criba-vote">
        <span className="audio-criba-vote-label">Peso</span>
        <div className="audio-criba-weights" role="group" aria-label="Peso 1 a 12">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              type="button"
              className={`btn btn-tiny audio-w ${w <= 3 ? 'is-slop' : ''}`}
              disabled={busy}
              onClick={() => void vote(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
