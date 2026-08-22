import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaList,
  AmaListHydrated,
  AmaListItem,
  AmaListKind,
  AmaPlace,
} from '../../types'
import { AmazonaLinks } from './AmazonaLinks'
import { KIND_LABEL, KIND_SIZE } from './labels'

type Props = {
  refreshKey: number
  places: AmaPlace[]
  onChanged?: () => void
}

const KINDS: AmaListKind[] = [
  'tridente',
  'lista6',
  'base12',
  'base22',
  'base72',
]

export function AmazonaListas({ refreshKey, places, onChanged }: Props) {
  const [lists, setLists] = useState<AmaList[]>([])
  const [kindFilter, setKindFilter] = useState<AmaListKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AmaListHydrated | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<AmaListKind>('tridente')
  const [newNotes, setNewNotes] = useState('')
  const [composeA, setComposeA] = useState('')
  const [composeB, setComposeB] = useState('')

  const [draftTitle, setDraftTitle] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftItems, setDraftItems] = useState<AmaListItem[]>([])
  const [childDraft, setChildDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.amazonaListLists({
        kind: kindFilter === 'all' ? undefined : kindFilter,
        q: query.trim() || undefined,
      })
      setLists(data.lists)
      setSelectedId((prev) =>
        prev && data.lists.some((l) => l.id === prev)
          ? prev
          : (data.lists[0]?.id ?? null),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar listas')
    } finally {
      setLoading(false)
    }
  }, [kindFilter, query])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    void api
      .amazonaGetList(selectedId)
      .then((data) => {
        if (cancelled) return
        setDetail(data.list)
        setDraftTitle(data.list.title)
        setDraftNotes(data.list.notes)
        setDraftTags((data.list.tags_list ?? []).join(', '))
        setDraftItems(data.list.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al abrir lista')
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const tridentes = useMemo(
    () => lists.filter((l) => l.kind === 'tridente'),
    [lists],
  )

  async function createList() {
    const title = newTitle.trim()
    if (!title) return
    setBusy(true)
    setError(null)
    try {
      const composed =
        newKind === 'lista6' && composeA && composeB
          ? { tridente_a_id: composeA, tridente_b_id: composeB }
          : {}
      const data = await api.amazonaCreateList({
        title,
        notes: newNotes,
        kind: newKind,
        ...composed,
      })
      setNewTitle('')
      setNewNotes('')
      setComposeA('')
      setComposeB('')
      onChanged?.()
      await load()
      if (data.list) setSelectedId(data.list.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally {
      setBusy(false)
    }
  }

  async function saveList() {
    if (!detail) return
    setBusy(true)
    setError(null)
    try {
      await api.amazonaUpdateList(detail.id, {
        title: draftTitle.trim(),
        notes: draftNotes,
        tags: draftTags,
      })
      if (!detail.composition) {
        await api.amazonaPutListItems(
          detail.id,
          draftItems.map((item) => ({
            id: item.id,
            label: item.label,
            notes: item.notes,
            place_id: item.place_id,
          })),
        )
      }
      const data = await api.amazonaGetList(detail.id)
      setDetail(data.list)
      setDraftItems(data.list.items)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function removeList() {
    if (!detail) return
    if (!window.confirm(`¿Borrar “${detail.title}”?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.amazonaDeleteList(detail.id)
      setSelectedId(null)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  async function addChild(parentId: string) {
    const label = (childDraft[parentId] ?? '').trim()
    if (!label) return
    setBusy(true)
    try {
      await api.amazonaAddChildItem(parentId, { label })
      setChildDraft((prev) => ({ ...prev, [parentId]: '' }))
      const data = await api.amazonaGetList(detail!.id)
      setDetail(data.list)
      setDraftItems(data.list.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar')
    } finally {
      setBusy(false)
    }
  }

  async function removeChild(id: string) {
    setBusy(true)
    try {
      await api.amazonaDeleteItem(id)
      const data = await api.amazonaGetList(detail!.id)
      setDetail(data.list)
      setDraftItems(data.list.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar')
    } finally {
      setBusy(false)
    }
  }

  function updateItem(index: number, patch: Partial<AmaListItem>) {
    setDraftItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
  }

  return (
    <div className="ama-split">
      <div className="panel">
        <header className="panel-head">
          <h2>Listas</h2>
          {loading ? <span className="muted">Cargando…</span> : null}
        </header>
        <div className="personas-mode-switch">
          <button
            type="button"
            className={kindFilter === 'all' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setKindFilter('all')}
          >
            Todas
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={kindFilter === k ? 'filter-chip is-active' : 'filter-chip'}
              onClick={() => setKindFilter(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="ama-list-nav">
          {lists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                className={
                  list.id === selectedId ? 'ama-nav-item is-active' : 'ama-nav-item'
                }
                onClick={() => setSelectedId(list.id)}
              >
                <strong>{list.title}</strong>
                <span>
                  {KIND_LABEL[list.kind]} · {list.item_count ?? 0}/{list.size}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="ama-create">
          <h3>Nueva lista</h3>
          <label className="field">
            <span>Título</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Tipo</span>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as AmaListKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]} ({KIND_SIZE[k]})
                </option>
              ))}
            </select>
          </label>
          {newKind === 'lista6' ? (
            <div className="ama-inline-fields">
              <label className="field">
                <span>Tridente A (opcional)</span>
                <select
                  value={composeA}
                  onChange={(e) => setComposeA(e.target.value)}
                >
                  <option value="">Ítems manuales</option>
                  {tridentes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Tridente B</span>
                <select
                  value={composeB}
                  onChange={(e) => setComposeB(e.target.value)}
                >
                  <option value="">—</option>
                  {tridentes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <label className="field">
            <span>Notas</span>
            <textarea
              rows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !newTitle.trim()}
            onClick={() => void createList()}
          >
            Crear
          </button>
        </div>
      </div>

      <div className="panel">
        {error ? <p className="muted">{error}</p> : null}
        {!detail ? (
          <p className="muted">Elegí una lista o creá una nueva.</p>
        ) : (
          <>
            <header className="panel-head">
              <h2>{detail.title}</h2>
              <span className="muted">
                {KIND_LABEL[detail.kind]}
                {detail.composition
                  ? ` · ${detail.composition.tridente_a_title} + ${detail.composition.tridente_b_title}`
                  : ''}
              </span>
            </header>
            <label className="field">
              <span>Título</span>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Notas</span>
              <textarea
                rows={3}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Tags (coma)</span>
              <input
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
              />
            </label>

            {detail.composition ? (
              <p className="muted">
                Ítems por referencia de los dos Tridentes. Editálos en esas
                listas para que esta Lista6 se actualice.
              </p>
            ) : null}

            <ol
              className={
                detail.size > 12 ? 'ama-item-grid is-dense' : 'ama-item-grid'
              }
            >
              {draftItems.map((item, index) => (
                <li key={item.id}>
                  <span className="ama-item-n">{index + 1}</span>
                  <input
                    type="text"
                    value={item.label}
                    disabled={Boolean(detail.composition)}
                    placeholder="Elemento"
                    onChange={(e) =>
                      updateItem(index, { label: e.target.value })
                    }
                  />
                  <textarea
                    rows={2}
                    value={item.notes}
                    disabled={Boolean(detail.composition)}
                    placeholder="Notas"
                    onChange={(e) =>
                      updateItem(index, { notes: e.target.value })
                    }
                  />
                  <select
                    value={item.place_id ?? ''}
                    disabled={Boolean(detail.composition)}
                    onChange={(e) =>
                      updateItem(index, {
                        place_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Sin lugar</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {item.children && item.children.length > 0 ? (
                    <ul className="ama-subitems">
                      {item.children.map((child) => (
                        <li key={child.id}>
                          {child.label}
                          <button
                            type="button"
                            className="btn btn-tiny btn-ghost"
                            onClick={() => void removeChild(child.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="ama-sub-add">
                    <input
                      type="text"
                      placeholder="Sub-ítem"
                      value={childDraft[item.id] ?? ''}
                      onChange={(e) =>
                        setChildDraft((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={busy}
                      onClick={() => void addChild(item.id)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="ama-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void saveList()}
              >
                Guardar
              </button>
              {detail.source !== 'seed' ? (
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  disabled={busy}
                  onClick={() => void removeList()}
                >
                  Borrar
                </button>
              ) : (
                <span className="muted">Semilla del sistema</span>
              )}
            </div>

            <AmazonaLinks
              objectType="list"
              objectId={detail.id}
              places={places}
            />
          </>
        )}
      </div>
    </div>
  )
}
