import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { FreeZone } from './components/FreeZone'
import { CustomsPanel } from './components/CustomsPanel'
import { ValidatedSection } from './components/ValidatedSection'
import { EntityHub, type EntityHubMode } from './components/EntityHub'
import { QuantomosSection } from './components/QuantomosSection'
import { GraphWorkspace } from './components/GraphWorkspace'
import { CribaPanel } from './components/CribaPanel'
import { BibliotecaSection } from './components/BibliotecaSection'
import { ChatsSection } from './components/ChatsSection'
import { RespaldoSection } from './components/RespaldoSection'
import { CalendarioSection } from './components/calendario/CalendarioSection'
import { AmazonaSection } from './components/AmazonaSection'
import { MapaSection } from './components/mapa/MapaSection'
import { AtlasSection } from './components/atlas/AtlasSection'
import {
  DashboardSection,
  type DashboardNavigateTarget,
} from './components/DashboardSection'
import { DialogoSection } from './components/dialogo/DialogoSection'
import { SentinelSection } from './components/sentinel/SentinelSection'
import { DirectoSection } from './components/DirectoSection'
import { FeedbackWidget } from './components/FeedbackWidget'
import { NewUserGate } from './components/NewUserGate'
import { AppFooter } from './components/AppFooter'
import { DeprocastApp } from './components/deprocast/DeprocastApp'
import { api } from './services/api'
import { isDeprocastPath, usePathname } from './lib/path'
import {
  LiveSessionProvider,
  useLiveSession,
} from './live/LiveSessionContext'
import type { AppRun } from './types'

const AlephSection = lazy(() =>
  import('./components/aleph/AlephSection').then((m) => ({
    default: m.AlephSection,
  })),
)

type View =
  | 'dashboard'
  | 'franca'
  | 'directo'
  | 'aduana'
  | 'validada'
  | 'entidades'
  | 'quantomos'
  | 'grafo'
  | 'criba'
  | 'biblioteca'
  | 'chats'
  | 'dialogo'
  | 'sentinela'
  | 'respaldo'
  | 'calendario'
  | 'amazona'
  | 'mapa'
  | 'atlas'
  | 'aleph'

function DirectoNavButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  const { status } = useLiveSession()
  const listening = status === 'listening'
  return (
    <button
      type="button"
      className={
        active
          ? `btn btn-tiny is-nav-active${listening ? ' is-live-listening' : ''}`
          : `btn btn-tiny${listening ? ' is-live-listening' : ''}`
      }
      onClick={onClick}
      title={listening ? 'Directo · escuchando' : 'Directo'}
    >
      Directo
      {listening && <span className="nav-live-pulse" aria-hidden />}
    </button>
  )
}

