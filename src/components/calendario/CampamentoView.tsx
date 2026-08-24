import { useMemo, useState } from 'react'
import type { CalendarOccurrence, CalendarTask, DeproAgentStatus, DeproTypology } from '../../types'
import {
  addDays,
  amazonaCoords,
  defaultMatrixCell,
  getAlchemyForDate,
  loadMatrixMap,
  saveMatrixMap,
  solfeggioHz,
  toDayKey,
  TRIDENTS,
  WEEKDAY_ALCHEMY,
  weekTasks,
  type TridentId,
} from '../../lib/calendar/engine'
import { AGENT_CATALOG } from '../../lib/deprocast/agents'
import { TYPOLOGIES, TYPOLOGY_LABEL } from '../../lib/deprocast/geometry'
import { CampamentoQueue } from './QuantomoPipePanels'

type WeekTask = CalendarTask & { source_type: string; dayKey: string }

type Props = {
  weekStart: Date
  focus: Date
  occurrences: CalendarOccurrence[]
  matrixMap: Record<string, number>
  trident: TridentId
  onMatrixMap: (next: Record<string, number>) => void
  onToggleTask: (task: CalendarTask) => void
  onTrident: (id: TridentId) => void
  onSelectDay: (date: Date) => void
}

const MATRIX_COLS = WEEKDAY_ALCHEMY.slice(0, 6)

function typologyPulse(): Array<{
  id: DeproTypology
  label: string
  status: DeproAgentStatus
  vivo: number
}> {
  return TYPOLOGIES.map((id) => {
    const agents = AGENT_CATALOG.filter((a) => a.typology === id)
    const vivo = agents.filter((a) => a.status === 'vivo').length
    const status: DeproAgentStatus = vivo
      ? 'vivo'
      : agents.some((a) => a.status === 'bosquejo')
        ? 'bosquejo'
        : 'hueco'
    return { id, label: TYPOLOGY_LABEL[id], status, vivo }
  })
}

