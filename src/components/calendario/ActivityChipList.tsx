import type { CalendarOccurrence, CalendarTask, SuggestedTodo } from '../../types'
import {
  chipsForDay,
  daySplitBands,
  formatDayHeading,
  formatHm,
  hourOfIso,
  sourceLabel,
  toDayKey,
  type AlchemyDay,
  type DaySplitMode,
} from '../../lib/calendar/engine'

type DayColumnProps = {
  date: Date
  alchemy: AlchemyDay
  occurrences: CalendarOccurrence[]
  isToday: boolean
  onToggleTask: (task: CalendarTask) => void
  label?: string
  hideNativeInfo?: boolean
  todoHolds?: SuggestedTodo[]
  onToggleTodoHold?: (todo: SuggestedTodo) => void
}

function holdsForDay(date: Date, todos: SuggestedTodo[]): SuggestedTodo[] {
  const key = toDayKey(date)
  return todos.filter(
    (t) =>
      t.hold_at &&
      t.status !== 'dismissed' &&
      toDayKey(new Date(t.hold_at)) === key,
  )
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
  todoHolds = [],
  onToggleTodoHold,
  hideHighGravity = false,
  band,
}: {
  date: Date
  occurrences: CalendarOccurrence[]
  onToggleTask: (task: CalendarTask) => void
  hideNativeInfo?: boolean
  todoHolds?: SuggestedTodo[]
  onToggleTodoHold?: (todo: SuggestedTodo) => void
  hideHighGravity?: boolean
  band?: { fromH: number; toH: number }
}) {
  const holds = holdsForDay(date, todoHolds).filter((t) => {
    if (hideHighGravity && (t.gravity ?? 0) >= 10) return false
    if (!band || !t.hold_at) return true
    const h = hourOfIso(t.hold_at)
    return h >= band.fromH && h < band.toH
  })
  const chips = (hideNativeInfo ? [] : chipsForDay(toDayKey(date), occurrences)).filter(
    (chip) => {
      if (!band) return true
      const h = hourOfIso(chip.display_at)
      return h >= band.fromH && h < band.toH
    },
  )
  if (chips.length === 0 && holds.length === 0) {
    return (
      <p className="muted empty">
        {hideNativeInfo ? 'Info nativa oculta.' : 'Sin actividad nativa.'}
      </p>
    )
  }

  return (
    <ul className="cal-chip-list">
      {holds.map((todo) => {
        const hm = todo.hold_at
          ? formatHm(todo.hold_at)
          : { h24: '—', h12: '—' }
        return (
          <li key={`todo:${todo.id}`} className="cal-chip is-todo-hold">
            <div className="cal-chip-time mono">
              <span>{hm.h24}</span>
              <span className="muted">{hm.h12}</span>
            </div>
            <div className="cal-chip-body">
              <div className="cal-chip-meta">
                <span className="cal-source mono">tarea</span>
                <span className="cal-pole is-todo">hold</span>
              </div>
              <p className="cal-chip-title">{todo.title}</p>
              {onToggleTodoHold && todo.status !== 'done' && (
                <ul className="cal-task-mini">
                  <li>
                    <button
                      type="button"
                      className="cal-task-btn"
                      onClick={() => onToggleTodoHold(todo)}
                    >
                      Hecho
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </li>
        )
      })}
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
  todoHolds = [],
  onToggleTodoHold,
  splitMode,
  hideHighGravity = false,
  dimmed = false,
}: DayColumnProps & {
  splitMode?: DaySplitMode
  hideHighGravity?: boolean
  dimmed?: boolean
}) {
  const holdCount = holdsForDay(date, todoHolds).filter(
    (t) => !(hideHighGravity && (t.gravity ?? 0) >= 10),
  ).length
  const count = hideNativeInfo
    ? holdCount
    : chipsForDay(toDayKey(date), occurrences).length + holdCount
  const bands = splitMode ? daySplitBands(splitMode) : null
  return (
    <article
      className={
        [
          isToday ? `cal-day-col is-today is-${alchemy.stageKey}` : `cal-day-col is-${alchemy.stageKey}`,
          dimmed ? 'is-dim' : '',
        ]
          .filter(Boolean)
          .join(' ')
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
      {bands ? (
        <div className="cal-day-bands">
          {bands.map((band) => (
            <section key={band.id} className="cal-day-band">
              <p className="cal-ingest-label mono">
                {band.label} · {String(band.fromH).padStart(2, '0')}–{String(band.toH).padStart(2, '0')}h
              </p>
              <ActivityChipList
                date={date}
                occurrences={occurrences}
                onToggleTask={onToggleTask}
                hideNativeInfo={hideNativeInfo}
                todoHolds={todoHolds}
                onToggleTodoHold={onToggleTodoHold}
                hideHighGravity={hideHighGravity}
                band={band}
              />
            </section>
          ))}
        </div>
      ) : (
        <ActivityChipList
          date={date}
          occurrences={occurrences}
          onToggleTask={onToggleTask}
          hideNativeInfo={hideNativeInfo}
          todoHolds={todoHolds}
          onToggleTodoHold={onToggleTodoHold}
          hideHighGravity={hideHighGravity}
        />
      )}
    </article>
  )
}
