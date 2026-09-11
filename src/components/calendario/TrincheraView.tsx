import { useRef, useState } from 'react'
import type {
  CalendarDayEnergy,
  CalendarOccurrence,
  CalendarTask,
  SuggestedTodo,
} from '../../types'
import {
  addDays,
  getAlchemyForDate,
  TRIDENTS,
  type ClockSkin,
  type DaySplitMode,
  type TridentId,
} from '../../lib/calendar/engine'
import { DayColumn } from './ActivityChipList'
import { CofrePanel } from './QuantomoPipePanels'
import { SensoryClock } from './SensoryClock'

const AUDIO_ACCEPT =
  '.m4a,.mp3,.ogg,.oga,.opus,.aac,.wav,.mp4,audio/*,audio/mp4,audio/x-m4a,audio/mpeg,audio/ogg,audio/opus,audio/aac,audio/wav,application/ogg'

type Props = {
  focus: Date
  today: Date
  now: Date
  occurrences: CalendarOccurrence[]
  hideNativeInfo?: boolean
  clockSkin: ClockSkin
  trident: TridentId
  onClockSkin: (skin: ClockSkin) => void
  onTrident: (id: TridentId) => void
  onToggleTask: (task: CalendarTask) => void
  todoHolds?: SuggestedTodo[]
  onToggleTodoHold?: (todo: SuggestedTodo) => void
  onIngestAudio: (files: File[]) => void
  onIngestNote: (text: string) => void
  ingestBusy: boolean
  ingestStatus: string | null
  ingestError: string | null
  energy?: CalendarDayEnergy
  onEnergy?: (patch: Partial<CalendarDayEnergy>) => void
  hideHighGravity?: boolean
  dimSideDays?: boolean
}

export function TrincheraView({
  focus,
  today,
  now,
  occurrences,
  hideNativeInfo = false,
  clockSkin,
  trident,
  onClockSkin,
  onTrident,
  onToggleTask,
  todoHolds = [],
  onToggleTodoHold,
  onIngestAudio,
  onIngestNote,
  ingestBusy,
  ingestStatus,
  ingestError,
  energy,
  onEnergy,
  hideHighGravity = false,
  dimSideDays = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const yesterday = addDays(focus, -1)
  const tomorrow = addDays(focus, 1)
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`

  function isToday(d: Date) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey
  }

  return (
    <div className="cal-trinchera">
      <div className="cal-trinchera-rail">
        <SensoryClock
          now={now}
          skin={clockSkin}
          trident={trident}
          onSkin={onClockSkin}
          onTrident={onTrident}
        />
        <div className="cal-tridents">
          {TRIDENTS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={
                trident === t.id
                  ? 'cal-trident is-active animate-pulse'
                  : 'cal-trident'
              }
              onClick={() => onTrident(t.id)}
            >
              <span className="cal-trident-n mono">{t.n}</span>
              <span>{t.label}</span>
              <span className="muted mono">{t.hz} Hz</span>
            </button>
          ))}
        </div>
        {energy && onEnergy && (
          <div className="cal-energy">
            <p className="cal-ingest-label mono">Presupuesto</p>
            {(['cuerpo', 'mente', 'alma'] as const).map((pole) => (
              <label key={pole} className="cal-energy-row">
                <span>{pole}</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={energy[pole]}
                  onChange={(e) => onEnergy({ [pole]: Number(e.target.value) })}
                />
                <span className="mono">{energy[pole]}</span>
              </label>
            ))}
            <div className="cal-split-toggle">
              <button
                type="button"
                className={energy.split_mode === '2' ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => onEnergy({ split_mode: '2' as DaySplitMode })}
              >
                Día/Noche
              </button>
              <button
                type="button"
                className={energy.split_mode === '3' ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => onEnergy({ split_mode: '3' as DaySplitMode })}
              >
                3 partes
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="cal-trinchera-cols">
        <DayColumn
          date={yesterday}
          alchemy={getAlchemyForDate(yesterday)}
          occurrences={occurrences}
          hideNativeInfo={hideNativeInfo}
          todoHolds={todoHolds}
          onToggleTodoHold={onToggleTodoHold}
          isToday={isToday(yesterday)}
          onToggleTask={onToggleTask}
          label="Ayer"
          dimmed={dimSideDays}
          hideHighGravity={hideHighGravity}
        />
        <DayColumn
          date={focus}
          alchemy={getAlchemyForDate(focus)}
          occurrences={occurrences}
          hideNativeInfo={hideNativeInfo}
          todoHolds={todoHolds}
          onToggleTodoHold={onToggleTodoHold}
          isToday={isToday(focus)}
          onToggleTask={onToggleTask}
          label="Hoy"
          splitMode={energy?.split_mode}
          hideHighGravity={hideHighGravity}
        />
        <DayColumn
          date={tomorrow}
          alchemy={getAlchemyForDate(tomorrow)}
          occurrences={occurrences}
          hideNativeInfo={hideNativeInfo}
          todoHolds={todoHolds}
          onToggleTodoHold={onToggleTodoHold}
          isToday={isToday(tomorrow)}
          onToggleTask={onToggleTask}
          label="Mañana"
          dimmed={dimSideDays}
          hideHighGravity={hideHighGravity}
        />
      </div>
      <aside className="cal-ingest">
        <p className="cal-ingest-label mono">Ingesta</p>
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            if (files.length) onIngestAudio(files)
          }}
        />
        <button
          type="button"
          className="btn btn-tiny"
          disabled={ingestBusy}
          onClick={() => inputRef.current?.click()}
        >
          Ingesta de audio
        </button>
        <form
          className="cal-ingest-note"
          onSubmit={(e) => {
            e.preventDefault()
            const text = note.trim()
            if (!text || ingestBusy) return
            onIngestNote(text)
            setNote('')
          }}
        >
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Recordatorio al backlog…"
            disabled={ingestBusy}
          />
          <button type="submit" className="btn btn-tiny" disabled={ingestBusy || !note.trim()}>
            Enviar
          </button>
        </form>
        {ingestStatus && <p className="status-line ok">{ingestStatus}</p>}
        {ingestError && <p className="status-line err">{ingestError}</p>}
        <CofrePanel />
      </aside>
    </div>
  )
}