export function CampamentoView({
  weekStart,
  focus,
  occurrences,
  matrixMap,
  trident,
  onMatrixMap,
  onToggleTask,
  onTrident,
  onSelectDay,
}: Props) {
  const [index, setIndex] = useState(0)
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const tasks = useMemo(
    () => weekTasks(weekStart, occurrences),
    [weekStart, occurrences],
  )
  const focusKey = toDayKey(focus)
  const alchemy = getAlchemyForDate(focus)
  const coords = amazonaCoords(index)
  const hz = solfeggioHz(trident, focus)
  const tridentMeta = TRIDENTS.find((x) => x.id === trident) ?? TRIDENTS[0]
  const pulse = useMemo(() => typologyPulse(), [])

  const byCell = useMemo(() => {
    const map = new Map<number, WeekTask[]>()
    for (const t of tasks) {
      const cell =
        matrixMap[t.id] ?? defaultMatrixCell(t.id, t.tag, t.source_type)
      const list = map.get(cell) ?? []
      list.push(t)
      map.set(cell, list)
    }
    return map
  }, [tasks, matrixMap])

  function cellFor(task: WeekTask): number {
    return matrixMap[task.id] ?? defaultMatrixCell(task.id, task.tag, task.source_type)
  }

  function onDropCell(cell: number, taskId: string) {
    onMatrixMap({ ...matrixMap, [taskId]: cell })
  }

  return (
    <div className="cal-campamento">
      <div className="cal-campamento-main">
        <div className="cal-week-select" role="tablist" aria-label="Día de la semana">
          {days.map((date, i) => {
            const day = WEEKDAY_ALCHEMY[i]
            const key = toDayKey(date)
            const active = key === focusKey
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? `cal-week-chip is-active is-${day.stageKey}`
                    : `cal-week-chip is-${day.stageKey}`
                }
                onClick={() => onSelectDay(date)}
              >
                <span className="cal-glyph">{day.glyph}</span>
                <span>{day.name.slice(0, 3)}</span>
                <span className="muted mono">
                  {date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                </span>
              </button>
            )
          })}
        </div>

        <div className="cal-matrix-wrap">
          <div className="cal-matrix-head">
            <span className="cal-matrix-corner mono">6×6</span>
            {MATRIX_COLS.map((col) => (
              <span key={col.stageKey} className="cal-matrix-colhead">
                <span className="cal-glyph">{col.glyph}</span>
                <span>{col.stage}</span>
              </span>
            ))}
          </div>
          <div className="cal-matrix is-board">
            {Array.from({ length: 36 }, (_, cell) => {
              const items = byCell.get(cell) ?? []
              const lit = cell === coords.cell && coords.face === 0
              const col = MATRIX_COLS[cell % 6] ?? MATRIX_COLS[0]
              return (
                <div
                  key={cell}
                  className={
                    lit
                      ? `cal-matrix-cell is-lit is-${col.stageKey}`
                      : `cal-matrix-cell is-${col.stageKey}`
                  }
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/task-id')
                    if (id) onDropCell(cell, id)
                  }}
                >
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      draggable
                      className={
                        t.status === 'done'
                          ? 'cal-matrix-dot is-done'
                          : t.dayKey === focusKey
                            ? 'cal-matrix-dot is-day'
                            : 'cal-matrix-dot'
                      }
                      title={t.task_text}
                      onClick={() => onToggleTask(t)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/task-id', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      {t.task_text.slice(0, 2)}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        <ul className="cal-week-queue">
          {tasks.length === 0 && (
            <li className="muted empty">Sin prioridades esta semana. Arrastrá tareas a la matriz.</li>
          )}
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                draggable
                className={
                  t.status === 'done'
                    ? 'cal-queue-item is-done'
                    : t.dayKey === focusKey
                      ? 'cal-queue-item is-day'
                      : 'cal-queue-item'
                }
                title="Arrastrar a la matriz"
                onClick={() => onToggleTask(t)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/task-id', t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <span className="cal-task-cell mono">
                  {String(cellFor(t) + 1).padStart(2, '0')}
                </span>
                <span className="cal-queue-text">{t.task_text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <aside className="cal-campamento-rail">
        <header className="cal-rail-head">
          <span className="cal-glyph">{alchemy.glyph}</span>
          <div>
            <h3>{alchemy.name}</h3>
            <p className="muted mono">
              {alchemy.planet} · {alchemy.stage}
            </p>
          </div>
        </header>

        <div className="cal-amazona-compact">
          <p className="cal-ingest-label mono">Base Amazona 72</p>
          <p className="muted cal-amazona-lead">
            Rotación 3×3×3 · suma {coords.sum} · producto {coords.product}
          </p>
          <div className="cal-amazona-index">
            <button type="button" className="btn btn-tiny" onClick={() => setIndex((n) => n - 9)}>
              −9
            </button>
            <span className="mono cal-amazona-n">{String(coords.index).padStart(2, '0')}</span>
            <button type="button" className="btn btn-tiny" onClick={() => setIndex((n) => n + 9)}>
              +9
            </button>
          </div>
          <p className="mono muted cal-trident-break">
            cara {coords.face + 1}/2 · celda {coords.row + 1},{coords.col + 1} ·
            tridente ({coords.x},{coords.y},{coords.z})
          </p>
          <div className="cal-solfeggio">
            <p className="cal-solfeggio-hz mono">{hz} Hz</p>
            <p className="muted">
              Solfeggio {tridentMeta.label} ({tridentMeta.n}) · {alchemy.planet}
            </p>
            <div className="cal-solfeggio-tridents">
              {TRIDENTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={trident === t.id ? 'filter-chip is-active' : 'filter-chip'}
                  onClick={() => onTrident(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="cal-ingest-label mono">Tipologías</p>
        <ul className="cal-typology-list">
          {pulse.map((t) => (
            <li
              key={t.id}
              className={`cal-typology is-${t.status}`}
            >
              <span>{t.label}</span>
              <span className="mono muted">
                {t.status}
                {t.vivo ? ` · ${t.vivo}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <CampamentoQueue />
      </aside>
    </div>
  )
}

export function persistWeekMatrix(
  weekKey: string,
  map: Record<string, number>,
) {
  saveMatrixMap(weekKey, map)
}

export function readWeekMatrix(weekKey: string): Record<string, number> {
  return loadMatrixMap(weekKey)
}
