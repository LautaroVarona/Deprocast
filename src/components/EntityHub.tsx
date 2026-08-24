import { useEffect, useState } from 'react'
import { PersonsSection } from './PersonsSection'
import { ProjectsSection } from './ProjectsSection'
import { DominiosSection } from './DominiosSection'
import { GeografiaSection } from './GeografiaSection'
import { WaitingRoomSection } from './WaitingRoomSection'
import { api } from '../services/api'

export type EntityHubMode =
  | 'perfiles'
  | 'agrupaciones'
  | 'proyectos'
  | 'dominios'
  | 'geografia'
  | 'sala'

interface Props {
  refreshKey: number
  onChanged?: () => void
  personPending?: number
  projectPending?: number
  initialMode?: EntityHubMode
  onOpenAtlas?: (id: string) => void
}

export function EntityHub({
  refreshKey,
  onChanged,
  personPending = 0,
  projectPending = 0,
  initialMode = 'perfiles',
  onOpenAtlas,
}: Props) {
  const [mode, setMode] = useState<EntityHubMode>(initialMode)
  const [agrupacionCount, setAgrupacionCount] = useState(0)
  const [dominioCount, setDominioCount] = useState(0)
  const [geografiaCount, setGeografiaCount] = useState(0)
  const [waitingCount, setWaitingCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api.listAgrupaciones(),
      api.listDominios(),
      api.listGeografia(),
      api.listWaiting(),
    ])
      .then(([agrup, doms, geo, waiting]) => {
        if (cancelled) return
        setAgrupacionCount(agrup.agrupaciones?.length ?? 0)
        setDominioCount(doms.dominios?.length ?? 0)
        setGeografiaCount(geo.masters?.length ?? geo.places?.length ?? 0)
        setWaitingCount(waiting.count ?? waiting.items?.length ?? 0)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey, mode])

  return (
    <div className="entity-stage personas-stage">
      <div
        className="personas-mode-switch"
        role="tablist"
        aria-label="Modo de vista"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'sala'}
          className={mode === 'sala' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setMode('sala')}
        >
          Sala de espera
          {waitingCount > 0 ? (
            <span className="nav-badge">{waitingCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'perfiles'}
          className={
            mode === 'perfiles' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setMode('perfiles')}
        >
          Perfiles
          {personPending > 0 ? (
            <span className="nav-badge">{personPending}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'agrupaciones'}
          className={
            mode === 'agrupaciones' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setMode('agrupaciones')}
        >
          Agrupaciones
          {agrupacionCount > 0 ? (
            <span className="nav-badge">{agrupacionCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'geografia'}
          className={
            mode === 'geografia' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setMode('geografia')}
        >
          Geografía
          {geografiaCount > 0 ? (
            <span className="nav-badge">{geografiaCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'dominios'}
          className={
            mode === 'dominios' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setMode('dominios')}
        >
          Dominios
          {dominioCount > 0 ? (
            <span className="nav-badge">{dominioCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'proyectos'}
          className={
            mode === 'proyectos' ? 'filter-chip is-active' : 'filter-chip'
          }
          onClick={() => setMode('proyectos')}
        >
          Proyectos
          {projectPending > 0 ? (
            <span className="nav-badge">{projectPending}</span>
          ) : null}
        </button>
      </div>

      {mode === 'sala' ? (
        <WaitingRoomSection refreshKey={refreshKey} onChanged={onChanged} />
      ) : mode === 'proyectos' ? (
        <ProjectsSection
          refreshKey={refreshKey}
          onChanged={onChanged}
          embedded
        />
      ) : mode === 'dominios' ? (
        <DominiosSection refreshKey={refreshKey} onChanged={onChanged} />
      ) : mode === 'geografia' ? (
        <GeografiaSection
          refreshKey={refreshKey}
          onChanged={onChanged}
          onOpenAtlas={onOpenAtlas}
        />
      ) : (
        <PersonsSection
          refreshKey={refreshKey}
          onChanged={onChanged}
          mode={mode === 'agrupaciones' ? 'agrupaciones' : 'perfiles'}
          embedded
        />
      )}
    </div>
  )
}
