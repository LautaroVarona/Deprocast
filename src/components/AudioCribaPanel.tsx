import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, useSmartAudioPlayback } from '../hooks/useSmartAudioPlayback'
import { api } from '../services/api'
import type {
  AudioAnalysisPayload,
  BookmarkManualTag,
  DiarizationPayload,
  Entry,
  SpeakerAssignment,
} from '../types'
import { TagField } from './TagField'

type Props = {
  refreshKey: number
  onChanged: () => void
}

type OperatorInfo = { id: string; name: string }

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
        (t.kind === 'person' || t.kind === 'project' || t.kind === 'dominio') &&
        typeof t.entity_id === 'string' &&
        typeof t.entity_name === 'string',
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
  const [transcript, setTranscript] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<BookmarkManualTag[]>([])
  const [speakers, setSpeakers] = useState<SpeakerAssignment[]>([])
  const [analysis, setAnalysis] = useState<AudioAnalysisPayload | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const loadInFlight = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef<Entry | null>(null)
  const analysisRequested = useRef<string | null>(null)

  const active = entries[idx] ?? null
  activeRef.current = active

  const diarization = useMemo(
    () => parseDiarization(active?.diarization_json),
    [active?.diarization_json],
  )

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
    if (!active) {
      setTitle('')
      setTimestamp('')
      setTranscript('')
      setNote('')
      setTags([])
      setSpeakers([])
      setAnalysis(null)
      return
    }
    setTitle(active.title)
    setTimestamp(toDatetimeLocal(active.timestamp_exact))
    setTranscript(active.content_raw ?? '')
    setNote(active.operator_note ?? '')
    setTags(parseTags(active.manual_tags))
    setAnalysis(parseAnalysis(active.audio_analysis_json))
    const mapped = parseSpeakerMap(active.speaker_map)
    const dia = parseDiarization(active.diarization_json)
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
  }, [active?.id])

  const personTags = useMemo(
    () => tags.filter((t) => t.kind === 'person'),
    [tags],
  )

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

  const persistMeta = useCallback(
    async (entry: Entry) => {
      const nextTitle = title.trim()
      const iso = fromDatetimeLocal(timestamp)
      const titleChanged = Boolean(nextTitle && nextTitle !== entry.title)
      const tsChanged = Boolean(iso && iso !== entry.timestamp_exact)
      if (!titleChanged && !tsChanged) return
      try {
        await api.patchAudioCriba(entry.id, {
          ...(titleChanged ? { title: nextTitle } : {}),
          ...(iso && tsChanged ? { timestamp_exact: iso } : {}),
        })
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  ...(titleChanged
                    ? { title: nextTitle, title_manual: 1 }
                    : {}),
                  ...(iso && tsChanged ? { timestamp_exact: iso } : {}),
                }
              : e,
          ),
        )
      } catch {
        /* el voto persiste el mismo payload */
      }
    },
    [title, timestamp],
  )

  useEffect(() => {
    if (!activeRef.current) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      if (activeRef.current) void persistMeta(activeRef.current)
    }, 700)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [persistMeta])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (t?.isContentEditable) return

      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        playback.nextSegment()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        playback.prevSegment()
        return
      }

      const w = keyToWeight(e)
      if (w == null) return
      e.preventDefault()
      void vote(w)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vote, playback])

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
            onBlur={() => void persistMeta(active)}
          />
        </label>
        <label className="field">
          <span>Fecha y hora</span>
          <input
            type="datetime-local"
            value={timestamp}
            disabled={busy}
            onChange={(e) => setTimestamp(e.target.value)}
            onBlur={() => void persistMeta(active)}
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
            onClick={() => playback.prevSegment()}
            title="Segmento anterior (← / p)"
          >
            ‹ Seg
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() => playback.nextSegment()}
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
        {diarization && diarization.utterances.length > 0 ? (
          <ul className="audio-utterance-list">
            {diarization.utterances.map((u, i) => {
              const activeUtterance =
                playback.currentTime >= u.start && playback.currentTime < u.end
              return (
                <li key={`${u.start}-${i}`}>
                  <button
                    type="button"
                    className={
                      activeUtterance
                        ? 'audio-utterance-btn is-active'
                        : 'audio-utterance-btn'
                    }
                    onClick={() => playback.seekTo(u.start)}
                  >
                    <span className="mono audio-utterance-ts">
                      {formatDuration(u.start)}
                    </span>
                    <span className="mono">S{u.speaker}</span>
                    <span className="audio-utterance-text">{u.transcript}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      <div className="audio-criba-main">
        <label className="audio-criba-transcript">
          Transcripción
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            spellCheck
            disabled={busy}
          />
        </label>

        <div className="audio-criba-side">
          <div>
            <p className="blob-composer-label">Voces</p>
            <ul className="audio-speaker-list">
              {speakers.map((s) => (
                <li key={s.speaker}>
                  <span className="mono">Speaker {s.speaker}</span>
                  <span className="audio-speaker-name">
                    {s.person_name ?? 'sin asignar'}
                    {suggestOperatorForSpeaker &&
                    s.speaker === speakers[0]?.speaker &&
                    !s.person_id ? (
                      <span className="audio-speaker-suggested"> sugerido</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    onClick={() => assignSpeaker(s.speaker, null)}
                  >
                    —
                  </button>
                  {operatorTag ? (
                    <button
                      type="button"
                      className={
                        s.person_id === operatorTag.entity_id
                          ? 'btn btn-tiny is-on'
                          : suggestOperatorForSpeaker &&
                              s.speaker === speakers[0]?.speaker &&
                              !s.person_id
                            ? 'btn btn-tiny is-suggested'
                            : 'btn btn-tiny'
                      }
                      onClick={() => assignSpeaker(s.speaker, operatorTag)}
                    >
                      Yo — {operatorTag.entity_name}
                    </button>
                  ) : null}
                  {personTags.map((tag) => (
                    <button
                      key={tag.entity_id}
                      type="button"
                      className={
                        s.person_id === tag.entity_id
                          ? 'btn btn-tiny is-on'
                          : 'btn btn-tiny'
                      }
                      onClick={() => assignSpeaker(s.speaker, tag)}
                    >
                      @{tag.entity_name}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="blob-composer-label">Tags</p>
            <TagField
              tags={tags}
              note={note}
              disabled={busy}
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
