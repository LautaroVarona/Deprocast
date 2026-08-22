import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaListItem,
  AmaMatrixHydrated,
  DeproIdaCard,
  DeproIdaCardProposal,
  DeproIdaItem,
  DeproIdaNeighbor,
  Dominio,
} from '../../types'
import { IDA_MATRIX_ID, isCoagulaProcessRow } from '../../lib/deprocast'
import { DeproWeightPicker } from './DeproWeightPicker'

type Props = {
  matrix: AmaMatrixHydrated | null
  items: DeproIdaItem[]
  onChanged: () => void
}

function cellOf(
  items: DeproIdaItem[],
  rowId: string,
  colId: string,
): DeproIdaItem[] {
  return items.filter(
    (i) => i.row_item_id === rowId && i.col_item_id === colId,
  )
}

export function DeprocastIdaTable({ matrix, items, onChanged }: Props) {
  const [sel, setSel] = useState<{ row: AmaListItem; col: AmaListItem } | null>(
    null,
  )
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [weight, setWeight] = useState<number | null>(null)
  const [domainIds, setDomainIds] = useState<string[]>([])
  const [dominios, setDominios] = useState<Dominio[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<DeproIdaCard[]>([])
  const [neighbors, setNeighbors] = useState<DeproIdaNeighbor[]>([])
  const [proposed, setProposed] = useState<DeproIdaCardProposal[] | null>(null)
  const [editWeight, setEditWeight] = useState<number | null>(null)

  const rows = matrix?.row_list.items.slice(0, 6) ?? []
  const cols = matrix?.col_list.items.slice(0, 6) ?? []

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
  }, [onChanged])

  const cellItems = useMemo(() => {
    if (!sel) return []
    return cellOf(items, sel.row.id, sel.col.id)
  }, [items, sel])

  const picked = cellItems.find((i) => i.id === pickedId) ?? cellItems[0] ?? null

  useEffect(() => {
    if (!sel) {
      setPickedId(null)
      return
    }
    const list = cellOf(items, sel.row.id, sel.col.id)
    if (!list.some((i) => i.id === pickedId)) {
      setPickedId(list[0]?.id ?? null)
    }
  }, [sel, items, pickedId])

  useEffect(() => {
    setEditWeight(picked?.weight ?? null)
    setCards([])
    setNeighbors([])
    setProposed(null)
    if (!picked) return
    let cancelled = false
    void (async () => {
      try {
        const [cardRes, neighRes] = await Promise.all([
          api.deprocastListIdaCards(picked.id),
          api.deprocastIdaNeighbors(picked.id),
        ])
        if (cancelled) return
        setCards(cardRes.cards)
        setNeighbors(neighRes.neighbors)
      } catch {
        /* vecindario vacío si no hay embed */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [picked?.id, picked?.weight])

  function toggleDomain(id: string) {
    setDomainIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function createInCell() {
    if (!sel || !title.trim() || busy) return
    if (isCoagulaProcessRow(sel.row.id) && weight == null) {
      setError('Sin peso HITL (1–12) no baja a Coagula')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.deprocastCreateIda({
        title: title.trim(),
        body,
        kind: 'aprendizaje',
        matrix_id: matrix?.id ?? IDA_MATRIX_ID,
        row_item_id: sel.row.id,
        col_item_id: sel.col.id,
        weight,
        domain_ids: domainIds,
      })
      setTitle('')
      setBody('')
      setWeight(null)
      setDomainIds([])
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally {
      setBusy(false)
    }
  }

  async function saveWeight() {
    if (!picked || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deprocastPatchIda(picked.id, { weight: editWeight })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el peso')
    } finally {
      setBusy(false)
    }
  }

  async function propose() {
    if (!picked || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.deprocastProposeIdaCards(picked.id)
      setProposed(res.cards)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron proponer cards')
    } finally {
      setBusy(false)
    }
  }

  async function sealProposed() {
    if (!picked || !proposed || busy) return
    setBusy(true)
    setError(null)
    try {
      for (const card of proposed) {
        const q = card.question.trim()
        if (!q) continue
        await api.deprocastCreateIdaCard(picked.id, {
          question: q,
          answer: card.answer,
        })
      }
      setProposed(null)
      const res = await api.deprocastListIdaCards(picked.id)
      setCards(res.cards)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron sellar')
    } finally {
      setBusy(false)
    }
  }

  async function removeCard(id: string) {
    setBusy(true)
    try {
      await api.deprocastDeleteIdaCard(id)
      setCards((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  if (!matrix) {
    return (
      <section className="panel">
        <p className="muted">
          La matriz AmazonA de IDA todavía no está sembrada. Reiniciá el
          servidor.
        </p>
      </section>
    )
  }

  return (
    <div className="depro-ida-table">
      <div className="ama-grid ama-grid-6 depro-ida-grid">
        <div className="ama-grid-corner" />
        {cols.map((col) => (
          <div key={col.id} className="ama-grid-colhead" title={col.notes}>
            {col.label.trim() || '—'}
          </div>
        ))}
        {rows.map((rowItem) => (
          <Fragment key={rowItem.id}>
            <div className="ama-grid-rowhead" title={rowItem.notes}>
              {rowItem.label.trim() || '—'}
            </div>
            {cols.map((col) => {
              const inCell = cellOf(items, rowItem.id, col.id)
              const active =
                sel?.row.id === rowItem.id && sel?.col.id === col.id
              const filled = inCell.length > 0
              return (
                <button
                  key={`${rowItem.id}:${col.id}`}
                  type="button"
                  className={
                    active
                      ? 'ama-cell is-active'
                      : filled
                        ? 'ama-cell is-filled'
                        : 'ama-cell'
                  }
                  onClick={() => setSel({ row: rowItem, col })}
                >
                  <span>
                    {inCell[0]?.title || `${rowItem.label} × ${col.label}`}
                  </span>
                  <em className="depro-ida-cell-count">
                    {inCell.length > 0
                      ? `${inCell.length} ficha${inCell.length === 1 ? '' : 's'}`
                      : 'vacía'}
                  </em>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>

      {sel ? (
        <section className="panel ama-inspector depro-ida-inspect">
          <header className="panel-head">
            <h3>Celda</h3>
            <p className="muted">
              {sel.row.label} × {sel.col.label}
              {isCoagulaProcessRow(sel.row.id) ? ' · Coagula' : ' · Solve'}
            </p>
          </header>

          {cellItems.length > 0 && (
            <ul className="depro-ida-list">
              {cellItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={
                      picked?.id === item.id
                        ? 'filter-chip is-active'
                        : 'filter-chip'
                    }
                    onClick={() => setPickedId(item.id)}
                  >
                    {item.title}
                    {item.weight != null ? ` · ${item.weight}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked ? (
            <div className="depro-ida-picked">
              {picked.body ? <p>{picked.body}</p> : null}
              <p className="muted mono">
                {picked.kind} · {picked.stage}
                {picked.weight != null ? ` · peso ${picked.weight}` : ''}
              </p>
              <DeproWeightPicker value={editWeight} onChange={setEditWeight} />
              <div className="depro-inspect-actions">
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={busy}
                  onClick={() => void saveWeight()}
                >
                  Sellar peso
                </button>
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={busy}
                  onClick={() => void propose()}
                >
                  Proponer 3 cards
                </button>
              </div>

              {proposed ? (
                <div className="depro-ida-propose">
                  {proposed.map((card, i) => (
                    <label key={i} className="depro-label">
                      Card {i + 1}
                      <input
                        className="depro-input"
                        value={card.question}
                        onChange={(e) => {
                          const next = [...proposed]
                          next[i] = { ...card, question: e.target.value }
                          setProposed(next)
                        }}
                      />
                      <textarea
                        className="depro-textarea"
                        rows={2}
                        value={card.answer}
                        onChange={(e) => {
                          const next = [...proposed]
                          next[i] = { ...card, answer: e.target.value }
                          setProposed(next)
                        }}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void sealProposed()}
                  >
                    Sellar cards
                  </button>
                </div>
              ) : null}

              {cards.length > 0 && (
                <ul className="depro-ida-card-minis">
                  {cards.map((c) => (
                    <li key={c.id}>
                      <strong>{c.question}</strong>
                      <span className="muted">{c.answer}</span>
                      <button
                        type="button"
                        className="btn btn-tiny"
                        disabled={busy}
                        onClick={() => void removeCard(c.id)}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {neighbors.length > 0 && (
                <div className="depro-ida-neighbors">
                  <h4>Vecinos</h4>
                  <ul>
                    {neighbors.map((n) => (
                      <li key={`${n.object_type}:${n.object_id}`}>
                        <span className="mono">
                          {n.object_type === 'ida_item' ? 'ficha' : 'quántomo'}
                        </span>{' '}
                        {n.title}{' '}
                        <span className="muted">
                          {n.score.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          <label className="depro-label" htmlFor="ida-cell-title">
            Nuevo aprendizaje en esta celda
          </label>
          <input
            id="ida-cell-title"
            className="depro-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Concepto destilado"
          />
          <textarea
            className="depro-textarea"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Cuerpo. Al sellar se embeddea."
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
          <DeproWeightPicker value={weight} onChange={setWeight} />
          {error && <p className="status-line err">{error}</p>}
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy || !title.trim()}
            onClick={() => void createInCell()}
          >
            Anclar a la celda
          </button>
        </section>
      ) : (
        <p className="muted depro-lead">
          Clic en una celda: conteo, inspector, aprendizaje anclado, peso y
          cards.
        </p>
      )}
    </div>
  )
}
