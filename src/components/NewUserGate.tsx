import { useState } from 'react'
import { api } from '../services/api'
import type { AppRun } from '../types'

interface Props {
  onStarted: (run: AppRun) => void
}

export function NewUserGate({ onStarted }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await api.startRun(trimmed)
      onStarted(data.run)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar')
      setBusy(false)
    }
  }

  return (
    <div className="new-user-gate">
      <section className="panel new-user-card">
        <p className="muted new-user-kicker">Deprocast</p>
        <h1>NUEVO USUARIO</h1>
        <p className="muted">
          Elegí tu nombre. Con eso se forma el primer nodo — el del
          operador/jugador — y arranca la RUN con la fecha de hoy.
        </p>
        <label className="new-user-label" htmlFor="new-user-name">
          Nombre
        </label>
        <input
          id="new-user-name"
          className="respaldo-confirm new-user-input"
          type="text"
          maxLength={120}
          autoComplete="off"
          autoFocus
          placeholder="Tu nombre"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleStart()
          }}
        />
        {error && <p className="status-line err">{error}</p>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name.trim()}
          onClick={() => void handleStart()}
        >
          {busy ? 'Creando…' : 'NUEVO USUARIO'}
        </button>
      </section>
    </div>
  )
}
