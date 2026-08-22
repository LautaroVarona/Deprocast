import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import type { Geografia, GeoKind } from '../types'

interface Props {
  refreshKey: number
  onChanged?: () => void
}

const GEO_KIND_LABEL: Record<GeoKind, string> = {
  lugar: 'Lugar',
  calle: 'Calle',
  ciudad: 'Ciudad',
  barrio: 'Barrio',
  region: 'Región',
  pais: 'País',
  otro: 'Otro',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function GeografiaSection({ refreshKey, onChanged }: Props) {
  const [places, setPlaces] = useState<Geografia[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formKind, setFormKind] = useState<GeoKind>('lugar')
  const [formAliases, setFormAliases] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listGeografia()
      setPlaces(res.masters ?? res.places ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const selected = places.find((d) => d.id === selectedId) ?? null

  function openCreate() {
    setSelectedId(null)
    setFormName('')
    setFormKind('lugar')
    setFormAliases('')
    setFormNotes('')
    setInspectorOpen(true)
    setError(null)
    setStatus(null)
  }

  function openEdit(d: Geografia) {
    setSelectedId(d.id)
    setFormName(d.name)
    setFormKind(d.kind)
    setFormAliases((d.aliases_list ?? []).join(', '))
    setFormNotes(d.notes ?? '')
    setInspectorOpen(true)
    setError(null)
    setStatus(null)
  }

  async function save() {
    const name = formName.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    try {
      const aliases = formAliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (selected) {
        const res = await api.updateGeografia(selected.id, {
          name,
          kind: formKind,
          aliases,
          notes: formNotes,
        })
        setPlaces((prev) =>
          prev
            .map((d) => (d.id === selected.id ? res.place : d))
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        )
        setStatus('Lugar actualizado')
      } else {
        const res = await api.createGeografia({
          name,
          kind: formKind,
          aliases,
          notes: formNotes,
        })
        setPlaces((prev) =>
          [...prev, res.place].sort((a, b) =>
            a.name.localeCompare(b.name, 'es'),
          ),
        )
        setSelectedId(res.place.id)
        setStatus('Lugar creado')
      }
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteGeografia(selected.id)
      setPlaces((prev) => prev.filter((d) => d.id !== selected.id))
      setSelectedId(null)
      setInspectorOpen(false)
      setStatus('Lugar borrado')
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel entity-panel profiles-directory dominios-directory">
      <div className="panel-head entity-head">
        <div>
          <h2>Geografía</h2>
          <p className="muted mono">
            Lugares del corpus · calles, ciudades, regiones
            {places.length > 0 ? ` · ${places.length}` : ''}
          </p>
        </div>
        <div className="entity-head-actions">
          <button
            type="button"
            className="btn btn-tiny btn-primary"
            onClick={openCreate}
          >
            Nuevo lugar
          </button>
        </div>
      </div>

      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}

      {loading && places.length === 0 ? (
        <p className="muted mono">Cargando…</p>
      ) : places.length === 0 ? (
        <p className="muted mono profiles-empty">
          Sin lugares. Creá uno o promové desde la sala de espera (clasificación
          Geografía en el NER).
        </p>
      ) : (
        <div className="profile-card-grid">
          {places.map((d) => (
            <button
              key={d.id}
              type="button"
              className={[
                'profile-card',
                selectedId === d.id ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => openEdit(d)}
            >
              <span className="profile-card-avatar" aria-hidden>
                {initials(d.name)}
              </span>
              <span className="profile-card-body">
                <span className="profile-card-name">{d.name}</span>
                <span className="profile-card-meta mono">
                  {GEO_KIND_LABEL[d.kind] ?? d.kind}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {inspectorOpen && (
        <div className="profile-inspector">
          <h3 className="mono">{selected ? 'Inspector' : 'Crear lugar'}</h3>
          <label className="field">
            <span className="mono">Nombre</span>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="p. ej. Calle 18 · Montevideo"
            />
          </label>
          <label className="field">
            <span className="mono">Tipo</span>
            <select
              value={formKind}
              onChange={(e) => setFormKind(e.target.value as GeoKind)}
            >
              {(Object.keys(GEO_KIND_LABEL) as GeoKind[]).map((k) => (
                <option key={k} value={k}>
                  {GEO_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="mono">Aliases</span>
            <input
              value={formAliases}
              onChange={(e) => setFormAliases(e.target.value)}
              placeholder="separados por coma"
            />
          </label>
          <label className="field">
            <span className="mono">Notas</span>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={5}
              placeholder="Contexto del lugar…"
            />
          </label>
          <div className="actions-row">
            {selected ? (
              <button
                type="button"
                className="btn btn-tiny btn-ghost danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Borrar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-tiny btn-ghost"
              onClick={() => {
                setInspectorOpen(false)
                setSelectedId(null)
              }}
            >
              Cerrar
            </button>
            <button
              type="button"
              className="btn btn-tiny btn-primary"
              disabled={busy || !formName.trim()}
              onClick={() => void save()}
            >
              {selected ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
