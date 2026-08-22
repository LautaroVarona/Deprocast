import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import type { Dominio } from '../types'

interface Props {
  refreshKey: number
  onChanged?: () => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function DominiosSection({ refreshKey, onChanged }: Props) {
  const [dominios, setDominios] = useState<Dominio[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listDominios()
      setDominios(res.dominios ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const selected = dominios.find((d) => d.id === selectedId) ?? null

  function openCreate() {
    setSelectedId(null)
    setFormName('')
    setFormNotes('')
    setInspectorOpen(true)
    setError(null)
    setStatus(null)
  }

  function openEdit(d: Dominio) {
    setSelectedId(d.id)
    setFormName(d.name)
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
      if (selected) {
        const body =
          selected.is_fixed
            ? { notes: formNotes }
            : { name, notes: formNotes }
        const res = await api.updateDominio(selected.id, body)
        setDominios((prev) =>
          prev
            .map((d) => (d.id === selected.id ? res.dominio : d))
            .sort((a, b) => {
              if (a.is_fixed !== b.is_fixed) return b.is_fixed - a.is_fixed
              return a.name.localeCompare(b.name, 'es')
            }),
        )
        setStatus('Dominio actualizado')
      } else {
        const res = await api.createDominio({ name, notes: formNotes })
        setDominios((prev) =>
          [...prev, res.dominio].sort((a, b) => {
            if (a.is_fixed !== b.is_fixed) return b.is_fixed - a.is_fixed
            return a.name.localeCompare(b.name, 'es')
          }),
        )
        setSelectedId(res.dominio.id)
        setStatus('Dominio creado')
      }
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || selected.is_fixed || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteDominio(selected.id)
      setDominios((prev) => prev.filter((d) => d.id !== selected.id))
      setSelectedId(null)
      setInspectorOpen(false)
      setStatus('Dominio borrado')
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
          <h2>Dominios</h2>
          <p className="muted mono">
            Áreas de vida · fijos + manuales · ancla de fichas IDA
            {dominios.length > 0 ? ` · ${dominios.length}` : ''}
          </p>
        </div>
        <div className="entity-head-actions">
          <button
            type="button"
            className="btn btn-tiny btn-primary"
            onClick={openCreate}
          >
            Nuevo dominio
          </button>
        </div>
      </div>

      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}

      {loading && dominios.length === 0 ? (
        <p className="muted mono">Cargando…</p>
      ) : dominios.length === 0 ? (
        <p className="muted mono profiles-empty">
          Sin dominios. Los fijos se siembran al arrancar el servidor.
        </p>
      ) : (
        <div className="profile-card-grid">
          {dominios.map((d) => (
            <button
              key={d.id}
              type="button"
              className={[
                'profile-card',
                selectedId === d.id ? 'is-active' : '',
                d.is_fixed ? 'is-fixed-domain' : '',
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
                  {d.is_fixed ? 'fijo' : 'manual'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {inspectorOpen && (
        <div className="profile-inspector">
          <h3 className="mono">
            {selected
              ? selected.is_fixed
                ? 'Dominio fijo'
                : 'Inspector'
              : 'Crear dominio'}
          </h3>
          <label className="field">
            <span className="mono">Nombre</span>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="p. ej. Educación"
              disabled={Boolean(selected?.is_fixed)}
            />
          </label>
          <label className="field">
            <span className="mono">Notas</span>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={5}
              placeholder="Qué cubre este dominio…"
            />
          </label>
          {selected?.is_fixed ? (
            <p className="muted mono">
              Semilla segura: no se borra ni se renombra. Podés editar las notas.
            </p>
          ) : null}
          <div className="actions-row">
            {selected && !selected.is_fixed ? (
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
