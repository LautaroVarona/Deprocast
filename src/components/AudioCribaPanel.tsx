import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import type {
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

export function AudioCribaPanel({ refreshKey, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [timestamp, setTimestamp] = useState('')
  const [transcript, setTranscript] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<BookmarkManualTag[]>([])
  const [speakers, setSpeakers] = useState<SpeakerAssignment[]>([])

  const audioRef = useRef<HTMLAudioElement>(null)
  const loadInFlight = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef<Entry | null>(null)

  const active = entries[idx] ?? null
  activeRef.current = active

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const data = await api.getCribaAudios()
      setEntries(data.entries)
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
    if (!active) {
      setTitle('')
      setTimestamp('')
      setTranscript('')
      setNote('')
      setTags([])
      setSpeakers([])
      return
    }
    setTitle(active.title)
    setTimestamp(toDatetimeLocal(active.timestamp_exact))
    setTranscript(active.content_raw ?? '')
    setNote(active.operator_note ?? '')
    setTags(parseTags(active.manual_tags))
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
      const w = keyToWeight(e)
      if (w == null) return
      e.preventDefault()
      void vote(w)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vote])

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
        <audio
          ref={audioRef}
          key={active.id}
          controls
          src={`/api/entries/${encodeURIComponent(active.id)}/media`}
        />
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
                  </span>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    onClick={() => assignSpeaker(s.speaker, null)}
                  >
                    —
                  </button>
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
