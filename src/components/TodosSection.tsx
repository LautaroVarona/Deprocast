import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type {
  SuggestedHorizon,
  SuggestedTodo,
  SuggestedTodoEntityRef,
  SuggestedTodoStatus,
} from '../types'
import type { EntityHubMode } from './EntityHub'

export type TodosNavigateTarget =
  | { view: 'entidades'; mode: EntityHubMode }
  | { view: 'conocimiento' }
  | { view: 'aduana' }
  | { view: 'criba' }
  | { view: 'calendario' }
  | { view: 'mapa' }
  | { view: 'deprocast-ida' }

interface Props {
  refreshKey: number
  onChanged?: () => void
  onNavigate?: (target: TodosNavigateTarget) => void
}

const HORIZONS: SuggestedHorizon[] = [
  'hoy',
  'esta_semana',
  'proxima_semana',
  'cola',
]

const HORIZON_LABEL: Record<SuggestedHorizon, string> = {
  hoy: 'Hoy',
  esta_semana: 'Esta semana',
  proxima_semana: 'Próxima semana',
  cola: 'Cola',
}

const STATUS_FILTERS: Array<SuggestedTodoStatus | 'all'> = [
  'all',
  'suggested',
  'accepted',
  'done',
  'dismissed',
]

const STATUS_LABEL: Record<SuggestedTodoStatus | 'all', string> = {
  all: 'Todas',
  suggested: 'Sugeridas',
  accepted: 'Aceptadas',
  done: 'Hechas',
  dismissed: 'Descartadas',
}

function sourceHint(todo: SuggestedTodo): string {
  return todo.source.rule ?? todo.source.kind
}

function navigateForRule(
  todo: SuggestedTodo,
  onNavigate?: (t: TodosNavigateTarget) => void,
): void {
  if (!onNavigate) return
  const rule = todo.source.rule ?? ''
  if (rule.startsWith('waiting')) {
    onNavigate({ view: 'entidades', mode: 'sala' })
    return
  }
  if (rule === 'hitl.aduana') {
    onNavigate({ view: 'aduana' })
    return
  }
  if (rule === 'hitl.bookmark_criba' || rule === 'hitl.criba_audio') {
    onNavigate({ view: 'criba' })
    return
  }
  if (rule.startsWith('knowledge') || rule.startsWith('hitl.knowledge') || rule === 'knowledge.curriculum') {
    onNavigate({ view: 'conocimiento' })
    return
  }
  if (rule.startsWith('ida')) {
    onNavigate({ view: 'deprocast-ida' })
    return
  }
  if (rule.startsWith('project') || rule.startsWith('calendar')) {
    onNavigate({ view: 'entidades', mode: 'proyectos' })
    return
  }
  onNavigate({ view: 'calendario' })
}

function navigateRef(
  ref: SuggestedTodoEntityRef,
  onNavigate?: (t: TodosNavigateTarget) => void,
): void {
  if (!onNavigate) return
  if (ref.kind === 'project') {
    onNavigate({ view: 'entidades', mode: 'proyectos' })
    return
  }
  if (ref.kind === 'person') {
    onNavigate({ view: 'entidades', mode: 'perfiles' })
    return
  }
  if (ref.kind === 'dominio') {
    onNavigate({ view: 'entidades', mode: 'dominios' })
    return
  }
  if (ref.kind === 'geografia') {
    onNavigate({ view: 'mapa' })
    return
  }
  if (ref.kind === 'knowledge') {
    onNavigate({ view: 'conocimiento' })
    return
  }
  if (ref.kind === 'ida') {
    onNavigate({ view: 'deprocast-ida' })
    return
  }
}

