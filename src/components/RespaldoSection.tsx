import { useCallback, useEffect, useState } from 'react'
import { api, type BackupApplyResult } from '../services/api'
import type { AppRun } from '../types'

interface Props {
  refreshKey: number
  run: AppRun | null
}

type Summary = Awaited<ReturnType<typeof api.backupSummary>>

const MERGE_RESULT_KEY = 'deprocast.respaldo.last'

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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function sumCounts(counts: Record<string, number> | undefined): number {
  if (!counts) return 0
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

function readStoredResult(): BackupApplyResult | null {
  try {
    const raw = sessionStorage.getItem(MERGE_RESULT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as BackupApplyResult
  } catch {
    return null
  }
}

function storeResult(result: BackupApplyResult) {
  try {
    sessionStorage.setItem(MERGE_RESULT_KEY, JSON.stringify(result))
  } catch {
    /* ignore quota */
  }
}

function describeResult(result: BackupApplyResult): string {
  const inserted = sumCounts(result.inserted)
  const skipped = sumCounts(result.skipped)
  const media = result.media
    ? `${result.media.copied} archivos de media copiados, ${result.media.skipped} ya estaban`
    : 'sin media'
  const mediaFlag =
    result.mediaStatus === 'failed'
      ? ' · MEDIA FALLÓ (metadatos sí se aplicaron)'
      : result.mediaStatus === 'partial'
        ? ' · media parcial (colisiones de hash)'
        : ''
  const tri = result.remapped?.trinchera
    ? ` · Trinchera remapeada`
    : ''
  const profiles = result.profiles
    ? ` · ${result.profiles.persons_merged} personas y ${result.profiles.projects_merged} proyectos fusionados por nombre/alias`
    : ''
  if (result.mode === 'merge') {
    return `Fusionado: ${inserted} filas nuevas, ${skipped} ya existían, ${media}${mediaFlag}${tri}${profiles}.`
  }
  return `Universo reemplazado: ${inserted} filas, ${media}${mediaFlag}${tri}.`
}

export function RespaldoSection({ refreshKey, run }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [mergeFile, setMergeFile] = useState<File | null>(null)
  const [mergeConfirm, setMergeConfirm] = useState('')
  const [merging, setMerging] = useState(false)
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [replaceConfirm, setReplaceConfirm] = useState('')
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

  useEffect(() => {
    const stored = readStoredResult()
    if (!stored) return
    setStatus(describeResult(stored))
    try {
      sessionStorage.removeItem(MERGE_RESULT_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  function download(format: 'json' | 'csv' | 'xml' | 'zip') {
    window.location.href = `/api/backup?format=${format}`
  }

  async function handleMerge() {
    if (!mergeFile) return
    if (mergeConfirm !== 'FUSIONAR') return
    if (mergeFile.size < 22) {
      setError(
        `El archivo está vacío o incompleto (${mergeFile.name}, ${formatBytes(mergeFile.size)}). Esperá a que termine de copiarse o usá el JSON de Respaldo.`,
      )
      return
    }
    setMerging(true)
    setError(null)
    setStatus(null)
    try {
      const result = await api.mergeBackup(mergeFile)
      storeResult(result)
      setStatus(`${describeResult(result)} Recargando…`)
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fusión fallida')
      setMerging(false)
    }
  }

  async function handleRestore() {
    if (!replaceFile) return
    if (replaceConfirm !== 'REEMPLAZAR') return
    setRestoring(true)
    setError(null)
    setStatus(null)
    try {
      const result = await api.restoreBackup(replaceFile)
      storeResult(result)
      setStatus(`${describeResult(result)} Recargando…`)
      window.setTimeout(() => window.location.reload(), 1200)
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
  const t = summary?.tables
  const vaultBytes = (summary?.vault_bytes ?? 0) + (summary?.feedback_bytes ?? 0)
  const vaultFiles = (summary?.vault_files ?? 0) + (summary?.feedback_files ?? 0)
  const zipHeavy = vaultBytes > 200 * 1024 * 1024
  const canMerge =
    mergeFile != null &&
    mergeFile.size >= 22 &&
    mergeConfirm === 'FUSIONAR' &&
    !merging
  const canRestore =
    Boolean(replaceFile) && replaceConfirm === 'REEMPLAZAR' && !restoring
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
        JSON lleva toda la SQLite, incluida IDA (investigaciones, cards,
        cuarentena). ZIP agrega audios e imágenes del vault. Para llevar trabajo
        a otra máquina con más datos, usá <strong>Fusionar</strong>. Reemplazar
        borra el universo destino.
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
            <strong>{g.ida}</strong>
            <span>IDA</span>
            {t && (
              <em className="respaldo-count-sub">
                {t.depro_ida_items ?? 0} fichas · {t.depro_ida_cards ?? 0} cards ·{' '}
                {(t.depro_research_packs ?? 0) + (t.depro_research_findings ?? 0)}{' '}
                research
              </em>
            )}
          </div>
          <div>
            <strong>{g.resto}</strong>
            <span>Resto</span>
          </div>
        </div>
      )}

      <p className="muted respaldo-media">
        Media en disco: {vaultFiles} archivos ({formatBytes(vaultBytes)}). El
        JSON no los incluye; el ZIP sí.
        {zipHeavy &&
          ' Si el ZIP es muy pesado para el browser, exportá JSON y copiá la carpeta vault/ a mano.'}
      </p>

      <div className="respaldo-block">
        <h3>Respaldo (copiar y seguir)</h3>
        <p className="muted">
          JSON y ZIP se pueden volver a importar. CSV y XML son para lectura o
          planillas. No borra nada.
        </p>
        <div className="respaldo-actions">
          <button type="button" className="btn btn-primary" onClick={() => download('json')}>
            JSON
          </button>
          <button type="button" className="btn btn-primary" onClick={() => download('zip')}>
            ZIP (con media)
          </button>
          <button type="button" className="btn" onClick={() => download('csv')}>
            CSV
          </button>
          <button type="button" className="btn" onClick={() => download('xml')}>
            XML
          </button>
        </div>
      </div>

      <div className="respaldo-block respaldo-merge">
        <h3>Fusionar (sumar a este universo)</h3>
        <p className="muted">
          JSON de Respaldo (preferible si el ZIP es enorme o se corta al
          copiar). El ZIP suma media que aún no esté. Fusiona perfiles por
          nombre/alias. No pisa IDA, AmazonA ni la RUN. Escribí FUSIONAR.
        </p>
        <input
          type="file"
          accept=".json,.zip,application/json,application/zip"
          onChange={(e) => setMergeFile(e.target.files?.[0] ?? null)}
        />
        {mergeFile && (
          <p className="mono muted">
            {mergeFile.name} · {formatBytes(mergeFile.size)}
            {mergeFile.size < 22 ? ' — vacío o incompleto' : ''}
          </p>
        )}
        <input
          className="respaldo-confirm"
          type="text"
          placeholder="Escribí FUSIONAR"
          value={mergeConfirm}
          onChange={(e) => setMergeConfirm(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canMerge}
          onClick={() => void handleMerge()}
        >
          {merging ? 'Fusionando…' : 'Fusionar respaldo'}
        </button>
      </div>

      <div className="respaldo-block respaldo-danger">
        <h3>Reemplazar (borra este universo)</h3>
        <p className="muted">
          Borra todas las tablas de este ordenador y deja las del archivo. En
          la oficina esto destruye el trabajo grande. JSON o ZIP. Escribí
          REEMPLAZAR.
        </p>
        <input
          type="file"
          accept=".json,.zip,application/json,application/zip"
          onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
        />
        {replaceFile && <p className="mono muted">{replaceFile.name}</p>}
        <input
          className="respaldo-confirm"
          type="text"
          placeholder="Escribí REEMPLAZAR"
          value={replaceConfirm}
          onChange={(e) => setReplaceConfirm(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-ghost danger"
          disabled={!canRestore}
          onClick={() => void handleRestore()}
        >
          {restoring ? 'Restaurando…' : 'Reemplazar universo'}
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
