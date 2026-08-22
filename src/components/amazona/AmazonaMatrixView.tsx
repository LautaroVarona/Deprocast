import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaCell,
  AmaCycleSlot,
  AmaListItem,
  AmaMatrixHydrated,
  AmaPlace,
} from '../../types'
import { AmazonaLinks } from './AmazonaLinks'
import { CYCLE_LABEL, CYCLE_SLOTS, TITLE_AXIS } from './labels'

type Props = {
  matrix: AmaMatrixHydrated
  places: AmaPlace[]
  onMatrix: (next: AmaMatrixHydrated) => void
  onClose?: () => void
  showNeo?: boolean
}

function cellOf(
  matrix: AmaMatrixHydrated,
  rowId: string,
  colId: string,
): AmaCell | undefined {
  return matrix.cells.find(
    (c) => c.row_item_id === rowId && c.col_item_id === colId,
  )
}

function defaultTitle(row: AmaListItem, col: AmaListItem): string {
  return `${row.label.trim() || '—'} × ${col.label.trim() || '—'}`
}

export function AmazonaMatrixView({
  matrix,
  places,
  onMatrix,
  onClose,
  showNeo = true,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(matrix.title)
  const [notes, setNotes] = useState(matrix.notes)
  const [sel, setSel] = useState<{ row: AmaListItem; col: AmaListItem } | null>(
    null,
  )
  const [cellTitle, setCellTitle] = useState('')
  const [cellNotes, setCellNotes] = useState('')
  const [cellSlot, setCellSlot] = useState<AmaCycleSlot | ''>('')
  const [cellPlace, setCellPlace] = useState('')

  useEffect(() => {
    setTitle(matrix.title)
    setNotes(matrix.notes)
  }, [matrix.id, matrix.title, matrix.notes])

  const selectedCell = useMemo(() => {
    if (!sel) return undefined
    return cellOf(matrix, sel.row.id, sel.col.id)
  }, [matrix, sel])

  useEffect(() => {
    if (!sel) return
    const cell = cellOf(matrix, sel.row.id, sel.col.id)
    setCellTitle(cell?.title ?? '')
    setCellNotes(cell?.notes ?? '')
    setCellSlot(cell?.cycle_slot ?? '')
    setCellPlace(cell?.place_id ?? '')
  }, [sel, matrix])

  const n = matrix.order_n
  const rows = matrix.row_list.items.slice(0, n)
  const cols = matrix.col_list.items.slice(0, n)

  async function saveMeta() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaUpdateMatrix(matrix.id, {
        title: title.trim(),
        notes,
      })
      if (data.matrix) onMatrix(data.matrix)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function swap() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaSwapMatrix(matrix.id)
      if (data.matrix) {
        onMatrix(data.matrix)
        setSel(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo intercambiar')
    } finally {
      setBusy(false)
    }
  }

  async function saveCell() {
    if (!sel) return
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaPatchCell(matrix.id, {
        row_item_id: sel.row.id,
        col_item_id: sel.col.id,
        title: cellTitle.trim() ? cellTitle : null,
        notes: cellNotes,
        cycle_slot: cellSlot === '' ? null : cellSlot,
        place_id: cellPlace === '' ? null : cellPlace,
      })
      if (data.matrix) onMatrix(data.matrix)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la celda')
    } finally {
      setBusy(false)
    }
  }

  const patchNeo = useCallback(
    async (titleIndex: number, slot: AmaCycleSlot, value: string) => {
      try {
        const data = await api.amazonaPatchNeo(matrix.id, {
          title_index: titleIndex,
          cycle_slot: slot,
          notes: value,
        })
        if (data.matrix) onMatrix(data.matrix)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar')
      }
    },
    [matrix.id, onMatrix],
  )

  const neoNotes = (titleIndex: number, slot: AmaCycleSlot) =>
    matrix.neo_cells.find(
      (c) => c.title_index === titleIndex && c.cycle_slot === slot,
    )?.notes ?? ''

  const titleNames = [
    matrix.title,
    matrix.row_list.title,
    matrix.col_list.title,
  ]

  return (
    <div className="ama-matrix-view">
      <div className="ama-title-frame">
        <div className="ama-title-frame-main">
          <span className="ama-kicker">Lista AmazonA</span>
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveMeta()}
          />
        </div>
        <div className="ama-title-frame-axes">
          <div>
            <span className="ama-kicker">Filas</span>
            <strong>{matrix.row_list.title}</strong>
          </div>
          <div>
            <span className="ama-kicker">Columnas</span>
            <strong>{matrix.col_list.title}</strong>
          </div>
        </div>
        <div className="ama-title-frame-actions">
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy}
            onClick={() => void swap()}
          >
            Intercambiar ejes
          </button>
          {onClose ? (
            <button type="button" className="btn btn-tiny btn-ghost" onClick={onClose}>
              Cerrar
            </button>
          ) : null}
        </div>
      </div>

      <label className="field">
        <span>Notas de la matriz</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void saveMeta()}
        />
      </label>

      {error ? <p className="muted">{error}</p> : null}

      <div className={`ama-grid ama-grid-${n}`}>
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
              const cell = cellOf(matrix, rowItem.id, col.id)
              const active =
                sel?.row.id === rowItem.id && sel?.col.id === col.id
              const filled = Boolean(cell?.notes?.trim() || cell?.title)
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
                  <span>{cell?.title || defaultTitle(rowItem, col)}</span>
                  {cell?.display_slot ? (
                    <em>{CYCLE_LABEL[cell.display_slot]}</em>
                  ) : null}
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>

      {sel ? (
        <div className="panel ama-inspector">
          <header className="panel-head">
            <h3>Celda</h3>
            <p className="muted">
              {defaultTitle(sel.row, sel.col)}
              {selectedCell?.id ? ` · ${selectedCell.id.slice(0, 8)}` : ''}
            </p>
          </header>
          <label className="field">
            <span>Título (vacío = permutación automática)</span>
            <input
              type="text"
              value={cellTitle}
              onChange={(e) => setCellTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Notas</span>
            <textarea
              rows={3}
              value={cellNotes}
              onChange={(e) => setCellNotes(e.target.value)}
            />
          </label>
          <div className="ama-inline-fields">
            <label className="field">
              <span>Ciclo</span>
              <select
                value={cellSlot}
                onChange={(e) =>
                  setCellSlot(e.target.value as AmaCycleSlot | '')
                }
              >
                <option value="">—</option>
                {CYCLE_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {CYCLE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Lugar</span>
              <select
                value={cellPlace}
                onChange={(e) => setCellPlace(e.target.value)}
              >
                <option value="">—</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void saveCell()}
          >
            Guardar celda
          </button>
          {selectedCell?.id ? (
            <AmazonaLinks
              objectType="cell"
              objectId={selectedCell.id}
              places={places}
            />
          ) : (
            <p className="muted">Guardá la celda para poder vincularla.</p>
          )}
        </div>
      ) : null}

      {showNeo && matrix.order_n === 6 ? (
        <div className="panel">
          <header className="panel-head">
            <h3>Neo-matriz 3×3</h3>
            <button
              type="button"
              className="btn btn-tiny"
              onClick={() => void api.amazonaSwapNeo(matrix.id).then((d) => d.matrix && onMatrix(d.matrix))}
            >
              Intercambiar neo-ejes
            </button>
          </header>
          <p className="muted">
            Títulos de la AmazonA × calendario acelerado (Ayer / Hoy / Mañana).
          </p>
          <div className={matrix.neo_swapped ? 'ama-neo is-swapped' : 'ama-neo'}>
            <div />
            {(matrix.neo_swapped ? titleNames : CYCLE_SLOTS.map((s) => CYCLE_LABEL[s])).map(
              (label) => (
                <div key={label} className="ama-neo-head">
                  {label}
                </div>
              ),
            )}
            {(matrix.neo_swapped ? CYCLE_SLOTS : [0, 1, 2]).map((rowKey) => (
              <Fragment key={String(rowKey)}>
                <div className="ama-neo-head">
                  {matrix.neo_swapped
                    ? CYCLE_LABEL[rowKey as AmaCycleSlot]
                    : TITLE_AXIS[rowKey as number]}
                </div>
                {(matrix.neo_swapped ? [0, 1, 2] : CYCLE_SLOTS).map((colKey) => {
                  const titleIndex = matrix.neo_swapped
                    ? (colKey as number)
                    : (rowKey as number)
                  const slot = matrix.neo_swapped
                    ? (rowKey as AmaCycleSlot)
                    : (colKey as AmaCycleSlot)
                  return (
                    <textarea
                      key={`${titleIndex}-${slot}`}
                      className="ama-neo-cell"
                      rows={3}
                      defaultValue={neoNotes(titleIndex, slot)}
                      placeholder={`${titleNames[titleIndex]} · ${CYCLE_LABEL[slot]}`}
                      onBlur={(e) =>
                        void patchNeo(titleIndex, slot, e.target.value)
                      }
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}

      <AmazonaLinks objectType="matrix" objectId={matrix.id} places={places} />
    </div>
  )
}