export function TodosSection({ refreshKey, onChanged, onNavigate }: Props) {
  const [todos, setTodos] = useState<SuggestedTodo[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<SuggestedHorizon | 'all'>('all')
  const [status, setStatus] = useState<SuggestedTodoStatus | 'all'>('suggested')
  const [holdOnAccept, setHoldOnAccept] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listSuggestedTodos()
      setTodos(data.todos)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer las tareas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const visible = useMemo(() => {
    return todos.filter((t) => {
      if (horizon !== 'all' && t.horizon !== horizon) return false
      if (status !== 'all' && t.status !== status) return false
      return true
    })
  }, [todos, horizon, status])

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.regenerateSuggestedTodos(true)
      setTodos(data.todos)
      setFlash(
        `Regeneradas: ${data.created} nuevas, ${data.updated} actualizadas.`,
      )
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo regenerar')
    } finally {
      setBusy(false)
    }
  }

  async function accept(todo: SuggestedTodo) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.acceptSuggestedTodo(todo.id, {
        create_calendar_hold: holdOnAccept,
      })
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? res.todo : t)))
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar')
    } finally {
      setBusy(false)
    }
  }

  async function setTodoStatus(todo: SuggestedTodo, next: SuggestedTodoStatus) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.patchSuggestedTodo(todo.id, { status: next })
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? res.todo : t)))
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel todos-section" id="tareas">
      <header className="panel-head">
        <h2>Tareas sugeridas</h2>
        <div className="todos-head-actions">
          <label className="todos-hold-toggle">
            <input
              type="checkbox"
              checked={holdOnAccept}
              onChange={(e) => setHoldOnAccept(e.target.checked)}
            />
            Hold en calendario al aceptar
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            Regenerar
          </button>
        </div>
      </header>

      <p className="muted todos-lead">
        No es una agenda ciega: cada ítem existe porque el corpus lo pide, con
        trazas a proyectos, personas, conocimiento o validación pendiente.
      </p>

      <div className="todos-filters" role="tablist" aria-label="Horizonte">
        <button
          type="button"
          className={horizon === 'all' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setHorizon('all')}
        >
          Todos
        </button>
        {HORIZONS.map((h) => (
          <button
            key={h}
            type="button"
            className={horizon === h ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setHorizon(h)}
          >
            {HORIZON_LABEL[h]}
          </button>
        ))}
      </div>
      <div className="todos-filters" role="tablist" aria-label="Estado">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            className={status === s ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <p className="status-line err">{error}</p>}
      {flash && <p className="status-line">{flash}</p>}
      {loading && todos.length === 0 && (
        <p className="muted empty">Leyendo sugerencias…</p>
      )}
      {!loading && visible.length === 0 && (
        <p className="muted empty">
          No hay tareas en este filtro.{' '}
          <button type="button" className="ghost" onClick={() => void regenerate()}>
            Regenerar desde el corpus
          </button>
        </p>
      )}

      <ul className="todo-list">
        {visible.map((todo) => (
          <li key={todo.id} className={`todo-card is-${todo.status}`}>
            <div className="todo-card-meta">
              <span className="mono todo-priority">P{todo.priority}</span>
              <span className="todo-horizon">{HORIZON_LABEL[todo.horizon]}</span>
              {todo.estimate_minutes != null && (
                <span className="mono muted">{todo.estimate_minutes} min</span>
              )}
              <span className="mono muted todo-rule">{sourceHint(todo)}</span>
            </div>
            <h3>{todo.title}</h3>
            <p className="todo-why">{todo.why}</p>
            {todo.relations.entity_refs && todo.relations.entity_refs.length > 0 && (
              <div className="todo-refs">
                {todo.relations.entity_refs.map((ref) => (
                  <button
                    key={`${ref.kind}:${ref.id}`}
                    type="button"
                    className="filter-chip"
                    onClick={() => navigateRef(ref, onNavigate)}
                  >
                    {ref.kind} · {ref.label}
                  </button>
                ))}
              </div>
            )}
            <div className="todo-card-actions">
              {todo.status === 'suggested' && (
                <>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void accept(todo)}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void setTodoStatus(todo, 'dismissed')}
                  >
                    Descartar
                  </button>
                </>
              )}
              {(todo.status === 'suggested' || todo.status === 'accepted') && (
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={busy}
                  onClick={() => void setTodoStatus(todo, 'done')}
                >
                  Hecho
                </button>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => navigateForRule(todo, onNavigate)}
              >
                Abrir origen
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
