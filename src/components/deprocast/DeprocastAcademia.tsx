import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import type { DeproIdaCardDue } from '../../types'

export function DeprocastAcademia() {
  const [cards, setCards] = useState<DeproIdaCardDue[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.deprocastIdaDue()
      setCards(res.cards)
      setIndex(0)
      setRevealed(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la cola')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = cards[index] ?? null

  async function grade(which: 'again' | 'good') {
    if (!current || busy) return
    setBusy(true)
    try {
      await api.deprocastReviewIdaCard(current.id, which)
      const next = cards.filter((c) => c.id !== current.id)
      setCards(next)
      setIndex(0)
      setRevealed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar')
    } finally {
      setBusy(false)
    }
  }

  async function exportMd() {
    setBusy(true)
    setCopied(false)
    try {
      const res = await api.deprocastIdaExport()
      await navigator.clipboard.writeText(res.markdown)
      setCopied(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel depro-academia">
      <header className="panel-head">
        <h2>Academia</h2>
        <span className="muted mono">
          {cards.length} due
        </span>
      </header>
      <p className="muted depro-lead">
        Pregunta → respuesta → programar. El voto 1–12 es la Criba; esto es
        retención.
      </p>

      {error && <p className="status-line err">{error}</p>}

      {!current ? (
        <p className="muted">Nada due. Sellá cards en la Tabla.</p>
      ) : (
        <div className="depro-academia-card">
          <p className="muted mono">{current.ida_title}</p>
          <p className="depro-academia-q">{current.question}</p>
          {revealed ? (
            <p className="depro-academia-a">{current.answer || '—'}</p>
          ) : (
            <button
              type="button"
              className="btn btn-tiny"
              onClick={() => setRevealed(true)}
            >
              Revelar
            </button>
          )}
          {revealed && (
            <div className="depro-ida-card-actions">
              <button
                type="button"
                className="btn btn-tiny"
                disabled={busy}
                onClick={() => void grade('again')}
              >
                Otra vez
              </button>
              <button
                type="button"
                className="btn btn-tiny"
                disabled={busy}
                onClick={() => void grade('good')}
              >
                Bien
              </button>
            </div>
          )}
        </div>
      )}

      <div className="depro-inspect-actions">
        <button
          type="button"
          className="btn btn-tiny"
          disabled={busy}
          onClick={() => void exportMd()}
        >
          Copiar export markdown
        </button>
        {copied ? <span className="muted">Copiado</span> : null}
      </div>
    </section>
  )
}
