import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaList,
  AmaMatrix,
  AmaMatrixHydrated,
  AmaPlace,
} from '../../types'
import { AmazonaMatrixView } from './AmazonaMatrixView'

type Props = {
  refreshKey: number
  places: AmaPlace[]
  onChanged?: () => void
}

export function AmazonaCampo({ refreshKey, places, onChanged }: Props) {
  const [matrices, setMatrices] = useState<AmaMatrix[]>([])
  const [listas6, setListas6] = useState<AmaList[]>([])
  const [tridentes, setTridentes] = useState<AmaList[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [open, setOpen] = useState<AmaMatrixHydrated | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'6' | '3' | 'all'>('6')

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [orderN, setOrderN] = useState<3 | 6>(6)
  const [rowId, setRowId] = useState('')
  const [colId, setColId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, l6, t] = await Promise.all([
        api.amazonaListMatrices(),
        api.amazonaListLists({ kind: 'lista6' }),
        api.amazonaListLists({ kind: 'tridente' }),
      ])
      setMatrices(m.matrices)
      setListas6(l6.lists)
      setTridentes(t.lists)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el Campo')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!openId) {
      setOpen(null)
      return
    }
    let cancelled = false
    void api
      .amazonaGetMatrix(openId)
      .then((data) => {
        if (!cancelled) setOpen(data.matrix)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo abrir')
        }
      })
    return () => {
      cancelled = true
    }
  }, [openId])

  const axes = orderN === 6 ? listas6 : tridentes
  const visible = matrices.filter((m) =>
    filter === 'all' ? true : m.order_n === Number(filter),
  )

  async function createMatrix() {
    if (!title.trim() || !rowId || !colId) return
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaCreateMatrix({
        title: title.trim(),
        notes,
        order_n: orderN,
        row_list_id: rowId,
        col_list_id: colId,
      })
      setTitle('')
      setNotes('')
      onChanged?.()
      await load()
      if (data.matrix) setOpenId(data.matrix.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally {
      setBusy(false)
    }
  }

  async function createExample() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaCreateExampleMatrix()
      onChanged?.()
      await load()
      if (data.matrix) setOpenId(data.matrix.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el ejemplo')
    } finally {
      setBusy(false)
    }
  }

  async function removeMatrix(id: string) {
    if (!window.confirm('¿Borrar esta matriz del Campo?')) return
    setBusy(true)
    try {
      await api.amazonaDeleteMatrix(id)
      if (openId === id) setOpenId(null)
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  if (open && openId) {
    return (
      <div className="panel">
        <AmazonaMatrixView
          matrix={open}
          places={places}
          onMatrix={(next) => {
            setOpen(next)
            void load()
            onChanged?.()
          }}
          onClose={() => setOpenId(null)}
        />
      </div>
    )
  }

  return (
    <div className="ama-campo">
      <div className="panel">
        <header className="panel-head">
          <h2>Campo de la Lista AmazonA</h2>
          {loading ? <span className="muted">Cargando…</span> : null}
        </header>
        <p className="muted">
          El Campo es el conjunto de todas las matrices 6×6 (y esquemas 3×3)
          que vas generando. Dos Lista6 intercambiables → 36 permutaciones.
        </p>
        <div className="personas-mode-switch">
          <button
            type="button"
            className={filter === '6' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setFilter('6')}
          >
            AmazonA 6×6
          </button>
          <button
            type="button"
            className={filter === '3' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setFilter('3')}
          >
            Esquemas 3×3
          </button>
          <button
            type="button"
            className={filter === 'all' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setFilter('all')}
          >
            Todo
          </button>
        </div>
        {error ? <p className="muted">{error}</p> : null}
        <div className="ama-card-grid">
          {visible.length === 0 ? (
            <p className="muted">Todavía no hay matrices en este filtro.</p>
          ) : (
            visible.map((m) => (
              <article key={m.id} className="ama-card">
                <button
                  type="button"
                  className="ama-card-open"
                  onClick={() => setOpenId(m.id)}
                >
                  <span className="ama-kicker">
                    {m.order_n}×{m.order_n}
                  </span>
                  <strong>{m.title}</strong>
                  <span>
                    {m.row_title} × {m.col_title}
                  </span>
                  <em>
                    {m.cell_notes_count ?? 0} celdas con notas
                  </em>
                </button>
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  disabled={busy}
                  onClick={() => void removeMatrix(m.id)}
                >
                  Borrar
                </button>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <header className="panel-head">
          <h2>Nueva matriz</h2>
        </header>
        <div className="personas-mode-switch">
          <button
            type="button"
            className={orderN === 6 ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => {
              setOrderN(6)
              setRowId('')
              setColId('')
            }}
          >
            Lista AmazonA 6×6
          </button>
          <button
            type="button"
            className={orderN === 3 ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => {
              setOrderN(3)
              setRowId('')
              setColId('')
            }}
          >
            Esquema 3×3
          </button>
        </div>
        <label className="field">
          <span>Título</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="ama-inline-fields">
          <label className="field">
            <span>Filas</span>
            <select value={rowId} onChange={(e) => setRowId(e.target.value)}>
              <option value="">Elegí…</option>
              {axes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Columnas</span>
            <select value={colId} onChange={(e) => setColId(e.target.value)}>
              <option value="">Elegí…</option>
              {axes.map((l) => (
                <option key={`c-${l.id}`} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Notas</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="ama-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !title.trim() || !rowId || !colId}
            onClick={() => void createMatrix()}
          >
            Crear
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy}
            onClick={() => void createExample()}
          >
            Ejemplo Nodos × Corruptópolis
          </button>
        </div>
      </div>
    </div>
  )
}
