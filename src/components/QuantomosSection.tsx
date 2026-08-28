import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type { LinkHarvest, Quantomo } from '../types'
import { downloadJson } from '../utils/downloadJson'

interface Props {
  refreshKey: number
}

type QuantomoRow = Quantomo & {
  entry_title: string
  entry_status: string
  timestamp_exact: string | null
  original_filename: string | null
  entry_created_at: string
}

type SortMode = 'weight' | 'date' | 'title'
type Pane = 'quantomos' | 'links'
type StageFilter = 'sealed' | 'proto' | 'pre' | 'premium' | 'all'
type SourceKindFilter = 'all' | 'notebook' | 'notebook_l72' | 'other'

function sourceKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'notebook':
      return 'Hoja'
    case 'notebook_l72':
      return 'L72 cuaderno'
    case 'dialogo':
      return 'Diálogo'
    case 'chat_import':
      return 'Chat'
    case 'audio':
      return 'Audio'
    case 'blob':
      return 'Blob'
    case 'bookmark':
      return 'Bookmark'
    case 'manual':
      return 'Manual'
    default:
      return kind?.trim() || '—'
  }
}

function formatTs(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso.replace('T', ' ').slice(0, 16)
  }
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function QuantomosSection({ refreshKey }: Props) {
  const [pane, setPane] = useState<Pane>('quantomos')
  const [quantomos, setQuantomos] = useState<QuantomoRow[]>([])
  const [universes, setUniverses] = useState<
    Array<{ name: string; count: number }>
  >([])
  const [avgWeight, setAvgWeight] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [universeFilter, setUniverseFilter] = useState<string>('all')
  const [stageFilter, setStageFilter] = useState<StageFilter>('sealed')
  const [sourceKindFilter, setSourceKindFilter] =
    useState<SourceKindFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('weight')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lattice, setLattice] = useState<{
    canonical: number[] | null
    domain_energies: number[]
    seal_ok: boolean
    premium?: number | null
  } | null>(null)

  const [links, setLinks] = useState<LinkHarvest[]>([])
  const [linksTotal, setLinksTotal] = useState(0)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkSource, setLinkSource] = useState<string>('all')
  const [linksBusy, setLinksBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listQuantomos(stageFilter)
      setQuantomos(data.quantomos)
      setUniverses(data.universes)
      setAvgWeight(data.avg_weight)
      setSelectedId((prev) =>
        prev && data.quantomos.some((q) => q.id === prev) ? prev : null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar quántomos')
    } finally {
      setLoading(false)
    }
  }, [stageFilter])

  const loadLinks = useCallback(async () => {
    setLinksBusy(true)
    setError(null)
    try {
      const data = await api.listLinks({
        q: linkQuery.trim() || undefined,
        source_type: linkSource === 'all' ? undefined : linkSource,
        limit: 500,
      })
      setLinks(data.links)
      setLinksTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar links')
    } finally {
      setLinksBusy(false)
    }
  }, [linkQuery, linkSource])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!selectedId) {
      setLattice(null)
      return
    }
    let cancelled = false
    void api
      .getQuantomoLattice(selectedId)
      .then((data) => {
        if (cancelled) return
        setLattice({
          canonical: data.canonical,
          domain_energies: data.domain_energies,
          seal_ok: data.seal_ok,
        })
      })
      .catch(() => {
        if (!cancelled) setLattice(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    if (pane === 'links') void loadLinks()
  }, [pane, loadLinks, refreshKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = quantomos
    if (universeFilter !== 'all') {
      list = list.filter(
        (item) =>
          (item.universe || 'sin universo').trim() === universeFilter,
      )
    }
    if (sourceKindFilter === 'notebook') {
      list = list.filter((item) => item.source_kind === 'notebook')
    } else if (sourceKindFilter === 'notebook_l72') {
      list = list.filter((item) => item.source_kind === 'notebook_l72')
    } else if (sourceKindFilter === 'other') {
      list = list.filter(
        (item) =>
          item.source_kind !== 'notebook' &&
          item.source_kind !== 'notebook_l72',
      )
    }
    if (q) {
      list = list.filter((item) => {
        const hay = [
          item.title,
          item.content ?? '',
          item.entry_title,
          item.universe ?? '',
          item.original_filename ?? '',
          item.source_kind ?? '',
        ]
          .join('\n')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    const sorted = [...list]
    if (sortMode === 'weight') {
      sorted.sort(
        (a, b) => (b.hermetic_weight ?? -1) - (a.hermetic_weight ?? -1),
      )
    } else if (sortMode === 'date') {
      sorted.sort((a, b) => {
        const ta = a.timestamp_exact || a.entry_created_at
        const tb = b.timestamp_exact || b.entry_created_at
        return tb.localeCompare(ta)
      })
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'es'))
    }
    return sorted
  }, [quantomos, query, universeFilter, sourceKindFilter, sortMode])

  const selected = useMemo(
    () => filtered.find((q) => q.id === selectedId) ?? null,
    [filtered, selectedId],
  )

  const handleExport = () => {
    if (filtered.length === 0) return
    const day = new Date().toISOString().slice(0, 10)
    downloadJson(`deprocast-quantomos-${day}.json`, {
      exported_at: new Date().toISOString(),
      source: 'deprocast-quantomos',
      count: filtered.length,
      avg_weight: avgWeight,
      universes,
      filter: { query, universe: universeFilter, sort: sortMode },
      quantomos: filtered.map((q) => ({
        id: q.id,
        title: q.title,
        content: q.content,
        hermetic_weight: q.hermetic_weight,
        universe: q.universe,
        entry_id: q.entry_id,
        entry_title: q.entry_title,
        timestamp_exact: q.timestamp_exact,
        original_filename: q.original_filename,
      })),
    })
  }

  async function handleBackfill() {
    setLinksBusy(true)
    setError(null)
    try {
      const res = await api.backfillLinks()
      setError(null)
      await loadLinks()
      // reuse status via error line as muted info — keep simple
      console.info('[links/backfill]', res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en backfill')
    } finally {
      setLinksBusy(false)
    }
  }

  return (
    <div className="entity-stage quantomos-stage">
      <section className="panel entity-panel">
        <div className="panel-head entity-head">
          <div>
            <h2>{pane === 'quantomos' ? 'Quántomos' : 'Links'}</h2>
            <p className="muted mono">
              {pane === 'quantomos'
                ? `Unidades de sentido validadas${quantomos.length > 0 ? ` · ${quantomos.length}` : ''}${avgWeight != null ? ` · peso medio ${avgWeight}` : ''}`
                : `Receptor de URLs del corpus · ${linksTotal} en harvest`}
            </p>
          </div>
          <div className="entity-head-actions">
            <div className="filter-rail" role="tablist" aria-label="Vista">
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'quantomos'}
                className={
                  pane === 'quantomos' ? 'filter-chip is-active' : 'filter-chip'
                }
                onClick={() => setPane('quantomos')}
              >
                Quántomos
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'links'}
                className={
                  pane === 'links' ? 'filter-chip is-active' : 'filter-chip'
                }
                onClick={() => setPane('links')}
              >
                Links
              </button>
            </div>
            {pane === 'quantomos' ? (
              <>
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  disabled={filtered.length === 0}
                  onClick={handleExport}
                >
                  Exportar
                </button>
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => void load()}
                >
                  Recargar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  disabled={linksBusy}
                  onClick={() => void handleBackfill()}
                >
                  Backfill corpus
                </button>
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={linksBusy}
                  onClick={() => void loadLinks()}
                >
                  Recargar
                </button>
              </>
            )}
          </div>
        </div>

        {pane === 'quantomos' ? (
          <>
            <div className="quantomo-stats">
              {universes.slice(0, 8).map((u) => (
                <button
                  key={u.name}
                  type="button"
                  className={
                    universeFilter === u.name
                      ? 'filter-chip is-active'
                      : 'filter-chip'
                  }
                  onClick={() =>
                    setUniverseFilter((cur) =>
                      cur === u.name ? 'all' : u.name,
                    )
                  }
                >
                  {u.name} · {u.count}
                </button>
              ))}
              {universeFilter !== 'all' && (
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  onClick={() => setUniverseFilter('all')}
                >
                  Todos
                </button>
              )}
            </div>

            <div className="filter-rail" role="tablist" aria-label="Etapa">
              {(
                [
                  ['sealed', 'Sellados'],
                  ['proto', 'Proto'],
                  ['pre', 'Pre'],
                  ['premium', 'Premium'],
                  ['all', 'Todos'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={stageFilter === value}
                  className={
                    stageFilter === value
                      ? 'filter-chip is-active'
                      : 'filter-chip'
                  }
                  onClick={() => setStageFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="filter-rail" role="tablist" aria-label="Origen">
              {(
                [
                  ['all', 'Origen'],
                  ['notebook', 'Hoja'],
                  ['notebook_l72', 'L72 cuaderno'],
                  ['other', 'Otros'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={sourceKindFilter === value}
                  className={
                    sourceKindFilter === value
                      ? 'filter-chip is-active'
                      : 'filter-chip'
                  }
                  onClick={() => setSourceKindFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="profiles-toolbar">
              <label className="semantic-search">
                <span className="mono">Buscar</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Título, contenido, fuente…"
                />
              </label>
              <div className="filter-rail" role="tablist" aria-label="Orden">
                {(
                  [
                    ['weight', 'Peso'],
                    ['date', 'Fecha'],
                    ['title', 'Título'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={sortMode === value}
                    className={
                      sortMode === value
                        ? 'filter-chip is-active'
                        : 'filter-chip'
                    }
                    onClick={() => setSortMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loading && quantomos.length === 0 ? (
              <p className="muted mono">Cargando…</p>
            ) : filtered.length === 0 ? (
              <p className="muted mono">
                {quantomos.length === 0
                  ? 'Sin quántomos validados todavía'
                  : 'Nada con este filtro'}
              </p>
            ) : (
              <div className="quantomo-layout">
                <ul className="quantomo-list">
                  {filtered.map((q) => (
                    <li key={q.id}>
                      <button
                        type="button"
                        className={
                          selectedId === q.id
                            ? 'quantomo-row is-active'
                            : 'quantomo-row'
                        }
                        onClick={() => setSelectedId(q.id)}
                      >
                        <span className="quantomo-row-title">{q.title}</span>
                        <span className="quantomo-row-meta mono">
                          w{q.hermetic_weight ?? '—'}
                          {q.stage ? ` · ${q.stage}` : ''}
                          {` · ${sourceKindLabel(q.source_kind)}`}
                          {q.universe ? ` · ${q.universe}` : ''}
                          {` · ${q.entry_title}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <aside className="quantomo-inspector">
                  {!selected ? (
                    <p className="muted mono">
                      Elegí un quántomo para leerlo en detalle
                    </p>
                  ) : (
                    <>
                      <h3>{selected.title}</h3>
                      <p className="mono muted quantomo-inspector-meta">
                        {selected.stage ?? '—'} · peso {selected.hermetic_weight ?? '—'}
                        {` · ${sourceKindLabel(selected.source_kind)}`}
                        {selected.universe
                          ? ` · universo ${selected.universe}`
                          : ''}
                      </p>
                      <p className="mono muted">
                        Fuente · {selected.entry_title}
                        {selected.original_filename
                          ? ` · ${selected.original_filename}`
                          : ''}
                      </p>
                      <p className="mono muted">
                        {formatTs(
                          selected.timestamp_exact || selected.entry_created_at,
                        )}
                      </p>
                      <div className="quantomo-body">
                        {selected.content?.trim() ? (
                          selected.content
                        ) : (
                          <span className="muted">Sin contenido</span>
                        )}
                      </div>
                      {lattice && (
                        <div className="lattice-block">
                          <p className="mono muted">
                            L72 {lattice.seal_ok ? 'sello ok' : 'sin sello'}
                          </p>
                          {lattice.domain_energies.length > 0 && (
                            <div className="lattice-energies">
                              {lattice.domain_energies.map((e, i) => (
                                <span
                                  key={i}
                                  className="lattice-energy"
                                  style={{
                                    opacity: Math.min(
                                      1,
                                      0.25 + e / (Math.max(...lattice.domain_energies) || 1),
                                    ),
                                  }}
                                />
                              ))}
                            </div>
                          )}
                          {lattice.canonical && lattice.canonical.length === 72 && (
                            <div className="lattice-grid" aria-hidden>
                              {lattice.canonical.map((cell, i) => (
                                <span
                                  key={i}
                                  className="lattice-cell"
                                  style={{
                                    opacity: Math.min(
                                      1,
                                      0.15 + Math.abs(cell) / 8000,
                                    ),
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </aside>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="profiles-toolbar">
              <label className="semantic-search">
                <span className="mono">Buscar</span>
                <input
                  type="search"
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadLinks()
                  }}
                  placeholder="URL, remitente…"
                />
              </label>
              <div className="filter-rail" role="tablist" aria-label="Fuente">
                {(
                  [
                    ['all', 'Todos'],
                    ['chat_message', 'Chat'],
                    ['bookmark', 'Bookmark'],
                    ['quantomo', 'Quántomo'],
                    ['entry', 'Entry'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={linkSource === value}
                    className={
                      linkSource === value
                        ? 'filter-chip is-active'
                        : 'filter-chip'
                    }
                    onClick={() => setLinkSource(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {linksBusy && links.length === 0 ? (
              <p className="muted mono">Cargando links…</p>
            ) : links.length === 0 ? (
              <p className="muted mono">
                Sin links cosechados. Importá un chat o corré Backfill corpus.
              </p>
            ) : (
              <ul className="quantomo-list">
                {links.map((l) => (
                  <li key={l.id} className="quantomo-row" style={{ display: 'block' }}>
                    <a
                      href={l.url_cruda}
                      target="_blank"
                      rel="noreferrer"
                      className="quantomo-row-title"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {l.url_cruda}
                    </a>
                    <span className="quantomo-row-meta mono">
                      {l.source_type}
                      {l.remitente ? ` · ${l.remitente}` : ''}
                      {l.chat_nombre ? ` · ${l.chat_nombre}` : ''}
                      {` · ${formatTs(l.timestamp_captura || l.created_at)}`}
                      {` · crawler ${l.estado_crawler}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && <p className="status-line err">{error}</p>}
      </section>
    </div>
  )
}
