import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaCycleState,
  AmaList,
  AmaMatrix,
  AmaMatrixHydrated,
  AmaPlace,
} from '../../types'
import { AmazonaMatrixView } from './AmazonaMatrixView'
import { CYCLE_LABEL, CYCLE_SLOTS } from './labels'

type Props = {
  refreshKey: number
  places: AmaPlace[]
  onChanged?: () => void
}

export function AmazonaCiclo({ refreshKey, places, onChanged }: Props) {
  const [cycle, setCycle] = useState<AmaCycleState | null>(null)
  const [tridentes, setTridentes] = useState<AmaList[]>([])
  const [matrices, setMatrices] = useState<AmaMatrix[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [open, setOpen] = useState<AmaMatrixHydrated | null>(null)
  const [pickTridente, setPickTridente] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [c, t, m] = await Promise.all([
        api.amazonaCycle(),
        api.amazonaListLists({ kind: 'tridente' }),
        api.amazonaListMatrices(),
      ])
      setCycle(c.cycle)
      setTridentes(t.lists)
      setMatrices(m.matrices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el ciclo')
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
    void api.amazonaGetMatrix(openId).then((data) => {
      if (!cancelled) setOpen(data.matrix)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  async function advance() {
    setBusy(true)
    try {
      const data = await api.amazonaAdvanceCycle()
      setCycle(data.cycle)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo avanzar')
    } finally {
      setBusy(false)
    }
  }

  async function crossCalendar() {
    const cal = tridentes.find((t) => t.id === 'ama-tridente-calendario')
    if (!pickTridente || !cal) {
      setError('Hace falta un Tridente y el Calendario acelerado')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const other = tridentes.find((t) => t.id === pickTridente)
      const data = await api.amazonaCreateMatrix({
        title:
          title.trim() ||
          `${other?.title ?? 'Tridente'} × Calendario acelerado`,
        order_n: 3,
        row_list_id: pickTridente,
        col_list_id: cal.id,
      })
      setTitle('')
      onChanged?.()
      await load()
      if (data.matrix) setOpenId(data.matrix.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cruzar')
    } finally {
      setBusy(false)
    }
  }

  const amazona6 = matrices.filter((m) => m.order_n === 6)

  return (
    <div className="ama-ciclo">
      <div className="panel">
        <header className="panel-head">
          <h2>Calendario acelerado</h2>
        </header>
        <p className="muted">
          Ayer / Hoy / Mañana es un Tridente cíclico. Avanzar el ciclo rota el
          significado operativo: lo que era Hoy pasa a Ayer, Mañana a Hoy, Ayer
          a Mañana. Distinto del Tridente Temporal (Pasado / Presente / Futuro),
          que mapea al mapa estelar.
        </p>
        {error ? <p className="muted">{error}</p> : null}
          <div className="ama-cycle-row">
          {CYCLE_SLOTS.map((slot) => (
            <div
              key={slot}
              className={slot === 'hoy' ? 'ama-cycle-card is-hoy' : 'ama-cycle-card'}
            >
              <span className="ama-kicker">slot</span>
              <strong>{CYCLE_LABEL[slot]}</strong>
            </div>
          ))}
        </div>
        <p className="muted">
          Fase {cycle?.offset ?? 0} · Hoy iniciado:{' '}
          {cycle?.hoy_started_at
            ? new Date(cycle.hoy_started_at).toLocaleString('es-ES')
            : '—'}
          . Avanzar rota las celdas etiquetadas Ayer/Hoy/Mañana.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void advance()}
        >
          Avanzar ciclo
        </button>
      </div>

      <div className="panel">
        <header className="panel-head">
          <h2>Cruce Tridente × Calendario</h2>
        </header>
        <p className="muted">Genera un esquema 3×3 (9 celdas).</p>
        <div className="ama-inline-fields">
          <label className="field">
            <span>Tridente</span>
            <select
              value={pickTridente}
              onChange={(e) => setPickTridente(e.target.value)}
            >
              <option value="">Elegí…</option>
              {tridentes
                .filter((t) => t.id !== 'ama-tridente-calendario')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Título (opcional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={busy || !pickTridente}
          onClick={() => void crossCalendar()}
        >
          Crear 3×3
        </button>
      </div>

      <div className="panel">
        <header className="panel-head">
          <h2>Neo-matriz de una AmazonA</h2>
        </header>
        <p className="muted">
          Abrí una Lista AmazonA para editar su marco de 3 títulos × Ayer / Hoy
          / Mañana.
        </p>
        <ul className="ama-list-nav">
          {amazona6.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={
                  m.id === openId ? 'ama-nav-item is-active' : 'ama-nav-item'
                }
                onClick={() => setOpenId(m.id)}
              >
                <strong>{m.title}</strong>
                <span>
                  {m.row_title} × {m.col_title}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {open ? (
          <AmazonaMatrixView
            matrix={open}
            places={places}
            showNeo
            onMatrix={(next) => {
              setOpen(next)
              onChanged?.()
            }}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </div>
    </div>
  )
}
