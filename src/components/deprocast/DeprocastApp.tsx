import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type { AppRun, AmaMatrixHydrated, DeproIdaItem, DeproPower, DeproPowerNote } from '../../types'
import {
  deprocastHref,
  deprocastTab,
  navigate,
  type DeprocastTab,
} from '../../lib/path'
import { mergePowerOverlay, POWER_CATALOG } from '../../lib/deprocast'
import { DeprocastMatrix } from './DeprocastMatrix'
import { DeprocastAgents } from './DeprocastAgents'
import { DeprocastIda } from './DeprocastIda'
import type { IdaDraft } from './idaDraft'

type Props = {
  run: AppRun
  path: string
}

export function DeprocastApp({ run, path }: Props) {
  const tab = deprocastTab(path)
  const [notes, setNotes] = useState<DeproPowerNote[]>([])
  const [ida, setIda] = useState<DeproIdaItem[]>([])
  const [idaMatrix, setIdaMatrix] = useState<AmaMatrixHydrated | null>(null)
  const [idaDraft, setIdaDraft] = useState<IdaDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.deprocastCatalog()
      setNotes(data.power_notes)
      setIda(data.ida)
      setIdaMatrix(data.ida_matrix ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el núcleo')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const prev = document.title
    document.title = 'Deprocast · núcleo'
    return () => {
      document.title = prev
    }
  }, [])

  const powers: DeproPower[] = useMemo(() => {
    const byIndex = new Map(notes.map((n) => [n.power_index, n]))
    return POWER_CATALOG.map((p) => mergePowerOverlay(p, byIndex.get(p.index)))
  }, [notes])

  const go = (next: DeprocastTab) => {
    navigate(deprocastHref(next))
  }

  const openIda = (draft: IdaDraft) => {
    setIdaDraft(draft)
    navigate(deprocastHref('ida'))
  }

  return (
    <div className="app-shell is-deprocast-mode">
      <header className="brand-bar depro-bar">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <h1>Núcleo</h1>
          <div className="brand-run">
            <span className="brand-run-name">{run.operator_name}</span>
            <span className="muted mono">Input · Procesamiento · Output</span>
          </div>
        </div>
        <nav className="brand-nav depro-nav" aria-label="Núcleo Deprocast">
          <a
            href="/"
            className="btn btn-tiny"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            ← operación
          </a>
          <button
            type="button"
            className={tab === 'matrix' ? 'btn btn-tiny is-nav-active' : 'btn btn-tiny'}
            onClick={() => go('matrix')}
          >
            Matrix 72
          </button>
          <button
            type="button"
            className={tab === 'agentes' ? 'btn btn-tiny is-nav-active' : 'btn btn-tiny'}
            onClick={() => go('agentes')}
          >
            Agentes
          </button>
          <button
            type="button"
            className={tab === 'ida' ? 'btn btn-tiny is-nav-active' : 'btn btn-tiny'}
            onClick={() => go('ida')}
          >
            IDA
            {ida.length > 0 ? <span className="nav-badge">{ida.length}</span> : null}
          </button>
        </nav>
      </header>

      {error && <p className="status-line err">{error}</p>}

      <main className="stage-validada depro-stage">
        {tab === 'agentes' ? (
          <DeprocastAgents powers={powers} ida={ida} onOpenIda={openIda} />
        ) : tab === 'ida' ? (
          <DeprocastIda
            items={ida}
            powers={powers}
            matrix={idaMatrix}
            draft={idaDraft}
            onDraftConsumed={() => setIdaDraft(null)}
            onChanged={() => void load()}
          />
        ) : (
          <DeprocastMatrix
            powers={powers}
            onChanged={() => void load()}
            onOpenIda={openIda}
          />
        )}
      </main>
    </div>
  )
}
