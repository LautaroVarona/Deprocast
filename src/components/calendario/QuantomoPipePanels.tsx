import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import type { Quantomo } from '../../types'

type Chest = {
  open_threads: Array<{
    id: string
    title: string
    updated_at: string
    hermetic_weight: number | null
  }>
  proto: number
  pre: number
  sealed: number
  premium: number
}

function formatBatchError(
  errors: Array<{ id: string; error: string }>,
): string | null {
  if (errors.length === 0) return null
  const head = errors.slice(0, 3).map((e) => e.error).join(' · ')
  return errors.length > 3 ? `${head} (+${errors.length - 3})` : head
}

export function CofrePanel() {
  const [chest, setChest] = useState<Chest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getQuantomoChest()
      setChest({
        open_threads: data.open_threads,
        proto: data.proto,
        pre: data.pre,
        sealed: data.sealed,
        premium: data.premium,
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="cal-pipe-panel">
      <p className="cal-ingest-label mono">Cofre</p>
      <p className="muted cal-pipe-lead">
        Cerrá hilos y votá 1–12. Nacen protoquántomos.
      </p>
      {error && <p className="status-line err">{error}</p>}
      {chest && (
        <ul className="cal-pipe-stats mono">
          <li>hilos abiertos · {chest.open_threads.length}</li>
          <li>proto · {chest.proto}</li>
          <li>pre · {chest.pre}</li>
          <li>sellados · {chest.sealed}</li>
          <li>premium · {chest.premium}</li>
        </ul>
      )}
      {chest && chest.open_threads.length > 0 && (
        <ul className="cal-pipe-list">
          {chest.open_threads.slice(0, 5).map((t) => (
            <li key={t.id}>{t.title}</li>
          ))}
        </ul>
      )}
      <p className="muted mono cal-pipe-hint">Terminar está en Diálogo.</p>
    </section>
  )
}

export function CampamentoQueue() {
  const [items, setItems] = useState<Quantomo[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api.listQuantomos('proto')
    setItems(data.quantomos)
  }, [])

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [load])

  async function promote(id: string) {
    setBusyId(id)
    setError(null)
    setStatus(null)
    try {
      await api.promoteQuantomoPre(id, { profile: { campamento: true } })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function promoteAll() {
    if (items.length === 0 || batchBusy) return
    const ok = window.confirm(
      `¿Pasar ${items.length} proto a pre? El NER uno a uno se salta. El sello sigue en Castillo.`,
    )
    if (!ok) return
    setBatchBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await api.promoteQuantomoPreBatch(
        items.map((q) => q.id),
        { profile: { campamento: true } },
      )
      setStatus(
        `Pre ${res.promoted} · ya en pre/sello ${res.skipped} · no encontrados ${res.missing}`,
      )
      const batchErr = formatBatchError(res.errors)
      if (batchErr) setError(batchErr)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <section className="cal-pipe-panel">
      <p className="cal-ingest-label mono">Cola proto · {items.length}</p>
      <p className="muted cal-pipe-lead">
        NER, perfiles, vínculos. Validar pre.
      </p>
      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}
      {items.length === 0 ? (
        <p className="muted empty">Sin protoquántomos.</p>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={batchBusy || busyId != null}
            onClick={() => void promoteAll()}
          >
            {batchBusy ? 'Pasando…' : `Pre todos (${items.length})`}
          </button>
          <ul className="cal-pipe-list is-scroll">
            {items.map((q) => (
              <li key={q.id} className="cal-pipe-item">
                <span>{q.title}</span>
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={busyId === q.id || batchBusy}
                  onClick={() => void promote(q.id)}
                >
                  Pre
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function CastilloSealPanel() {
  const [items, setItems] = useState<Quantomo[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api.listQuantomos('pre')
    setItems(data.quantomos)
  }, [])

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [load])

  async function seal(id: string) {
    setBusyId(id)
    setError(null)
    setStatus(null)
    try {
      await api.sealQuantomo(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function sealAll() {
    if (items.length === 0 || batchBusy) return
    const ok = window.confirm(
      `¿Sellar ${items.length} prequántomos? Pone recognized=1 y lattice L72. Diálogo bebe lo sellado.`,
    )
    if (!ok) return
    setBatchBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await api.applyQuantomoSeal({ ids: items.map((q) => q.id) })
      setStatus(
        `Sellados ${res.sealed} · ya sellados ${res.skipped} · no encontrados ${res.missing}`,
      )
      const batchErr = formatBatchError(res.errors)
      if (batchErr) setError(batchErr)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <section className="cal-pipe-panel">
      <p className="cal-ingest-label mono">Coagular · {items.length}</p>
      <p className="muted cal-pipe-lead">
        Prequántomos → sello L72. Mastropiero lee lo premium.
      </p>
      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}
      {items.length === 0 ? (
        <p className="muted empty">Nada en pre este ciclo.</p>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={batchBusy || busyId != null}
            onClick={() => void sealAll()}
          >
            {batchBusy ? 'Sellando…' : `Sellar todos (${items.length})`}
          </button>
          <ul className="cal-pipe-list is-scroll">
            {items.map((q) => (
              <li key={q.id} className="cal-pipe-item">
                <span>{q.title}</span>
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={busyId === q.id || batchBusy}
                  onClick={() => void seal(q.id)}
                >
                  Sellar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
