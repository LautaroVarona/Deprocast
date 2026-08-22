import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaMatrixHydrated,
  DeproIdaItem,
  DeproIdaKind,
  DeproIdaStage,
  DeproPower,
  Dominio,
} from '../../types'
import { AGENT_BY_ID, DEPRO_DOMAIN_META, powerNumber } from '../../lib/deprocast'
import type { IdaDraft } from './idaDraft'
import { DeprocastIdaTable } from './DeprocastIdaTable'
import { DeprocastAcademia } from './DeprocastAcademia'
import { DeprocastCuarentena } from './DeprocastCuarentena'
import { DeproWeightPicker } from './DeproWeightPicker'

type Props = {
  items: DeproIdaItem[]
  powers: DeproPower[]
  matrix: AmaMatrixHydrated | null
  draft: IdaDraft | null
  onDraftConsumed: () => void
  onChanged: () => void
}

type IdaView = 'tabla' | 'tablero' | 'academia' | 'cuarentena'

const STAGES: Array<{ id: DeproIdaStage; label: string; kicker: string }> = [
  { id: 'investigacion', label: 'Investigación', kicker: 'I' },
  { id: 'desarrollo', label: 'Desarrollo', kicker: 'D' },
  { id: 'aplicacion', label: 'Aplicación', kicker: 'A' },
]

const NEXT: Record<DeproIdaStage, DeproIdaStage | null> = {
  investigacion: 'desarrollo',
  desarrollo: 'aplicacion',
  aplicacion: null,
}

const PREV: Record<DeproIdaStage, DeproIdaStage | null> = {
  investigacion: null,
  desarrollo: 'investigacion',
  aplicacion: 'desarrollo',
}

