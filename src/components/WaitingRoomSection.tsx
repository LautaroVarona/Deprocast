import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { api } from '../services/api'

type WaitingType = 'person' | 'project' | 'geografia'
type DestType = WaitingType | 'agrupacion' | 'dominio'

type WaitingItem = {
  id: string
  entity_type: WaitingType
  name: string
  class_label: string
  notes: string | null
  created_at: string
  link_count?: number
  source_file?: string | null
  source_type?: string | null
  evidence_snippet?: string | null
  entry_excerpt?: string | null
  suggested_match: {
    id: string
    name: string
    score: number
    target_type: WaitingType
  } | null
  cross_match: {
    id: string
    name: string
    score: number
    target_type: WaitingType
  } | null
}

type LinkTarget = {
  to_type: DestType
  target_id: string
  name: string
  subtitle?: string
}

type LinkFilter = 'all' | 'suggested' | 'orphan'
type TypeFilter = 'all' | WaitingType

const DEST_LABEL: Record<DestType, string> = {
  person: 'Perfil',
  project: 'Proyecto',
  geografia: 'Geografía',
  agrupacion: 'Agrupación',
  dominio: 'Dominio',
}

const SEARCH_KINDS = [
  'person',
  'project',
  'agrupacion',
  'dominio',
  'geografia',
] as const

interface Props {
  refreshKey: number
  onChanged?: () => void
}

function bestLink(item: WaitingItem) {
  return item.suggested_match ?? item.cross_match ?? null
}

function contextText(item: WaitingItem): string | null {
  const evidence = item.evidence_snippet?.trim()
  if (evidence) return evidence
  const excerpt = item.entry_excerpt?.trim()
  if (excerpt) return excerpt
  const notes = item.notes?.trim()
  if (notes) return notes
  return null
}

function targetKey(t: Pick<LinkTarget, 'to_type' | 'target_id'>) {
  return `${t.to_type}:${t.target_id}`
}

