import type { CalendarOccurrence, CalendarTask } from '../../types'
import {
  chipsForDay,
  formatDayHeading,
  formatHm,
  sourceLabel,
  toDayKey,
  type AlchemyDay,
} from '../../lib/calendar/engine'

type DayColumnProps = {
  date: Date
  alchemy: AlchemyDay
  occurrences: CalendarOccurrence[]
  isToday: boolean
  onToggleTask: (task: CalendarTask) => void
  label?: string
  hideNativeInfo?: boolean
}

function PoleMarks({
  poles,
  collapsed,
}: {
  poles: Array<'ingested' | 'native'>
  collapsed: boolean
}) {
  if (collapsed) {
    return <span className="cal-pole is-both">ingesta · nativo</span>
  }
  return (
    <>
      {poles.map((p) => (
        <span
          key={p}
          className={p === 'ingested' ? 'cal-pole is-ingested' : 'cal-pole is-native'}
        >
          {p === 'ingested' ? 'ingesta' : 'nativo'}
        </span>
      ))}
    </>
  )
}

export function ActivityChipList({
  date,
  occurrences,
  onToggleTask,
  hideNativeInfo = false,
}: {
  date: Date
  occurrences: CalendarOccurrence[]
  onToggleTask: (task: CalendarTask) => void
  hideNativeInfo?: boolean
}) {
  if (hideNativeInfo) {
    return <p className="muted empty">Info nativa oculta.</p>
  }

  const chips = chipsForDay(toDayKey(date), occurrences)
  if (chips.length === 0) {
    return <p className="muted empty">Sin actividad nativa.</p>
  }

  return (
    <ul className="cal-chip-list">
      {chips.map((chip) => {
        const hm = formatHm(chip.display_at)
        const showTasks = chip.collapsed || chip.poles.includes('native')
        const tasks = showTasks
          ? chip.tasks.filter((t) => t.status !== 'rejected')
          : []
        return (
          <li key={chip.key} className="cal-chip">
            <div className="cal-chip-time mono">
              <span>{hm.h24}</span>
              <span className="muted">{hm.h12}</span>
            </div>
            <div className="cal-chip-body">
              <div className="cal-chip-meta">
                <span className="cal-source mono">{sourceLabel(chip.source_type)}</span>
                <PoleMarks poles={chip.poles} collapsed={chip.collapsed} />
              </div>
              <p className="cal-chip-title">{chip.title}</p>
              {chip.hermetic_weight != null && (
                <p className="muted mono cal-chip-w">
                  peso {chip.hermetic_weight}
                </p>
              )}
              {tasks.length > 0 && (
                <ul className="cal-task-mini">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={
                          t.status === 'done'
                            ? 'cal-task-btn is-done'
                            : 'cal-task-btn'
                        }
                        onClick={() => onToggleTask(t)}
                      >
                        {t.task_text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function DayColumn({
  date,
  alchemy,
  occurrences,
  isToday,
  onToggleTask,
  label,
  hideNativeInfo = false,
}: DayColumnProps) {
  const count = hideNativeInfo
    ? 0
    : chipsForDay(toDayKey(date), occurrences).length
  return (
    <article
      className={
        isToday
          ? `cal-day-col is-today is-${alchemy.stageKey}`
          : `cal-day-col is-${alchemy.stageKey}`
      }
    >
      <header className="cal-day-col-head">
        <span className="cal-glyph" aria-hidden="true">
          {alchemy.glyph}
        </span>
        <div>
          <h3>{label ?? (isToday ? 'Hoy' : alchemy.name)}</h3>
          <p className="muted mono">{formatDayHeading(date)}</p>
        </div>
        <span className="cal-count mono">{count}</span>
      </header>
      <ActivityChipList
        date={date}
        occurrences={occurrences}
        onToggleTask={onToggleTask}
        hideNativeInfo={hideNativeInfo}
      />
    </article>
  )
}
