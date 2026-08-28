import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type { AppRun, CalendarOccurrence, CalendarTask } from '../../types'
import {
  addDays,
  cycle28Containing,
  runDayNumber,
  startOfLocalDay,
  startOfWeekMonday,
  toDayKey,
  type ClockSkin,
  type DimensionId,
  type TridentId,
} from '../../lib/calendar/engine'
import { DimensionalNavigator } from './DimensionalNavigator'
import { TrincheraView } from './TrincheraView'
import { CampamentoView, readWeekMatrix, persistWeekMatrix } from './CampamentoView'
import { CastilloView } from './CastilloView'
import { useClockNow } from './SensoryClock'

type Props = {
  refreshKey: number
  onChanged?: () => void
  run?: AppRun | null
}

const LS_SKIN = 'deprocast.clock.skin'
const LS_TRIDENT = 'deprocast.trident'
const LS_DIM = 'deprocast.calendar.dimension'
const LS_HIDE_NATIVE = 'deprocast.calendar.hideNativeInfo'

const DIM_BY_CODE: Record<string, DimensionId> = {
  KeyE: 'trinchera',
  KeyW: 'campamento',
  KeyQ: 'castillo',
}

function readSkin(): ClockSkin {
  const v = localStorage.getItem(LS_SKIN)
  if (v === 'analog' || v === 'digital' || v === 'sensorial') return v
  return 'analog'
}

function readTrident(): TridentId {
  const v = localStorage.getItem(LS_TRIDENT)
  if (v === 'cuerpo' || v === 'mente' || v === 'alma') return v
  return 'mente'
}

function readDim(): DimensionId {
  const v = localStorage.getItem(LS_DIM)
  if (v === 'trinchera' || v === 'campamento' || v === 'castillo') return v
  return 'trinchera'
}

