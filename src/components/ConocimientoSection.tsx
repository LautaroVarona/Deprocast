import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type {
  AmaListItem,
  AmaMatrixHydrated,
  KnowledgeEntity,
  KnowledgeKind,
  KnowledgeNeighbor,
} from '../types'

interface Props {
  refreshKey: number
  onChanged?: () => void
}

const KINDS: KnowledgeKind[] = [
  'repo',
  'paper',
  'legal',
  'book',
  'dataset',
  'curriculum',
  'other',
]

const KIND_LABEL: Record<KnowledgeKind, string> = {
  repo: 'Repo',
  paper: 'Paper',
  legal: 'Ley',
  book: 'Libro',
  dataset: 'Dataset',
  curriculum: 'Curriculum',
  other: 'Otro',
}

const PULSE_LABEL = {
  vivo: 'Vivo',
  tibio: 'Tibio',
  abandonado: 'Abandonado',
} as const

function pulseClass(pulse?: string | null): string {
  if (pulse === 'vivo') return 'badge badge-pending_review'
  if (pulse === 'abandonado') return 'badge badge-rejected'
  if (pulse === 'tibio') return 'badge badge-pending_criba'
  return 'badge'
}

export function ConocimientoSection({ refreshKey, onChanged }: Props) {
  const [items, setItems] = useState<KnowledgeEntity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [pulseFilter, setPulseFilter] = useState<string>('all')
  const [url, setUrl] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualOwner, setManualOwner] = useState('')
  const [manualKind, setManualKind] = useState<KnowledgeKind>('repo')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<KnowledgeEntity | null>(null)
  const [weight, setWeight] = useState(7)
  const [neighbors, setNeighbors] = useState<KnowledgeNeighbor[]>([])
  const [harvest, setHarvest] = useState<
    Array<{ id: string; url_cruda: string; estado_crawler: string }>
  >([])
  const [captureMatrix, setCaptureMatrix] = useState<AmaMatrixHydrated | null>(
    null,
  )
  const [crossMatrix, setCrossMatrix] = useState<AmaMatrixHydrated | null>(null)
  const [anchorRow, setAnchorRow] = useState('')
  const [anchorCol, setAnchorCol] = useState('')
  const [anchorRole, setAnchorRole] = useState<'conocimiento' | 'interseccion'>(
    'conocimiento',
  )

  const selected = detail?.id === selectedId ? detail : items.find((i) => i.id === selectedId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listKnowledge({
        q: query.trim() || undefined,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        pulse: pulseFilter === 'all' ? undefined : pulseFilter,
      })
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [query, kindFilter, pulseFilter])

  useEffect(() => {
    void load()
  }, [refreshKey, load])

  useEffect(() => {
    let cancelled = false
    void api
      .amazonaGetMatrix('ama-matrix-conocimiento')
      .then((r) => {
        if (!cancelled) setCaptureMatrix(r.matrix)
      })
      .catch(() => undefined)
    void api
      .amazonaGetMatrix('ama-matrix-intersecciones')
      .then((r) => {
        if (!cancelled) setCrossMatrix(r.matrix)
      })
      .catch(() => undefined)
    void api
      .knowledgeHarvest()
      .then((r) => {
        if (!cancelled) setHarvest(r.links)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setNeighbors([])
      return
    }
    let cancelled = false
    void api
      .getKnowledge(selectedId)
      .then((r) => {
        if (cancelled) return
        setDetail(r.item)
        if (r.item.weight) setWeight(r.item.weight)
      })
      .catch(() => undefined)
    void api
      .knowledgeNeighbors(selectedId)
      .then((r) => {
        if (!cancelled) setNeighbors(r.neighbors)
      })
      .catch(() => setNeighbors([]))
    return () => {
      cancelled = true
    }
  }, [selectedId, refreshKey, items])

  const capturing = items.some((i) => i.status === 'capturing')
  useEffect(() => {
    if (!capturing) return
    const t = window.setInterval(() => {
      void load()
    }, 2500)
    return () => window.clearInterval(t)
  }, [capturing, load])

  async function captureUrl() {
    if (!url.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.createKnowledgeFromUrl(url.trim())
      setUrl('')
      setSelectedId(r.item.id)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function createManual() {
    if (!manualTitle.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.createKnowledgeManual({
        kind: manualKind,
        title: manualTitle.trim(),
        authors_org: manualOwner.trim() || undefined,
        repo:
          manualKind === 'repo'
            ? { owner: manualOwner.trim(), repo_name: manualTitle.trim() }
            : undefined,
      })
      setManualTitle('')
      setManualOwner('')
      setManualOpen(false)
      setSelectedId(r.item.id)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveField(patch: Record<string, unknown>) {
    if (!selected) return
    setBusy(true)
    try {
      const r = await api.patchKnowledge(selected.id, patch)
      setDetail(r.item)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function distill() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.distillKnowledge(selected.id, weight)
      setDetail(r.entity)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const activeMatrix =
    anchorRole === 'interseccion' ? crossMatrix : captureMatrix
  const rowItems = activeMatrix?.row_list.items ?? []
  const colItems = activeMatrix?.col_list.items ?? []

  const harvestGithub = useMemo(
    () => harvest.filter((l) => /github\.com/i.test(l.url_cruda)),
    [harvest],
  )

  return (
    <section className="panel conocimiento-section">
      <div className="panel-head">
        <h2>Conocimiento</h2>
        <p className="muted">
          Referentes del mundo (repos ahora; papers, leyes y el mapa de saber
          después). El Oráculo sigue bebiendo quántomos sellados, no READMEs.
        </p>
      </div>

      <div className="conocimiento-capture">
        <label className="sr-only" htmlFor="knowledge-url">
          URL de GitHub
        </label>
        <input
          id="knowledge-url"
          className="conocimiento-url"
          placeholder="https://github.com/owner/repo o owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void captureUrl()
          }}
        />
        <button type="button" disabled={busy || !url.trim()} onClick={() => void captureUrl()}>
          Capturar
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setManualOpen((v) => !v)}
        >
          Completar a mano
        </button>
      </div>

      {manualOpen ? (
        <div className="conocimiento-manual">
          <select
            value={manualKind}
            onChange={(e) => setManualKind(e.target.value as KnowledgeKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            placeholder="Nombre"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
          />
          <input
            placeholder="Autor / organización"
            value={manualOwner}
            onChange={(e) => setManualOwner(e.target.value)}
          />
          <button type="button" disabled={busy || !manualTitle.trim()} onClick={() => void createManual()}>
            Guardar
          </button>
        </div>
      ) : null}

      {harvestGithub.length > 0 ? (
        <p className="muted conocimiento-harvest">
          Harvest con GitHub:{' '}
          {harvestGithub.slice(0, 4).map((l) => (
            <button
              key={l.id}
              type="button"
              className="ghost"
              onClick={() => {
                void api.captureKnowledgeFromHarvest(l.id).then((r) => {
                  setSelectedId(r.item.id)
                  onChanged?.()
                  void load()
                })
              }}
            >
              {l.url_cruda.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
            </button>
          ))}
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="conocimiento-layout">
        <aside className="conocimiento-list">
          <div className="conocimiento-filters">
            <input
              placeholder="Buscar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="all">Todo kind</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <select
              value={pulseFilter}
              onChange={(e) => setPulseFilter(e.target.value)}
            >
              <option value="all">Todo pulso</option>
              <option value="vivo">Vivo</option>
              <option value="tibio">Tibio</option>
              <option value="abandonado">Abandonado</option>
            </select>
          </div>
          {loading ? <p className="muted">Cargando…</p> : null}
          {items.length === 0 && !loading ? (
            <p className="muted">Todavía no hay referentes. Pegá un repo.</p>
          ) : null}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedId ? 'is-active' : ''}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="truncate">{item.title}</span>
                  <span className="conocimiento-list-meta">
                    <span className="badge">{KIND_LABEL[item.kind]}</span>
                    {item.status === 'capturing' ? (
                      <span className="badge badge-processing">captura</span>
                    ) : null}
                    {item.status === 'error' ? (
                      <span className="badge badge-rejected">error</span>
                    ) : null}
                    {item.repo ? (
                      <span className={pulseClass(item.repo.pulse)}>
                        {PULSE_LABEL[item.repo.pulse]}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="conocimiento-detail">
          {!selected ? (
            <p className="muted">Elegí un referente o capturá uno nuevo.</p>
          ) : (
            <KnowledgeDetail
              item={selected}
              busy={busy}
              weight={weight}
              onWeight={setWeight}
              neighbors={neighbors}
              rowItems={rowItems}
              colItems={colItems}
              anchorRow={anchorRow}
              anchorCol={anchorCol}
              anchorRole={anchorRole}
              onAnchorRow={setAnchorRow}
              onAnchorCol={setAnchorCol}
              onAnchorRole={setAnchorRole}
              onSave={saveField}
              onDistill={() => void distill()}
              onRefresh={() => {
                void api.refreshKnowledge(selected.id).then(() => {
                  onChanged?.()
                  void load()
                })
              }}
              onUtility={() => {
                void api
                  .regenerateKnowledgeUtility(selected.id)
                  .then((r) => setDetail(r.item))
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
              }}
              onDelete={() => {
                if (!window.confirm(`Borrar «${selected.title}»?`)) return
                void api.deleteKnowledge(selected.id).then(() => {
                  setSelectedId(null)
                  onChanged?.()
                  void load()
                })
              }}
              onAnchor={() => {
                if (!activeMatrix || !anchorRow || !anchorCol) return
                void api
                  .addKnowledgeAnchor(selected.id, {
                    matrix_id: activeMatrix.id,
                    row_item_id: anchorRow,
                    col_item_id: anchorCol,
                    role: anchorRole,
                  })
                  .then((r) => {
                    setDetail((d) =>
                      d
                        ? { ...d, anchors: [...d.anchors, r.anchor] }
                        : d,
                    )
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
              }}
              onDeleteAnchor={(anchorId) => {
                void api.deleteKnowledgeAnchor(selected.id, anchorId).then(() => {
                  setDetail((d) =>
                    d
                      ? {
                          ...d,
                          anchors: d.anchors.filter((a) => a.id !== anchorId),
                        }
                      : d,
                  )
                })
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function KnowledgeDetail({
  item,
  busy,
  weight,
  onWeight,
  neighbors,
  rowItems,
  colItems,
  anchorRow,
  anchorCol,
  anchorRole,
  onAnchorRow,
  onAnchorCol,
  onAnchorRole,
  onSave,
  onDistill,
  onRefresh,
  onUtility,
  onDelete,
  onAnchor,
  onDeleteAnchor,
}: {
  item: KnowledgeEntity
  busy: boolean
  weight: number
  onWeight: (n: number) => void
  neighbors: KnowledgeNeighbor[]
  rowItems: AmaListItem[]
  colItems: AmaListItem[]
  anchorRow: string
  anchorCol: string
  anchorRole: 'conocimiento' | 'interseccion'
  onAnchorRow: (id: string) => void
  onAnchorCol: (id: string) => void
  onAnchorRole: (r: 'conocimiento' | 'interseccion') => void
  onSave: (patch: Record<string, unknown>) => void
  onDistill: () => void
  onRefresh: () => void
  onUtility: () => void
  onDelete: () => void
  onAnchor: () => void
  onDeleteAnchor: (id: string) => void
}) {
  const [title, setTitle] = useState(item.title)
  const [problem, setProblem] = useState(item.utility_problem)
  const [tldr, setTldr] = useState(item.architecture_tldr)
  const [uses, setUses] = useState(item.use_cases)
  const [summary, setSummary] = useState(item.summary)
  const [stack, setStack] = useState(item.repo?.stack_tags.join(', ') ?? '')

  useEffect(() => {
    setTitle(item.title)
    setProblem(item.utility_problem)
    setTldr(item.architecture_tldr)
    setUses(item.use_cases)
    setSummary(item.summary)
    setStack(item.repo?.stack_tags.join(', ') ?? '')
  }, [item])

  return (
    <div className="conocimiento-card">
      <div className="conocimiento-card-head">
        <div>
          <p className="muted mono">
            {item.source_url || 'sin URL'} · {KIND_LABEL[item.kind]}
          </p>
          {item.capture_error ? (
            <p className="error-text">{item.capture_error}</p>
          ) : null}
        </div>
        <div className="conocimiento-actions">
          {item.kind === 'repo' && item.capture_mode === 'url' ? (
            <button type="button" className="ghost" disabled={busy} onClick={onRefresh}>
              Refrescar pulso
            </button>
          ) : null}
          <button type="button" className="ghost" disabled={busy} onClick={onUtility}>
            Regenerar utilidad
          </button>
          <button type="button" className="ghost" onClick={onDelete}>
            Borrar
          </button>
        </div>
      </div>

      <label>
        Nombre
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== item.title) onSave({ title: title.trim() })
          }}
        />
      </label>

      {item.repo ? (
        <p className="conocimiento-pulse">
          <span className={pulseClass(item.repo.pulse)}>
            {PULSE_LABEL[item.repo.pulse]}
          </span>
          <span className="muted">
            {item.repo.owner}/{item.repo.repo_name}
            {item.repo.last_commit_at
              ? ` · commit ${item.repo.last_commit_at.slice(0, 10)}`
              : ''}
            {item.repo.open_issues != null ? ` · ${item.repo.open_issues} issues` : ''}
            {item.repo.stars != null ? ` · ★ ${item.repo.stars}` : ''}
          </span>
        </p>
      ) : null}

      <label>
        Stack (tags)
        <input
          value={stack}
          onChange={(e) => setStack(e.target.value)}
          onBlur={() => {
            const tags = stack
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            const prev = item.repo?.stack_tags ?? []
            if (tags.join(',') !== prev.join(',')) onSave({ stack_tags: tags })
          }}
        />
      </label>

      <label>
        Resumen
        <textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => {
            if (summary !== item.summary) onSave({ summary })
          }}
        />
      </label>
      <label>
        ¿Qué problema resuelve?
        <textarea
          rows={3}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          onBlur={() => {
            if (problem !== item.utility_problem) onSave({ utility_problem: problem })
          }}
        />
      </label>
      <label>
        TL;DR arquitectónico
        <textarea
          rows={4}
          value={tldr}
          onChange={(e) => setTldr(e.target.value)}
          onBlur={() => {
            if (tldr !== item.architecture_tldr) onSave({ architecture_tldr: tldr })
          }}
        />
      </label>
      <label>
        Casos de uso
        <textarea
          rows={2}
          value={uses}
          onChange={(e) => setUses(e.target.value)}
          onBlur={() => {
            if (uses !== item.use_cases) onSave({ use_cases: uses })
          }}
        />
      </label>

      <div className="conocimiento-distill">
        <label>
          Peso 1–12
          <input
            type="number"
            min={1}
            max={12}
            value={weight}
            onChange={(e) => onWeight(Number(e.target.value))}
          />
        </label>
        <button type="button" disabled={busy || Boolean(item.distilled_at)} onClick={onDistill}>
          {item.distilled_at ? 'Ya destilado' : 'Votar y destilar protoquántomos'}
        </button>
      </div>

      <div className="conocimiento-anchors">
        <h3>Ancla AmazonA</h3>
        <div className="conocimiento-anchor-row">
          <select
            value={anchorRole}
            onChange={(e) =>
              onAnchorRole(e.target.value as 'conocimiento' | 'interseccion')
            }
          >
            <option value="conocimiento">Captura (fuentes × vectores)</option>
            <option value="interseccion">Intersección (saber × saber)</option>
          </select>
          <select value={anchorRow} onChange={(e) => onAnchorRow(e.target.value)}>
            <option value="">Fila</option>
            {rowItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.label}
              </option>
            ))}
          </select>
          <select value={anchorCol} onChange={(e) => onAnchorCol(e.target.value)}>
            <option value="">Columna</option>
            {colItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={!anchorRow || !anchorCol} onClick={onAnchor}>
            Anclar
          </button>
        </div>
        <ul>
          {item.anchors.map((a) => (
            <li key={a.id}>
              <span className="muted mono">
                {a.role} · {a.row_item_id} × {a.col_item_id}
              </span>
              <button type="button" className="ghost" onClick={() => onDeleteAnchor(a.id)}>
                quitar
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="conocimiento-neighbors">
        <h3>Vecinos (cruces)</h3>
        {neighbors.length === 0 ? (
          <p className="muted">Sin embeddings todavía, o no hay vecinos.</p>
        ) : (
          <ul>
            {neighbors.map((n) => (
              <li key={`${n.object_type}:${n.object_id}`}>
                <span className="badge">{n.object_type}</span> {n.label}{' '}
                <span className="muted">{n.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
