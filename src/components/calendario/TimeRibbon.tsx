import { useMemo } from 'react'
import type { CalendarOccurrence, SuggestedTodo } from '../../types'
import {
  chipsForDay,
  ribbonDays,
  toDayKey,
} from '../../lib/calendar/engine'

type Props = {
  from: Date
  to: Date
  focus: Date
  occurrences: CalendarOccurrence[]
  holds: SuggestedTodo[]
  onFocus: (date: Date) => void
}

function scoreForDay(
  date: Date,
  occurrences: CalendarOccurrence[],
  holds: SuggestedTodo[],
): number {
  const key = toDayKey(date)
  const chips = chipsForDay(key, occurrences)
  const chipScore = chips.reduce(
    (acc, c) => acc + 1 + (c.hermetic_weight ?? 0) / 12,
    0,
  )
  const holdScore = holds.filter(
    (t) => t.hold_at && toDayKey(new Date(t.hold_at)) === key,
  ).length
  return chipScore + holdScore
}

export function TimeRibbon({
  from,
  to,
  focus,
  occurrences,
  holds,
  onFocus,
}: Props) {
  const days = useMemo(() => ribbonDays(from, to), [from, to])
  const focusKey = toDayKey(focus)
  const scores = useMemo(
    () => days.map((d) => scoreForDay(d, occurrences, holds)),
    [days, occurrences, holds],
  )
  const max = Math.max(1, ...scores)

  const focusIndex = Math.max(
    0,
    days.findIndex((d) => toDayKey(d) === focusKey),
  )

  return (
    <div className="cal-ribbon">
      <div className="cal-ribbon-meta">
        <span className="mono">Cinta</span>
        <span className="muted">Ayer ⇄ Hoy ⇄ Mañana</span>
      </div>
      <div className="cal-ribbon-bars" role="list">
        {days.map((date, i) => {
          const key = toDayKey(date)
          const h = scores[i] / max
          const active = key === focusKey
          return (
            <button
              key={key}
              type="button"
              role="listitem"
              className={active ? 'cal-ribbon-col is-focus' : 'cal-ribbon-col'}
              title={`${date.toLocaleDateString('es-ES')} · densidad ${scores[i].toFixed(1)}`}
              onClick={() => onFocus(date)}
            >
              <span
                className="cal-ribbon-bar"
                style={{ height: `${Math.max(8, h * 100)}%` }}
              />
            </button>
          )
        })}
      </div>
      <input
        type="range"
        className="cal-ribbon-slider"
        min={0}
        max={Math.max(0, days.length - 1)}
        value={focusIndex}
        aria-label="Desplazar foco temporal"
        onChange={(e) => {
          const next = days[Number(e.target.value)]
          if (next) onFocus(next)
        }}
      />
    </div>
  )
}
