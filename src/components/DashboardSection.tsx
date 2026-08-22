import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { api } from '../services/api'
import type { EntityHubMode } from './EntityHub'
import type { DashboardPin, DialogoEntityRefType } from '../types'

type TypeaheadHit = {
  kind: DialogoEntityRefType
  id: string
  label: string
  subtitle: string
  score: number
}

export type DashboardNavigateTarget =
  | { view: 'respaldo' }
  | { view: 'calendario' }
  | { view: 'dialogo'; threadId: string; seedQuery?: string }
  | { view: 'entidades'; mode: EntityHubMode }
  | { view: 'quantomos' }

interface Props {
  operatorName: string
  refreshKey: number
  onNavigate: (target: DashboardNavigateTarget) => void
}

function formatDateLong(d = new Date()): string {
  const weekday = d.toLocaleDateString('es-ES', { weekday: 'long' })
  const day = d.getDate()
  const month = d.toLocaleDateString('es-ES', { month: 'long' })
  const year = d.getFullYear()
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  return `${cap} ${day} ${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`
}

function kindToEntityMode(kind: DialogoEntityRefType): EntityHubMode | 'quantomos' {
  if (kind === 'project') return 'proyectos'
  if (kind === 'agrupacion') return 'agrupaciones'
  if (kind === 'dominio') return 'dominios'
  if (kind === 'quantomo') return 'quantomos'
  return 'perfiles'
}

function navigateForKind(
  kind: DialogoEntityRefType,
  onNavigate: (t: DashboardNavigateTarget) => void,
): void {
  const mode = kindToEntityMode(kind)
  if (mode === 'quantomos') {
    onNavigate({ view: 'quantomos' })
    return
  }
  onNavigate({ view: 'entidades', mode })
}

export function DashboardSection({
  operatorName,
  refreshKey,
  onNavigate,
}: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TypeaheadHit[]>([])
  const [pins, setPins] = useState<DashboardPin[]>([])
  const [busy, setBusy] = useState(false)
  const [pinMode, setPinMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadPins = useCallback(async () => {
    try {
      const data = await api.listDashboardPins()
      setPins(data.pins)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadPins()
  }, [loadPins, refreshKey])

  useEffect(() => {
    const q = query.trim()
    abortRef.current?.abort()
    if (q.length < 1) {
      setHits([])
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    const t = window.setTimeout(() => {
      void api
        .typeaheadEntities(q, { limit: 8, signal: ac.signal })
        .then((data) => {
          if (ac.signal.aborted) return
          setHits(
            data.results
              .filter(
                (r): r is typeof r & { kind: DialogoEntityRefType } =>
                  r.kind === 'person' ||
                  r.kind === 'project' ||
                  r.kind === 'agrupacion' ||
                  r.kind === 'quantomo' ||
                  r.kind === 'dominio',
              )
              .map((r) => ({
                kind: r.kind,
                id: r.id,
                label: r.label,
                subtitle: r.subtitle,
                score: r.score,
              })),
          )
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          if (err instanceof Error && err.name === 'AbortError') return
          setHits([])
        })
    }, 160)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [query])

  const startDialogo = useCallback(
    async (title: string) => {
      const q = title.trim()
      if (!q || busy) return
      setBusy(true)
      setError(null)
      try {
        const { thread } = await api.createDialogoThread({
          title: q.slice(0, 120),
          section_key: 'dashboard',
        })
        onNavigate({ view: 'dialogo', threadId: thread.id, seedQuery: q })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onNavigate],
  )

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void startDialogo(query)
    } else if (e.key === 'Escape') {
      setHits([])
      setPinMode(false)
    }
  }

  const addPin = async (hit: TypeaheadHit) => {
    if (pins.length >= 12) {
      setError('Máximo 12 atajos')
      return
    }
    const used = new Set(pins.map((p) => p.slot))
    let slot = 0
    while (used.has(slot) && slot < 12) slot += 1
    if (slot > 11) {
      setError('Máximo 12 atajos')
      return
    }
    const next = [
      ...pins.map((p) => ({
        slot: p.slot,
        ref_type: p.ref_type,
        ref_id: p.ref_id,
        label: p.label,
      })),
      {
        slot,
        ref_type: hit.kind,
        ref_id: hit.id,
        label: hit.label,
      },
    ]
    try {
      const data = await api.setDashboardPins(next)
      setPins(data.pins)
      setPinMode(false)
      setQuery('')
      setHits([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removePin = async (slot: number) => {
    const next = pins
      .filter((p) => p.slot !== slot)
      .map((p) => ({
        slot: p.slot,
        ref_type: p.ref_type,
        ref_id: p.ref_id,
        label: p.label,
      }))
    try {
      const data = await api.setDashboardPins(next)
      setPins(data.pins)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="dashboard-stage">
      <header className="dashboard-top">
        <button
          type="button"
          className="dashboard-operator"
          onClick={() => onNavigate({ view: 'respaldo' })}
          title="Ir a Respaldo"
        >
          {operatorName || 'Operador'}
        </button>
        <button
          type="button"
          className="dashboard-date"
          onClick={() => onNavigate({ view: 'calendario' })}
          title="Ir al Calendario"
        >
          {formatDateLong()}
        </button>
        <span className="dashboard-top-spacer" aria-hidden />
      </header>

      <div className="dashboard-search-wrap">
        <label className="dashboard-search-label" htmlFor="dashboard-buscar">
          Buscar
        </label>
        <input
          id="dashboard-buscar"
          ref={inputRef}
          className="dashboard-search"
          type="search"
          placeholder="BUSCAR"
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoComplete="off"
        />
        {hits.length > 0 && (
          <ul className="dashboard-suggest" role="listbox">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <button
                  type="button"
                  className="dashboard-suggest-item"
                  onClick={() => {
                    if (pinMode) {
                      void addPin(h)
                      return
                    }
                    navigateForKind(h.kind, onNavigate)
                  }}
                >
                  <span className="dashboard-suggest-kind">{h.kind}</span>
                  <span className="dashboard-suggest-label">{h.label}</span>
                  {h.subtitle ? (
                    <span className="muted dashboard-suggest-sub">
                      {h.subtitle}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {pinMode && (
          <p className="dashboard-pin-hint muted">
            Elegí una sugerencia para fijarla (máx. 12). Esc para cancelar.
          </p>
        )}
      </div>

      {error && <p className="dashboard-error">{error}</p>}

      <div className="dashboard-pins">
        {pins.map((p) => (
          <div key={p.slot} className="dashboard-pin">
            <button
              type="button"
              className="dashboard-pin-main"
              onClick={() => navigateForKind(p.ref_type, onNavigate)}
              title={p.ref_type}
            >
              <span className="dashboard-pin-kind">{p.ref_type}</span>
              <span className="dashboard-pin-label">{p.label}</span>
            </button>
            <button
              type="button"
              className="dashboard-pin-remove"
              aria-label={`Quitar ${p.label}`}
              onClick={() => void removePin(p.slot)}
            >
              ×
            </button>
          </div>
        ))}
        {pins.length < 12 && (
          <button
            type="button"
            className="dashboard-pin-add"
            onClick={() => {
              setPinMode(true)
              inputRef.current?.focus()
            }}
            title="Agregar atajo"
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}
