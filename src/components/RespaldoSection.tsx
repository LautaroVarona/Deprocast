import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import type { AppRun } from '../types'

interface Props {
  refreshKey: number
  run: AppRun | null
}

type Summary = Awaited<ReturnType<typeof api.backupSummary>>

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function RespaldoSection({ refreshKey, run }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirm, setConfirm] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [destroyPhrase, setDestroyPhrase] = useState('')
  const [operatorConfirm, setOperatorConfirm] = useState('')
  const [newName, setNewName] = useState('')
  const [destroying, setDestroying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.backupSummary()
      setSummary(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al leer el resumen')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  function download(format: 'json' | 'csv' | 'xml') {
    window.location.href = `/api/backup?format=${format}`
  }

  async function handleRestore() {
    if (!file) return
    if (confirm !== 'REEMPLAZAR') return
    setRestoring(true)
    setError(null)
    setStatus(null)
    try {
      await api.restoreBackup(file)
      setStatus('Respaldo restaurado. Recargando…')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore fallido')
      setRestoring(false)
    }
  }

  async function handleNewUser() {
    if (!run) return
    setDestroying(true)
    setError(null)
    setStatus(null)
    try {
      const data = await api.newUserRun({
        confirmDestroy: destroyPhrase,
        operatorName: operatorConfirm,
        newName,
      })
      downloadJsonFile(data.filename, data.dump)
      setStatus('Respaldo de metanálisis guardado. Nueva RUN. Recargando…')
      window.setTimeout(() => window.location.reload(), 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NUEVO USUARIO fallido')
      setDestroying(false)
    }
  }

  const g = summary?.groups
  const canRestore = Boolean(file) && confirm === 'REEMPLAZAR' && !restoring
  const canDestroy =
    !!run &&
    destroyPhrase === 'DESTRUIR' &&
    operatorConfirm.trim().toLocaleLowerCase('es') ===
      run.operator_name.trim().toLocaleLowerCase('es') &&
    newName.trim().length > 0 &&
    !destroying

  return (
    <section className="panel respaldo-section" id="respaldo">
      <header className="panel-head">
        <h2>Respaldo</h2>
        {summary && (
          <span className="muted mono">{summary.exported_at.slice(0, 19)}</span>
        )}
      </header>

      <p className="muted respaldo-warn">
        Exportá una copia de la cuenta y seguí jugando. El JSON sirve para
        importarlo en otro universo. No incluye audios, videos ni imágenes del
        vault; sí un índice de esos archivos. AmazonA y el mapa no se tocan al
        empezar de cero.
      </p>

      {run && (
        <p className="muted respaldo-run">
          RUN de <strong>{run.operator_name}</strong> · inicio{' '}
          <span className="mono">{run.started_at.slice(0, 10)}</span> · día{' '}
          {run.day_count}
        </p>
      )}

      {error && <p className="status-line err">{error}</p>}
      {status && <p className="status-line ok">{status}</p>}
      {loading && !summary && <p className="muted empty">Cargando…</p>}

      {g && (
        <div className="respaldo-counts">
          <div>
            <strong>{g.transcripciones}</strong>
            <span>Transcripciones</span>
          </div>
          <div>
            <strong>{g.perfiles}</strong>
            <span>Perfiles</span>
          </div>
          <div>
            <strong>{g.conexiones}</strong>
            <span>Conexiones</span>
          </div>
          <div>
            <strong>{g.quantomos}</strong>
            <span>Quántomos</span>
          </div>
          <div>
            <strong>{g.validaciones}</strong>
            <span>Validaciones</span>
          </div>
          <div>
            <strong>{g.resto}</strong>
            <span>Resto</span>
          </div>
        </div>
      )}

      <div className="respaldo-block">
        <h3>Respaldo (copiar y seguir)</h3>
        <p className="muted">
          JSON es el único formato que se puede volver a importar. CSV y XML
          son para lectura o planillas. No borra nada.
        </p>
        <div className="respaldo-actions">
          <button type="button" className="btn btn-primary" onClick={() => download('json')}>
            JSON
          </button>
          <button type="button" className="btn" onClick={() => download('csv')}>
            CSV
          </button>
          <button type="button" className="btn" onClick={() => download('xml')}>
            XML
          </button>
        </div>
      </div>

      <div className="respaldo-block respaldo-danger">
        <h3>Importar (reemplaza todo)</h3>
        <p className="muted">
          Solo JSON de Deprocast. Escribí REEMPLAZAR para confirmar. Esta
          acción no se puede deshacer.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file && <p className="mono muted">{file.name}</p>}
        <input
          className="respaldo-confirm"
          type="text"
          placeholder="Escribí REEMPLAZAR"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-ghost danger"
          disabled={!canRestore}
          onClick={() => void handleRestore()}
        >
          {restoring ? 'Restaurando…' : 'Restaurar respaldo'}
        </button>
      </div>

      {run && (
        <div className="respaldo-block respaldo-danger">
          <h3>NUEVO USUARIO</h3>
          <p className="muted">
            Primero se genera un JSON de metanálisis (100% de esta RUN, con
            nombre y fecha) y se guarda en disco. Recién después se destruye la
            actividad del usuario. AmazonA, el mapa, las listas de agentes
            y el núcleo Deprocast quedan. Nunca se destruye sin respaldo.
          </p>
          <label className="new-user-label" htmlFor="destroy-phrase">
            Escribí DESTRUIR
          </label>
          <input
            id="destroy-phrase"
            className="respaldo-confirm"
            type="text"
            placeholder="DESTRUIR"
            value={destroyPhrase}
            onChange={(e) => setDestroyPhrase(e.target.value)}
            autoComplete="off"
            disabled={destroying}
          />
          <label className="new-user-label" htmlFor="destroy-operator">
            Nombre actual del operador
          </label>
          <input
            id="destroy-operator"
            className="respaldo-confirm"
            type="text"
            placeholder={run.operator_name}
            value={operatorConfirm}
            onChange={(e) => setOperatorConfirm(e.target.value)}
            autoComplete="off"
            disabled={destroying}
          />
          <label className="new-user-label" htmlFor="destroy-new-name">
            Nombre del nuevo operador
          </label>
          <input
            id="destroy-new-name"
            className="respaldo-confirm"
            type="text"
            maxLength={120}
            placeholder="Nombre para la nueva RUN"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoComplete="off"
            disabled={destroying}
          />
          <button
            type="button"
            className="btn btn-primary danger"
            disabled={!canDestroy}
            onClick={() => void handleNewUser()}
          >
            {destroying ? 'Respaldando y destruyendo…' : 'NUEVO USUARIO'}
          </button>
        </div>
      )}
    </section>
  )
}