export function DeprocastIda({
  items,
  powers,
  matrix,
  draft,
  onDraftConsumed,
  onChanged,
}: Props) {
  const [view, setView] = useState<IdaView>('tabla')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<DeproIdaKind>('organismo')
  const [rowId, setRowId] = useState('')
  const [colId, setColId] = useState('')
  const [weight, setWeight] = useState<number | null>(null)
  const [domainIds, setDomainIds] = useState<string[]>([])
  const [dominios, setDominios] = useState<Dominio[]>([])
  const [links, setLinks] = useState<
    Pick<IdaDraft, 'power_indexes' | 'agent_ids' | 'tags'>
  >({})
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<DeproIdaItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | DeproIdaKind>('all')
  const [sphereFilter, setSphereFilter] = useState<string>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    void api
      .listDominios()
      .then((res) => {
        if (!cancelled) setDominios(res.dominios ?? [])
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      cancelled = true
    }
  }, [onChanged, items])

  useEffect(() => {
    if (!draft) return
    setTitle(draft.title)
    setBody(draft.body ?? '')
    setLinks({
      power_indexes: draft.power_indexes,
      agent_ids: draft.agent_ids,
      tags: draft.tags,
    })
    setKind(draft.kind ?? 'organismo')
    setRowId(draft.row_item_id ?? '')
    setColId(draft.col_item_id ?? '')
    setWeight(draft.weight ?? null)
    setDomainIds(draft.domain_ids ?? [])
    setEditing(null)
    setView(draft.kind === 'aprendizaje' ? 'tabla' : 'tablero')
  }, [draft])

  const rows = matrix?.row_list.items.slice(0, 6) ?? []
  const cols = matrix?.col_list.items.slice(0, 6) ?? []
  const dominioById = useMemo(() => {
    const map = new Map<string, Dominio>()
    for (const d of dominios) map.set(d.id, d)
    return map
  }, [dominios])

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (sphereFilter !== 'all' && item.col_item_id !== sphereFilter) {
        return false
      }
      if (
        domainFilter !== 'all' &&
        !(item.domain_ids ?? []).includes(domainFilter)
      ) {
        return false
      }
      return true
    })
  }, [items, kindFilter, sphereFilter, domainFilter])

  const byStage = useMemo(() => {
    const map: Record<DeproIdaStage, DeproIdaItem[]> = {
      investigacion: [],
      desarrollo: [],
      aplicacion: [],
    }
    for (const item of filtered) {
      map[item.stage].push(item)
    }
    return map
  }, [filtered])

  function toggleDomain(id: string) {
    setDomainIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function resetForm() {
    setTitle('')
    setBody('')
    setKind('organismo')
    setRowId('')
    setColId('')
    setWeight(null)
    setDomainIds([])
    setLinks({})
    setEditing(null)
    setError(null)
    onDraftConsumed()
  }

  async function submit() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await api.deprocastPatchIda(editing.id, {
          title: t,
          body,
          kind,
          row_item_id: rowId || null,
          col_item_id: colId || null,
          weight,
          domain_ids: domainIds,
        })
      } else {
        await api.deprocastCreateIda({
          title: t,
          body,
          stage: 'investigacion',
          power_indexes: links.power_indexes,
          agent_ids: links.agent_ids,
          tags: links.tags,
          kind,
          row_item_id: rowId || null,
          col_item_id: colId || null,
          weight,
          domain_ids: domainIds,
        })
      }
      resetForm()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function move(item: DeproIdaItem, stage: DeproIdaStage) {
    setBusy(true)
    setError(null)
    try {
      await api.deprocastPatchIda(item.id, { stage })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover')
    } finally {
      setBusy(false)
    }
  }

  async function archive(item: DeproIdaItem) {
    setBusy(true)
    try {
      await api.deprocastPatchIda(item.id, { archived: true })
      if (editing?.id === item.id) resetForm()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo archivar')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: DeproIdaItem) {
    if (item.origin === 'seed') {
      await archive(item)
      return
    }
    setBusy(true)
    try {
      await api.deprocastDeleteIda(item.id)
      if (editing?.id === item.id) resetForm()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(item: DeproIdaItem) {
    setEditing(item)
    setTitle(item.title)
    setBody(item.body)
    setKind(item.kind)
    setRowId(item.row_item_id ?? '')
    setColId(item.col_item_id ?? '')
    setWeight(item.weight)
    setDomainIds(item.domain_ids ?? [])
    setLinks({
      power_indexes: item.power_indexes,
      agent_ids: item.agent_ids,
      tags: item.tags,
    })
    setView('tablero')
  }

  return (
    <div className="depro-ida">
      <div className="depro-ida-views" role="tablist" aria-label="Vistas IDA">
        <button
          type="button"
          className={view === 'tabla' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setView('tabla')}
        >
          Tabla
        </button>
        <button
          type="button"
          className={view === 'tablero' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setView('tablero')}
        >
          Tablero
        </button>
        <button
          type="button"
          className={view === 'academia' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setView('academia')}
        >
          Academia
        </button>
        <button
          type="button"
          className={
            view === 'cuarentena' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setView('cuarentena')}
        >
          Cuarentena
        </button>
      </div>

      {view === 'tabla' ? (
        <DeprocastIdaTable
          matrix={matrix}
          items={items}
          onChanged={onChanged}
        />
      ) : null}

      {view === 'academia' ? <DeprocastAcademia /> : null}

      {view === 'cuarentena' ? (
        <DeprocastCuarentena onChanged={onChanged} />
      ) : null}

      {view === 'tablero' ? (
        <>
          <section className="panel depro-ida-compose">
            <header className="panel-head">
              <h2>IDA</h2>
              <span className="muted mono">
                Investigación · Desarrollo · Aplicación
              </span>
            </header>
            <p className="muted depro-lead">
              Acá se ponen las cosas y se las hace subir de grado. Aplicar no
              reescribe el TypeScript: deja constancia. Cargar el poder en código
              es el acto.
            </p>
            <div className="depro-filters">
              <button
                type="button"
                className={kind === 'organismo' ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => setKind('organismo')}
              >
                Organismo
              </button>
              <button
                type="button"
                className={kind === 'aprendizaje' ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => setKind('aprendizaje')}
              >
                Aprendizaje
              </button>
            </div>
            <label className="depro-label" htmlFor="ida-title">
              {editing ? 'Editar ficha' : 'Nueva ficha'}
            </label>
            <input
              id="ida-title"
              className="depro-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Qué se está investigando, desarrollando o aplicando"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
            />
            <textarea
              className="depro-textarea"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Notas, hipótesis, contrato IPO…"
            />
            {dominios.length > 0 ? (
              <div className="depro-ida-domains">
                <span className="depro-label">Dominios</span>
                <div className="depro-filters">
                  {dominios.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={
                        domainIds.includes(d.id)
                          ? 'filter-chip is-active'
                          : 'filter-chip'
                      }
                      onClick={() => toggleDomain(d.id)}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {kind === 'aprendizaje' && (
              <>
                <div className="depro-ida-coords">
                  <label className="depro-label">
                    Proceso
                    <select
                      className="depro-input"
                      value={rowId}
                      onChange={(e) => setRowId(e.target.value)}
                    >
                      <option value="">(sin fila)</option>
                      {rows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="depro-label">
                    Esfera
                    <select
                      className="depro-input"
                      value={colId}
                      onChange={(e) => setColId(e.target.value)}
                    >
                      <option value="">(sin columna)</option>
                      {cols.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <DeproWeightPicker value={weight} onChange={setWeight} />
              </>
            )}
            {(links.agent_ids?.length ||
              links.power_indexes?.length ||
              links.tags?.length) ? (
              <p className="muted mono depro-ida-links">
                {links.agent_ids?.map((id) => AGENT_BY_ID[id]?.name ?? id).join(' · ')}
                {links.power_indexes?.length
                  ? ` · poderes ${links.power_indexes.map((n) => powerNumber(n)).join(',')}`
                  : ''}
                {links.tags?.length ? ` · ${links.tags.join(' · ')}` : ''}
              </p>
            ) : null}
            {error && <p className="status-line err">{error}</p>}
            <div className="depro-inspect-actions">
              <button
                type="button"
                className="btn btn-tiny"
                disabled={busy || !title.trim()}
                onClick={() => void submit()}
              >
                {editing ? 'Guardar' : 'Poner en Investigación'}
              </button>
              {editing && (
                <button type="button" className="btn btn-tiny" onClick={resetForm}>
                  Cancelar
                </button>
              )}
            </div>
          </section>

          <div className="depro-filters">
            <button
              type="button"
              className={kindFilter === 'all' ? 'filter-chip is-active' : 'filter-chip'}
              onClick={() => setKindFilter('all')}
            >
              Todas
            </button>
            <button
              type="button"
              className={
                kindFilter === 'organismo' ? 'filter-chip is-active' : 'filter-chip'
              }
              onClick={() => setKindFilter('organismo')}
            >
              Organismo
            </button>
            <button
              type="button"
              className={
                kindFilter === 'aprendizaje' ? 'filter-chip is-active' : 'filter-chip'
              }
              onClick={() => setKindFilter('aprendizaje')}
            >
              Aprendizaje
            </button>
            {cols.map((c) => (
              <button
                key={c.id}
                type="button"
                className={
                  sphereFilter === c.id ? 'filter-chip is-active' : 'filter-chip'
                }
                onClick={() =>
                  setSphereFilter((prev) => (prev === c.id ? 'all' : c.id))
                }
              >
                {c.label}
              </button>
            ))}
          </div>
          {dominios.length > 0 ? (
            <div className="depro-filters depro-ida-domain-filters">
              <span className="muted mono">Dominios</span>
              {dominios.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={
                    domainFilter === d.id ? 'filter-chip is-active' : 'filter-chip'
                  }
                  onClick={() =>
                    setDomainFilter((prev) => (prev === d.id ? 'all' : d.id))
                  }
                >
                  {d.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="depro-ida-board">
            {STAGES.map((col) => (
              <section key={col.id} className="panel depro-ida-col">
                <header className="panel-head">
                  <h2>
                    <span className="depro-ida-kicker">{col.kicker}</span>{' '}
                    {col.label}
                  </h2>
                  <span className="muted mono">{byStage[col.id].length}</span>
                </header>
                <ul className="depro-ida-list">
                  {byStage[col.id].map((item) => (
                    <li key={item.id} className="depro-ida-card">
                      <strong>{item.title}</strong>
                      {item.body ? <p>{item.body}</p> : null}
                      <p className="muted mono">
                        {item.kind}
                        {item.weight != null ? ` · peso ${item.weight}` : ''}
                        {` · ${item.origin}`}
                        {(item.domain_ids ?? []).length
                          ? ` · ${(item.domain_ids ?? [])
                              .map((id) => dominioById.get(id)?.name ?? id)
                              .join(', ')}`
                          : ''}
                        {item.agent_ids.length
                          ? ` · ${item.agent_ids.map((id) => AGENT_BY_ID[id]?.name ?? id).join(', ')}`
                          : ''}
                        {item.power_indexes.length
                          ? ` · ${item.power_indexes
                              .map((n) => {
                                const p = powers[n]
                                return p
                                  ? `${powerNumber(n)} ${p.name}`
                                  : powerNumber(n)
                              })
                              .join(', ')}`
                          : ''}
                        {item.tags.length
                          ? ` · ${item.tags
                              .map(
                                (t) =>
                                  DEPRO_DOMAIN_META[
                                    t as keyof typeof DEPRO_DOMAIN_META
                                  ]?.label ?? t,
                              )
                              .join(', ')}`
                          : ''}
                      </p>
                      <div className="depro-ida-card-actions">
                        {PREV[item.stage] && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={busy}
                            onClick={() => void move(item, PREV[item.stage]!)}
                          >
                            ←
                          </button>
                        )}
                        {NEXT[item.stage] && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={
                              busy ||
                              (item.kind === 'aprendizaje' &&
                                item.weight == null)
                            }
                            title={
                              item.kind === 'aprendizaje' && item.weight == null
                                ? 'Sin peso HITL no baja a Coagula'
                                : undefined
                            }
                            onClick={() => void move(item, NEXT[item.stage]!)}
                          >
                            {NEXT[item.stage] === 'desarrollo' ? '→ D' : '→ A'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-tiny"
                          disabled={busy}
                          onClick={() => startEdit(item)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-tiny"
                          disabled={busy}
                          onClick={() => void remove(item)}
                        >
                          {item.origin === 'seed' ? 'Archivar' : 'Borrar'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