function readHideNativeInfo(): boolean {
  const v = localStorage.getItem(LS_HIDE_NATIVE)
  if (v === '0' || v === 'false') return false
  return true
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function CalendarioSection({ refreshKey, onChanged, run }: Props) {
  const now = useClockNow()
  const today = startOfLocalDay(now)
  const [focus, setFocus] = useState(() => startOfLocalDay(new Date()))
  const [dimension, setDimension] = useState<DimensionId>(readDim)
  const [clockSkin, setClockSkin] = useState<ClockSkin>(readSkin)
  const [trident, setTrident] = useState<TridentId>(readTrident)
  const [hideNativeInfo, setHideNativeInfo] = useState(readHideNativeInfo)
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestStatus, setIngestStatus] = useState<string | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)

  const weekStart = useMemo(() => startOfWeekMonday(focus), [focus])
  const weekKey = toDayKey(weekStart)
  const [matrixMap, setMatrixMap] = useState<Record<string, number>>({})

  const setDim = useCallback((id: DimensionId) => {
    setDimension((prev) => {
      if (prev === id) return prev
      localStorage.setItem(LS_DIM, id)
      return id
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isTypingTarget(e.target)) return
      const dim = DIM_BY_CODE[e.code]
      if (!dim) return
      e.preventDefault()
      setDim(dim)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setDim])

  useEffect(() => {
    setMatrixMap(readWeekMatrix(weekKey))
  }, [weekKey])

  function updateMatrix(next: Record<string, number>) {
    setMatrixMap(next)
    persistWeekMatrix(weekKey, next)
  }

  const range = useMemo(() => {
    const cycle = cycle28Containing(focus)
    const from = addDays(cycle.start, -28)
    const to = addDays(cycle.start, 56)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [focus])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getCalendarActivity(range.from, range.to)
      setOccurrences(data.occurrences)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al leer el calendario')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  function setSkin(skin: ClockSkin) {
    setClockSkin(skin)
    localStorage.setItem(LS_SKIN, skin)
  }

  function setTri(id: TridentId) {
    setTrident(id)
    localStorage.setItem(LS_TRIDENT, id)
  }

  function toggleHideNativeInfo() {
    setHideNativeInfo((prev) => {
      const next = !prev
      localStorage.setItem(LS_HIDE_NATIVE, next ? '1' : '0')
      return next
    })
  }

  const visibleOccurrences = hideNativeInfo ? [] : occurrences

  async function onToggleTask(task: CalendarTask) {
    try {
      await api.patchCalendarTask(task.id, task.status !== 'done')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea')
    }
  }

  async function onIngestAudio(files: File[]) {
    const AUDIO_EXTS = ['.m4a', '.mp3', '.ogg', '.oga', '.opus', '.aac', '.wav', '.mp4']
    const list = files.filter((file) => {
      const name = file.name.toLowerCase()
      if (AUDIO_EXTS.some((ext) => name.endsWith(ext))) return true
      const mime = (file.type || '').toLowerCase()
      return mime.startsWith('audio/') || mime === 'application/ogg'
    })
    if (list.length === 0) {
      setIngestError('Ningún archivo de audio válido.')
      return
    }
    setIngestBusy(true)
    setIngestError(null)
    setIngestStatus(null)
    try {
      const batchId = crypto.randomUUID()
      for (const file of list) {
        const result = await api.ingestAudioOne(file, { batch_id: batchId })
        const expectedTitle = file.name.replace(/\.[^.]+$/, '')
        if (!result.entries.some((e) => e.title === expectedTitle)) {
          throw new Error(`«${file.name}» no quedó registrado. Abortando el lote.`)
        }
      }
      await api.runPipeline()
      setIngestStatus(
        list.length === 1
          ? 'Audio en cola. Pipeline arrancado.'
          : `${list.length} audios en cola.`,
      )
      await load()
      onChanged?.()
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Ingesta de audio fallida')
    } finally {
      setIngestBusy(false)
    }
  }

  async function onIngestNote(text: string) {
    setIngestBusy(true)
    setIngestError(null)
    setIngestStatus(null)
    try {
      await api.ingestBlob({
        text,
        timestamp_exact: new Date().toISOString(),
        tags: [],
      })
      setIngestStatus('Nota en el backlog.')
      await load()
      onChanged?.()
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'No se pudo guardar la nota')
    } finally {
      setIngestBusy(false)
    }
  }

  function shiftFocus(days: number) {
    setFocus((d) => addDays(d, days))
  }

  function onSelectCastilloDay(date: Date) {
    setFocus(startOfLocalDay(date))
    setDim('trinchera')
  }

  const focusLabel = focus.toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <section className="panel calendario-section" id="calendario">
      <header className="panel-head cal-head">
        <h2>Calendario</h2>
        {run && (
          <span className="mono cal-run-day">
            día {runDayNumber(run.started_at, now)} de la RUN
          </span>
        )}
        <DimensionalNavigator value={dimension} onChange={setDim} />
        <button
          type="button"
          className={
            hideNativeInfo ? 'filter-chip is-active' : 'filter-chip'
          }
          aria-pressed={hideNativeInfo}
          title="Oculta chips de actividad del corpus (ingesta / nativo) dentro de Deprocast"
          onClick={toggleHideNativeInfo}
        >
          Ocultar Info nativa
        </button>
        <div className="cal-focus-nav">
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() =>
              shiftFocus(dimension === 'castillo' ? -28 : dimension === 'campamento' ? -7 : -1)
            }
          >
            ←
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() => setFocus(today)}
          >
            Hoy
          </button>
          <span className="mono cal-focus-label">{focusLabel}</span>
          <button
            type="button"
            className="btn btn-tiny"
            onClick={() =>
              shiftFocus(dimension === 'castillo' ? 28 : dimension === 'campamento' ? 7 : 1)
            }
          >
            →
          </button>
        </div>
      </header>

      {error && <p className="status-line err">{error}</p>}
      {loading && !hideNativeInfo && occurrences.length === 0 && (
        <p className="muted empty">Cargando actividad nativa…</p>
      )}

      <div className="cal-layout">
        <div className="cal-main" key={dimension}>
          {dimension === 'trinchera' && (
            <TrincheraView
              focus={focus}
              today={today}
              now={now}
              occurrences={visibleOccurrences}
              hideNativeInfo={hideNativeInfo}
              clockSkin={clockSkin}
              trident={trident}
              onClockSkin={setSkin}
              onTrident={setTri}
              onToggleTask={onToggleTask}
              onIngestAudio={onIngestAudio}
              onIngestNote={onIngestNote}
              ingestBusy={ingestBusy}
              ingestStatus={ingestStatus}
              ingestError={ingestError}
            />
          )}
          {dimension === 'campamento' && (
            <CampamentoView
              weekStart={weekStart}
              focus={focus}
              occurrences={visibleOccurrences}
              matrixMap={matrixMap}
              trident={trident}
              onMatrixMap={updateMatrix}
              onToggleTask={onToggleTask}
              onTrident={setTri}
              onSelectDay={(date) => setFocus(startOfLocalDay(date))}
            />
          )}
          {dimension === 'castillo' && (
            <CastilloView
              focus={focus}
              today={today}
              occurrences={visibleOccurrences}
              onSelectDay={onSelectCastilloDay}
            />
          )}
        </div>
      </div>
    </section>
  )
}