function WaitingLinkPicker({
  itemId,
  selected,
  disabled,
  onChange,
}: {
  itemId: string
  selected: LinkTarget[]
  disabled?: boolean
  onChange: (next: LinkTarget[]) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LinkTarget[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abort = useRef<AbortController | null>(null)
  const selectedKeys = useMemo(
    () => new Set(selected.map(targetKey)),
    [selected],
  )

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      abort.current?.abort()
    }
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const runSearch = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current)
    abort.current?.abort()
    const trimmed = q.trim()
    if (trimmed.length < 1) {
      setHits([])
      setBusy(false)
      setOpen(false)
      return
    }
    timer.current = setTimeout(() => {
      const ac = new AbortController()
      abort.current = ac
      setBusy(true)
      void api
        .typeaheadEntities(trimmed, {
          kinds: [...SEARCH_KINDS],
          limit: 12,
          scope: 'masters',
          signal: ac.signal,
        })
        .then((res) => {
          const next: LinkTarget[] = (res.results ?? [])
            .filter((r) => r.kind !== 'quantomo')
            .map((r) => ({
              to_type: r.kind as DestType,
              target_id: r.id,
              name: r.label,
              subtitle: r.subtitle,
            }))
          setHits(next)
          setActiveIdx(0)
          setOpen(true)
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setHits([])
        })
        .finally(() => setBusy(false))
    }, 120)
  }, [])

  function addTarget(t: LinkTarget) {
    if (selectedKeys.has(targetKey(t))) {
      setQuery('')
      setHits([])
      setOpen(false)
      return
    }
    onChange([...selected, t])
    setQuery('')
    setHits([])
    setOpen(false)
    // Dejar el foco listo para sumar otro, sin rellenar texto
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function removeTarget(key: string) {
    onChange(selected.filter((t) => targetKey(t) !== key))
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && open && hits.length) {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % hits.length)
      return
    }
    if (e.key === 'ArrowUp' && open && hits.length) {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + hits.length) % hits.length)
      return
    }
    if (e.key === 'Enter' && open && hits[activeIdx]) {
      e.preventDefault()
      addTarget(hits[activeIdx]!)
      return
    }
    if (e.key === 'Backspace' && !query && selected.length) {
      removeTarget(targetKey(selected[selected.length - 1]!))
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="waiting-link-picker" ref={wrapRef}>
      <div className="waiting-link-search-wrap">
        <input
          ref={inputRef}
          id={`waiting-search-${itemId}`}
          className="waiting-link-search"
          type="search"
          value={query}
          disabled={disabled}
          placeholder={
            selected.length
              ? 'Sumar otro destino…'
              : 'Buscar perfil, proyecto, agrupación, dominio, geo…'
          }
          aria-label="Buscar destinos para vincular"
          aria-autocomplete="list"
          aria-expanded={open}
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            runSearch(v)
          }}
          onKeyDown={onKeyDown}
        />
        {busy && <span className="waiting-link-search-busy mono">…</span>}
      </div>

      {open && (hits.length > 0 || busy || query.trim().length > 0) && (
        <ul className="waiting-link-results" role="listbox">
          {busy && hits.length === 0 && (
            <li className="muted waiting-link-empty">Buscando…</li>
          )}
          {!busy && hits.length === 0 && query.trim() && (
            <li className="muted waiting-link-empty">Sin coincidencias</li>
          )}
          {hits.map((hit, i) => {
            const key = targetKey(hit)
            const already = selectedKeys.has(key)
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  disabled={disabled || already}
                  className={[
                    'waiting-link-result',
                    `kind-${hit.to_type}`,
                    i === activeIdx ? 'is-active' : '',
                    already ? 'is-tagged' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    // Evita blur del input antes del click
                    e.preventDefault()
                    addTarget(hit)
                  }}
                >
                  <span className="waiting-link-result-kind mono">
                    {DEST_LABEL[hit.to_type]}
                  </span>
                  <span className="waiting-link-result-name">
                    {hit.name}
                    {already ? ' · ya' : ''}
                  </span>
                  {hit.subtitle && (
                    <span className="waiting-link-result-sub muted">
                      {hit.subtitle}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selected.length > 0 && (
        <ul className="waiting-link-chips" aria-label="Destinos elegidos">
          {selected.map((t) => (
            <li key={targetKey(t)} className={`waiting-link-chip kind-${t.to_type}`}>
              <span className="waiting-link-chip-kind mono">
                {DEST_LABEL[t.to_type]}
              </span>
              <span className="waiting-link-chip-name">{t.name}</span>
              <button
                type="button"
                className="waiting-link-chip-x"
                disabled={disabled}
                aria-label={`Quitar ${t.name}`}
                onClick={() => removeTarget(targetKey(t))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function WaitingRoomSection({ refreshKey, onChanged }: Props) {
  const [items, setItems] = useState<WaitingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [targetsById, setTargetsById] = useState<Record<string, LinkTarget[]>>(
    {},
  )
  const [promoteTypeById, setPromoteTypeById] = useState<
    Record<string, WaitingType>
  >({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listWaiting()
      setItems(res.items ?? [])
      setTargetsById((prev) => {
        const alive = new Set((res.items ?? []).map((i) => i.id))
        const next: Record<string, LinkTarget[]> = {}
        for (const [id, list] of Object.entries(prev)) {
          if (alive.has(id) && list.length) next[id] = list
        }
        return next
      })
      setPromoteTypeById((prev) => {
        const next = { ...prev }
        for (const item of res.items ?? []) {
          if (!next[item.id]) next[item.id] = item.entity_type
        }
        return next
      })
      setSelected((prev) => {
        const alive = new Set((res.items ?? []).map((i) => i.id))
        return prev.filter((id) => alive.has(id))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      const hasLink = Boolean(bestLink(item))
      if (linkFilter === 'suggested' && !hasLink) return false
      if (linkFilter === 'orphan' && hasLink) return false
      if (typeFilter !== 'all' && item.entity_type !== typeFilter) return false
      if (!q) return true
      const ctx = contextText(item)?.toLowerCase() ?? ''
      return (
        item.name.toLowerCase().includes(q) ||
        item.class_label.toLowerCase().includes(q) ||
        (item.source_file?.toLowerCase().includes(q) ?? false) ||
        ctx.includes(q) ||
        (bestLink(item)?.name.toLowerCase().includes(q) ?? false)
      )
    })
  }, [items, linkFilter, typeFilter, query])

  const suggestedCount = useMemo(
    () => items.filter((i) => bestLink(i)).length,
    [items],
  )
  const orphanCount = items.length - suggestedCount

  function selectVisible() {
    setSelected(filtered.map((i) => i.id))
  }

  function setItemTargets(itemId: string, next: LinkTarget[]) {
    setTargetsById((prev) => ({ ...prev, [itemId]: next }))
  }

  async function attachTargets(item: WaitingItem, targets: LinkTarget[]) {
    if (targets.length === 0) return
    setBusyId(item.id)
    setError(null)
    try {
      const res = await api.resolveWaiting(item.id, {
        from_type: item.entity_type,
        action: 'attach',
        targets: targets.map((t) => ({
          to_type: t.to_type,
          target_id: t.target_id,
        })),
      })
      const names = targets.map((t) => t.name).join(', ')
      setStatus(
        targets.length === 1
          ? `«${item.name}» → ${names}`
          : `«${item.name}» → ${targets.length} destinos (${names})`,
      )
      void res
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo vincular')
    } finally {
      setBusyId(null)
    }
  }

  async function acceptSuggested(item: WaitingItem) {
    const link = bestLink(item)
    if (!link) return
    const current = targetsById[item.id] ?? []
    const asTarget: LinkTarget = {
      to_type: link.target_type,
      target_id: link.id,
      name: link.name,
    }
    const merged = current.some((t) => targetKey(t) === targetKey(asTarget))
      ? current
      : [...current, asTarget]
    setItemTargets(item.id, merged)
    await attachTargets(item, merged)
  }

  async function promoteOne(item: WaitingItem) {
    const toType = promoteTypeById[item.id] ?? item.entity_type
    setBusyId(item.id)
    setError(null)
    try {
      await api.resolveWaiting(item.id, {
        from_type: item.entity_type,
        action: 'promote',
        to_type: toType,
        name: item.name,
        title: item.name,
        kind:
          toType === 'person'
            ? 'fisica'
            : toType === 'geografia'
              ? 'lugar'
              : undefined,
        category: toType === 'project' ? 'proyecto' : undefined,
        status: toType === 'project' ? 'emergente' : undefined,
      })
      setStatus(`«${item.name}» → ${DEST_LABEL[toType]} nuevo`)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo promover')
    } finally {
      setBusyId(null)
    }
  }

  async function discardItems(
    list: WaitingItem[],
    opts?: { confirmAll?: boolean },
  ) {
    if (list.length === 0) return
    if (
      opts?.confirmAll &&
      !window.confirm(
        `¿Mandar ${list.length} menciones a Ruido? No se pueden deshacer fácil.`,
      )
    ) {
      return
    }
    setBusyId(list[0]!.id)
    setError(null)
    try {
      const res = await api.discardWaiting({
        items: list.map((i) => ({
          id: i.id,
          from_type: i.entity_type,
        })),
      })
      setStatus(
        res.failed
          ? `${res.discarded} → Ruido · ${res.failed} fallaron`
          : `${res.discarded} → Ruido`,
      )
      setSelected([])
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar')
    } finally {
      setBusyId(null)
    }
  }

  async function acceptAllSuggested() {
    const list = filtered.filter((i) => bestLink(i))
    if (list.length === 0) return
    setBusyId(list[0]!.id)
    setError(null)
    let ok = 0
    try {
      for (const item of list) {
        const link = bestLink(item)
        if (!link) continue
        try {
          await api.resolveWaiting(item.id, {
            from_type: item.entity_type,
            action: 'attach',
            targets: [
              { to_type: link.target_type, target_id: link.id },
            ],
          })
          ok++
        } catch {
          /* continue */
        }
      }
      setStatus(`${ok} vínculos aplicados`)
      await load()
      onChanged?.()
    } finally {
      setBusyId(null)
    }
  }

  const selectedItems = items.filter((i) => selected.includes(i.id))

  return (
    <section className="panel entity-panel waiting-room-section">
      <div className="panel-head entity-head">
        <div>
          <h2>
            Sala de espera
            {items.length > 0 ? (
              <span className="nav-badge">{items.length}</span>
            ) : null}
          </h2>
          <p className="muted mono">
            Corpus sin ficha maestra · vincular a uno o varios destinos
            {suggestedCount > 0 ? ` · ${suggestedCount} con sugerencia` : ''}
            {orphanCount > 0 ? ` · ${orphanCount} sin vínculo` : ''}
          </p>
        </div>
        <div className="entity-head-actions">
          <button
            type="button"
            className="btn btn-tiny btn-ghost"
            disabled={loading}
            onClick={() => void load()}
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}

      <div className="profiles-toolbar waiting-room-toolbar">
        <div className="filter-rail" role="tablist" aria-label="Vínculo">
          {(
            [
              ['all', `Todos (${items.length})`],
              ['suggested', `Con sugerencia (${suggestedCount})`],
              ['orphan', `Sin vínculo (${orphanCount})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={linkFilter === value}
              className={
                linkFilter === value ? 'filter-chip is-active' : 'filter-chip'
              }
              onClick={() => setLinkFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-rail" role="tablist" aria-label="Tipo">
          {(
            [
              ['all', 'Todos'],
              ['person', 'Personas'],
              ['project', 'Proyectos'],
              ['geografia', 'Geografía'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={typeFilter === value}
              className={
                typeFilter === value ? 'filter-chip is-active' : 'filter-chip'
              }
              onClick={() => setTypeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="semantic-search">
          <span className="mono">Buscar</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, fuente o contexto…"
            aria-label="Buscar en sala de espera"
          />
        </label>
      </div>

      <div className="waiting-room-bulk actions-row">
        <button
          type="button"
          className="btn btn-tiny btn-ghost"
          disabled={filtered.length === 0}
          onClick={selectVisible}
        >
          Seleccionar visibles ({filtered.length})
        </button>
        <button
          type="button"
          className="btn btn-tiny btn-ghost"
          disabled={selected.length === 0}
          onClick={() => setSelected([])}
        >
          Limpiar sel.
        </button>
        <button
          type="button"
          className="btn btn-tiny btn-primary"
          disabled={filtered.every((i) => !bestLink(i)) || busyId !== null}
          onClick={() => void acceptAllSuggested()}
        >
          Aceptar sugerencias visibles
        </button>
        <button
          type="button"
          className="btn btn-tiny btn-ghost danger"
          disabled={selectedItems.length === 0 || busyId !== null}
          onClick={() => void discardItems(selectedItems, { confirmAll: true })}
        >
          Sel. → Ruido ({selectedItems.length})
        </button>
        <button
          type="button"
          className="btn btn-tiny btn-ghost danger"
          disabled={filtered.length === 0 || busyId !== null}
          onClick={() => void discardItems(filtered, { confirmAll: true })}
        >
          Visibles → Ruido
        </button>
      </div>

      {loading && items.length === 0 ? (
        <p className="muted mono">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="muted mono profiles-empty">
          {items.length === 0
            ? 'Sala vacía. Las menciones aprobadas del NER llegan acá.'
            : 'Nada coincide con el filtro.'}
        </p>
      ) : (
        <ul className="waiting-desk-list">
          {filtered.map((item) => {
            const link = bestLink(item)
            const targets = targetsById[item.id] ?? []
            const busy = busyId === item.id
            const isSel = selected.includes(item.id)
            const ctx = contextText(item)
            const promoteType = promoteTypeById[item.id] ?? item.entity_type
            return (
              <li
                key={`${item.entity_type}:${item.id}`}
                className={[
                  'waiting-desk-row',
                  isSel ? 'is-selected' : '',
                  link ? 'has-suggestion' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <label className="waiting-desk-check">
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={busy}
                    aria-label={`Seleccionar ${item.name}`}
                    onChange={() =>
                      setSelected((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((x) => x !== item.id)
                          : [...prev, item.id],
                      )
                    }
                  />
                </label>

                <div className="waiting-desk-main">
                  <div className="waiting-desk-title">
                    <h3 className="waiting-desk-name">{item.name}</h3>
                  </div>

                  {ctx ? (
                    <blockquote className="waiting-desk-context">
                      <p>{ctx}</p>
                    </blockquote>
                  ) : (
                    <p className="waiting-desk-context is-empty muted">
                      Sin cita de contexto en el corpus.
                    </p>
                  )}

                  {link && (
                    <p className="waiting-desk-suggest">
                      <span className="muted mono">Sugerido</span>
                      <button
                        type="button"
                        className="btn btn-tiny btn-primary"
                        disabled={busy}
                        onClick={() => void acceptSuggested(item)}
                      >
                        Vincular a {link.name}
                        {link.score > 0
                          ? ` · ${Math.round(link.score * 100)}%`
                          : ''}
                      </button>
                      <button
                        type="button"
                        className="btn btn-tiny btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          const asTarget: LinkTarget = {
                            to_type: link.target_type,
                            target_id: link.id,
                            name: link.name,
                          }
                          const cur = targetsById[item.id] ?? []
                          if (cur.some((t) => targetKey(t) === targetKey(asTarget)))
                            return
                          setItemTargets(item.id, [...cur, asTarget])
                        }}
                      >
                        + a destinos
                      </button>
                    </p>
                  )}
                </div>

                <div className="waiting-desk-actions">
                  <WaitingLinkPicker
                    itemId={item.id}
                    selected={targets}
                    disabled={busy}
                    onChange={(next) => setItemTargets(item.id, next)}
                  />

                  <div className="waiting-desk-action-row">
                    <button
                      type="button"
                      className="btn btn-tiny btn-primary"
                      disabled={busy || targets.length === 0}
                      onClick={() => void attachTargets(item, targets)}
                    >
                      {targets.length > 1
                        ? `Vincular ${targets.length}`
                        : 'Vincular'}
                    </button>

                    <select
                      className="waiting-link-select waiting-promote-select"
                      value={promoteType}
                      disabled={busy}
                      aria-label="Tipo de ficha nueva"
                      onChange={(e) =>
                        setPromoteTypeById((d) => ({
                          ...d,
                          [item.id]: e.target.value as WaitingType,
                        }))
                      }
                    >
                      <option value="person">Nueva: perfil</option>
                      <option value="project">Nueva: proyecto</option>
                      <option value="geografia">Nueva: geografía</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-tiny btn-ghost"
                      disabled={busy}
                      onClick={() => void promoteOne(item)}
                    >
                      Crear
                    </button>
                    <button
                      type="button"
                      className="btn btn-tiny btn-ghost danger"
                      disabled={busy}
                      onClick={() => void discardItems([item])}
                    >
                      → Ruido
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