export default function App() {
  const path = usePathname()
  const [refreshKey, setRefreshKey] = useState(0)
  const [view, setView] = useState<View>('dashboard')
  const [hasPending, setHasPending] = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [personPending, setPersonPending] = useState(0)
  const [projectPending, setProjectPending] = useState(0)
  const [run, setRun] = useState<AppRun | null>(null)
  const [runReady, setRunReady] = useState(false)
  const [entityMode, setEntityMode] = useState<EntityHubMode>('perfiles')
  const [dialogoThreadId, setDialogoThreadId] = useState<string | null>(null)
  const [dialogoSeed, setDialogoSeed] = useState<string | null>(null)
  const [atlasFocusId, setAtlasFocusId] = useState<string | null>(null)
  const preferHome = useRef(true)
  const sawPending = useRef(false)
  const sawRunning = useRef(false)
  const checkInFlight = useRef(false)

  const bump = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleEmpty = useCallback(() => {
    setHasPending(false)
  }, [])

  const loadRun = useCallback(async () => {
    try {
      const data = await api.getRun()
      setRun(data.run)
    } catch {
      setRun(null)
    } finally {
      setRunReady(true)
    }
  }, [])

  useEffect(() => {
    void loadRun()
  }, [loadRun])

  const checkPending = useCallback(async () => {
    if (checkInFlight.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    checkInFlight.current = true
    try {
      const [aduana, criba, pipe, roster, projectRoster] = await Promise.all([
        api.getPendingProposals(),
        api.getCribaAudios().catch(() => ({ entries: [] })),
        api.getPipelineStatus(),
        api.listPersons().catch(() => null),
        api.listProjects().catch(() => null),
      ])
      const has = aduana.proposals.length > 0 || criba.entries.length > 0
      const running = pipe.running && !pipe.paused
      setHasPending(has)
      setPipelineRunning(running)
      const waiting = roster?.waiting_count ?? 0
      const personNer = roster?.pending_proposals_count ?? 0
      setPersonPending(personNer + waiting)
      const projectWaiting = projectRoster?.waiting_count ?? 0
      const projectNer = projectRoster?.pending_proposals_count ?? 0
      setProjectPending(projectNer + projectWaiting)

      if (
        (running && !sawRunning.current) ||
        (has && !sawPending.current)
      ) {
        if (!preferHome.current && !isDeprocastPath(window.location.pathname)) {
          setView('aduana')
        }
      }

      sawPending.current = has
      sawRunning.current = running
    } catch {
      /* keep current mode */
    } finally {
      checkInFlight.current = false
    }
  }, [])

  useEffect(() => {
    if (!run) return
    const t = window.setTimeout(() => void checkPending(), 320)
    return () => window.clearTimeout(t)
  }, [checkPending, refreshKey, run])

  useEffect(() => {
    if (!run) return
    const id = window.setInterval(() => void checkPending(), 5000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void checkPending()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [checkPending, run])

  const navClass = (id: View) =>
    view === id ? 'btn btn-tiny is-nav-active' : 'btn btn-tiny'

  const go = (id: View, stayHome = false) => {
    preferHome.current = stayHome
    setView(id)
  }

  const onDashboardNavigate = useCallback((target: DashboardNavigateTarget) => {
    preferHome.current = true
    if (target.view === 'dialogo') {
      setDialogoThreadId(target.threadId)
      setDialogoSeed(target.seedQuery ?? null)
      setView('dialogo')
      return
    }
    if (target.view === 'entidades') {
      setEntityMode(target.mode)
      setView('entidades')
      return
    }
    setView(target.view)
  }, [])

  const aduanaHot = hasPending || pipelineRunning
  const entityPending = personPending + projectPending

  if (!runReady) {
    return (
      <div className="new-user-gate">
        <p className="muted">Cargando…</p>
      </div>
    )
  }

  if (!run) {
    return <NewUserGate onStarted={(next) => setRun(next)} />
  }

  const runStartLabel = (() => {
    const d = new Date(run.started_at)
    if (Number.isNaN(d.getTime())) return run.started_at.slice(0, 10)
    return d.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  })()

  if (isDeprocastPath(path)) {
    return (
      <>
        <DeprocastApp run={run} path={path} />
        <FeedbackWidget view="deprocast" />
      </>
    )
  }

  return (
    <LiveSessionProvider>
    <>
    <div
      className={
        view === 'grafo' || view === 'mapa' || view === 'atlas' || view === 'aleph'
          ? 'app-shell is-graph-mode'
          : view === 'biblioteca'
            ? 'app-shell is-biblioteca-mode'
            : view === 'calendario'
              ? 'app-shell is-calendario-mode'
              : view === 'dashboard' || view === 'dialogo' || view === 'sentinela'
                ? 'app-shell is-dashboard-mode'
                : 'app-shell'
      }
    >
      <header className="brand-bar">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <h1>Deprocast</h1>
          <div className="brand-run">
            <span className="brand-run-name">{run.operator_name}</span>
            <span className="muted mono">desde {runStartLabel}</span>
          </div>
        </div>
        <nav className="brand-nav">
          <button
            type="button"
            className={navClass('dashboard')}
            onClick={() => go('dashboard', true)}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={navClass('franca')}
            onClick={() => go('franca', true)}
          >
            Zona franca
          </button>
          <DirectoNavButton
            active={view === 'directo'}
            onClick={() => go('directo', true)}
          />
          <button
            type="button"
            className={navClass('aduana')}
            onClick={() => go('aduana', false)}
          >
            Aduana
            {aduanaHot && (
              <span className="nav-badge">
                {pipelineRunning ? '●' : '!'}
              </span>
            )}
          </button>
          <button
            type="button"
            className={navClass('criba')}
            onClick={() => go('criba', true)}
          >
            Criba
          </button>
          <button
            type="button"
            className={navClass('biblioteca')}
            onClick={() => go('biblioteca', true)}
          >
            Biblioteca
          </button>
          <button
            type="button"
            className={navClass('dialogo')}
            onClick={() => {
              setDialogoSeed(null)
              go('dialogo', true)
            }}
          >
            Diálogo
          </button>
          <button
            type="button"
            className={navClass('sentinela')}
            onClick={() => go('sentinela', true)}
          >
            Sentinela
          </button>
          <button
            type="button"
            className={navClass('chats')}
            title="Import de WhatsApp / redes"
            onClick={() => go('chats', true)}
          >
            Chats · import
          </button>
          <button
            type="button"
            className={navClass('validada')}
            onClick={() => go('validada', true)}
          >
            Validada
          </button>
          <button
            type="button"
            className={navClass('calendario')}
            onClick={() => go('calendario', true)}
          >
            Calendario
          </button>
          <button
            type="button"
            className={navClass('amazona')}
            onClick={() => go('amazona', true)}
          >
            AmazonA
          </button>
          <button
            type="button"
            className={navClass('mapa')}
            onClick={() => go('mapa', true)}
          >
            Mapa
          </button>
          <button
            type="button"
            className={navClass('atlas')}
            onClick={() => go('atlas', true)}
          >
            Atlas
          </button>
          <button
            type="button"
            className={navClass('aleph')}
            onClick={() => go('aleph', true)}
          >
            Aleph
          </button>
          <button
            type="button"
            className={navClass('entidades')}
            onClick={() => go('entidades', true)}
          >
            Entidades
            {entityPending > 0 && (
              <span className="nav-badge">{entityPending}</span>
            )}
          </button>
          <button
            type="button"
            className={navClass('quantomos')}
            onClick={() => go('quantomos', true)}
          >
            Quántomos
          </button>
          <button
            type="button"
            className={navClass('grafo')}
            onClick={() => go('grafo', true)}
          >
            Grafo
          </button>
          <button
            type="button"
            className={navClass('respaldo')}
            onClick={() => go('respaldo', true)}
          >
            Respaldo
          </button>
        </nav>
      </header>

      <main
        className={
          view === 'aduana' || view === 'criba'
            ? 'stage-aduana'
            : view === 'validada' ||
                view === 'quantomos' ||
                view === 'biblioteca' ||
                view === 'chats' ||
                view === 'dialogo' ||
                view === 'sentinela' ||
                view === 'respaldo' ||
                view === 'calendario' ||
                view === 'amazona'
              ? 'stage-validada'
              : view === 'entidades'
                ? 'stage-entity'
                : view === 'grafo' || view === 'mapa' || view === 'atlas' || view === 'aleph'
                  ? 'stage-graph'
                  : view === 'dashboard'
                    ? 'stage-dashboard'
                    : 'stage-franca'
        }
      >
        {view === 'dashboard' ? (
          <DashboardSection
            operatorName={run.operator_name}
            refreshKey={refreshKey}
            onNavigate={onDashboardNavigate}
          />
        ) : view === 'directo' ? (
          <DirectoSection />
        ) : view === 'aduana' ? (
          <CustomsPanel
            refreshKey={refreshKey}
            onEmpty={handleEmpty}
            onChanged={bump}
          />
        ) : view === 'criba' ? (
          <CribaPanel refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'biblioteca' ? (
          <BibliotecaSection refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'dialogo' ? (
          <DialogoSection
            refreshKey={refreshKey}
            initialThreadId={dialogoThreadId}
            seedQuery={dialogoSeed}
            onSeedConsumed={() => setDialogoSeed(null)}
          />
        ) : view === 'sentinela' ? (
          <SentinelSection refreshKey={refreshKey} />
        ) : view === 'chats' ? (
          <ChatsSection refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'validada' ? (
          <ValidatedSection refreshKey={refreshKey} />
        ) : view === 'entidades' ? (
          <EntityHub
            key={entityMode}
            refreshKey={refreshKey}
            onChanged={bump}
            personPending={personPending}
            projectPending={projectPending}
            initialMode={entityMode}
            onOpenAtlas={(id) => {
              setAtlasFocusId(id)
              go('atlas', true)
            }}
          />
        ) : view === 'quantomos' ? (
          <QuantomosSection refreshKey={refreshKey} />
        ) : view === 'grafo' ? (
          <GraphWorkspace refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'respaldo' ? (
          <RespaldoSection refreshKey={refreshKey} run={run} />
        ) : view === 'calendario' ? (
          <CalendarioSection refreshKey={refreshKey} onChanged={bump} run={run} />
        ) : view === 'amazona' ? (
          <AmazonaSection refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'mapa' ? (
          <MapaSection
            refreshKey={refreshKey}
            onChanged={bump}
            onOpenAtlas={() => go('atlas', true)}
          />
        ) : view === 'atlas' ? (
          <AtlasSection
            refreshKey={refreshKey}
            focusId={atlasFocusId}
            onFocusConsumed={() => setAtlasFocusId(null)}
          />
        ) : view === 'aleph' ? (
          <Suspense
            fallback={
              <div className="aleph-workspace">
                <p className="muted aleph-fallback">Cargando Aleph…</p>
              </div>
            }
          >
            <AlephSection />
          </Suspense>
        ) : (
          <FreeZone
            onProcessed={() => {
              preferHome.current = false
              setView('aduana')
              bump()
            }}
            onChanged={bump}
          />
        )}
      </main>
    </div>
    <AppFooter />
    <FeedbackWidget view={view} />
    </>
    </LiveSessionProvider>
  )
}
