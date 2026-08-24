import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type { Geografia, GeografiaTreeNode, GeoKind } from '../types'
import { AtlasTree } from './atlas/AtlasTree'

interface Props {
  refreshKey: number
  onChanged?: () => void
  onOpenAtlas?: (id: string) => void
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

function flatten(nodes: GeografiaTreeNode[]): Geografia[] {
  const out: Geografia[] = []
  const walk = (list: GeografiaTreeNode[]) => {
    for (const n of list) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export function GeografiaSection({
  refreshKey,
  onChanged,
  onOpenAtlas,
}: Props) {
  const [tree, setTree] = useState<GeografiaTreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formKind, setFormKind] = useState<GeoKind>('lugar')
  const [formAliases, setFormAliases] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formParentId, setFormParentId] = useState('')
  const [formWeight, setFormWeight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['geo-europa', 'geo-es', 'geo-es-vc']),
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listGeografiaTree()
      setTree(res.tree ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const places = useMemo(() => flatten(tree), [tree])
  const selected = places.find((d) => d.id === selectedId) ?? null
  const official = selected?.source === 'official'

  function openCreate() {
    setSelectedId(null)
    setFormName('')
    setFormKind('lugar')
    setFormAliases('')
    setFormNotes('')
    setFormParentId(selectedId ?? '')
    setFormWeight(0)
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
    setFormParentId(d.parent_id ?? '')
    setFormWeight(d.human_weight ?? 0)
    setInspectorOpen(true)
    setError(null)
    setStatus(null)
  }

  async function save() {
    const name = formName.trim()
    if ((!name && !selected) || busy) return
    setBusy(true)
    setError(null)
    try {
      const aliases = formAliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (selected) {
        await api.updateGeografia(selected.id, {
          name: official ? undefined : name,
          kind: official ? undefined : formKind,
          aliases,
          notes: formNotes,
          parent_id: official ? undefined : formParentId || null,
          human_weight: formWeight,
        })
        setStatus('Lugar actualizado')
      } else {
        const res = await api.createGeografia({
          name,
          kind: formKind,
          aliases,
          notes: formNotes,
          parent_id: formParentId || null,
        })
        setSelectedId(res.place.id)
        setStatus(
          res.place.source === 'official'
            ? 'Coincidió con el gazetteer oficial'
            : 'Lugar creado',
        )
      }
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || busy || official) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteGeografia(selected.id)
      setSelectedId(null)
      setInspectorOpen(false)
      setStatus('Lugar borrado')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="panel entity-panel profiles-directory dominios-directory">
      <div className="panel-head entity-head">
        <div>
          <h2>Geografía</h2>
          <p className="muted mono">
            Árbol administrativo + topónimos de la RUN
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
          Sin lugares. El gazetteer se siembra al arrancar; si no aparece,
          reinicia el servidor.
        </p>
      ) : (
        <div className="geografia-tree-wrap">
          <AtlasTree
            nodes={tree}
            selectedId={selectedId}
            expanded={expanded}
            onToggle={toggle}
            onSelect={(id) => {
              const d = places.find((p) => p.id === id)
              if (d) openEdit(d)
            }}
          />
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
              disabled={official}
              placeholder="p. ej. Calle 18 · Montevideo"
            />
          </label>
          <label className="field">
            <span className="mono">Tipo</span>
            <select
              value={formKind}
              disabled={official}
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
            <span className="mono">Padre</span>
            <select
              value={formParentId}
              disabled={official}
              onChange={(e) => setFormParentId(e.target.value)}
            >
              <option value="">(raíz)</option>
              {places
                .filter((p) => p.id !== selectedId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span className="mono">Peso {formWeight}</span>
            <input
              type="range"
              min={0}
              max={12}
              value={formWeight}
              onChange={(e) => setFormWeight(Number(e.target.value))}
            />
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
              rows={4}
              placeholder="Contexto del lugar…"
            />
          </label>
          {official ? (
            <p className="muted mono">Nodo oficial · no se borra ni se reparenta.</p>
          ) : null}
          <div className="actions-row">
            {selected && !official ? (
              <button
                type="button"
                className="btn btn-tiny btn-ghost danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Borrar
              </button>
            ) : null}
            {selected && onOpenAtlas ? (
              <button
                type="button"
                className="btn btn-tiny btn-ghost"
                onClick={() => onOpenAtlas(selected.id)}
              >
                Ver en Atlas
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
              disabled={busy || (!selected && !formName.trim())}
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
