import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrandNav, type AppView } from './components/BrandNav'
import { FreeZone } from './components/FreeZone'
import { CustomsPanel } from './components/CustomsPanel'
import { ValidatedSection } from './components/ValidatedSection'
import { EntityHub, type EntityHubMode } from './components/EntityHub'
import { QuantomosSection } from './components/QuantomosSection'
import { GraphWorkspace } from './components/GraphWorkspace'
import { CribaPanel } from './components/CribaPanel'
import { BibliotecaSection } from './components/BibliotecaSection'
import { ConocimientoSection } from './components/ConocimientoSection'
import { ChatsSection } from './components/ChatsSection'
import { RespaldoSection } from './components/RespaldoSection'
import { ConfiguracionSection } from './components/ConfiguracionSection'
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
import { isDeprocastPath, navigate, usePathname } from './lib/path'
import { LiveSessionProvider } from './live/LiveSessionContext'
import type { AppRun } from './types'

const AlephSection = lazy(() =>
  import('./components/aleph/AlephSection').then((m) => ({
    default: m.AlephSection,
  })),
)

type View = AppView

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
  const [runLoadError, setRunLoadError] = useState<string | null>(null)
  const [entityMode, setEntityMode] = useState<EntityHubMode>('perfiles')
  const [dialogoThreadId, setDialogoThreadId] = useState<string | null>(null)
  const [dialogoSeed, setDialogoSeed] = useState<string | null>(null)
  const [quantomoFocusId, setQuantomoFocusId] = useState<string | null>(null)
  const [validatedFocusId, setValidatedFocusId] = useState<string | null>(null)
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
      setRunLoadError(null)
    } catch (err) {
      setRunLoadError(
        err instanceof Error ? err.message : 'No se pudo hablar con la API',
      )
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

  const go = (id: View, stayHome = false) => {
    preferHome.current = stayHome
    if (id === 'dialogo') setDialogoSeed(null)
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

  if (runLoadError && !run) {
    return (
      <div className="new-user-gate">
        <section className="panel new-user-card">
          <p className="muted new-user-kicker">Deprocast</p>
          <h1>API caída</h1>
          <p className="muted">
            No es un usuario nuevo: el server no respondió. Arrancá de nuevo
            con <span className="mono">npm run dev</span> (Node 24 en el PATH).
          </p>
          <p className="status-line err">{runLoadError}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setRunReady(false)
              void loadRun()
            }}
          >
            Reintentar
          </button>
        </section>
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
              : view === 'sentinela'
                ? 'app-shell is-sentinela-mode'
                : view === 'dashboard' || view === 'dialogo'
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
        <BrandNav
          view={view}
          onGo={go}
          onPath={navigate}
          aduanaHot={aduanaHot}
          pipelineRunning={pipelineRunning}
          entityPending={entityPending}
        />
      </header>

      <main
        className={
          view === 'aduana' || view === 'criba'
            ? 'stage-aduana'
            : view === 'validada' ||
                view === 'quantomos' ||
                view === 'biblioteca' ||
                view === 'conocimiento' ||
                view === 'chats' ||
                view === 'dialogo' ||
                view === 'sentinela' ||
                view === 'respaldo' ||
                view === 'configuracion' ||
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
        ) : view === 'conocimiento' ? (
          <ConocimientoSection refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'dialogo' ? (
          <DialogoSection
            refreshKey={refreshKey}
            initialThreadId={dialogoThreadId}
            seedQuery={dialogoSeed}
            onSeedConsumed={() => setDialogoSeed(null)}
            onCiteNavigate={(target) => {
              preferHome.current = true
              if (target.view === 'quantomos') {
                setQuantomoFocusId(target.focusId)
                setView('quantomos')
                return
              }
              if (target.view === 'validada') {
                setValidatedFocusId(target.entryId)
                setView('validada')
                return
              }
              setEntityMode(target.mode)
              setView('entidades')
            }}
          />
        ) : view === 'sentinela' ? (
          <SentinelSection refreshKey={refreshKey} />
        ) : view === 'chats' ? (
          <ChatsSection refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'validada' ? (
          <ValidatedSection
            refreshKey={refreshKey}
            focusEntryId={validatedFocusId}
            onFocusConsumed={() => setValidatedFocusId(null)}
          />
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
          <QuantomosSection
            refreshKey={refreshKey}
            focusId={quantomoFocusId}
            onFocusConsumed={() => setQuantomoFocusId(null)}
          />
        ) : view === 'grafo' ? (
          <GraphWorkspace refreshKey={refreshKey} onChanged={bump} />
        ) : view === 'respaldo' ? (
          <RespaldoSection refreshKey={refreshKey} run={run} />
        ) : view === 'configuracion' ? (
          <ConfiguracionSection refreshKey={refreshKey} />
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
