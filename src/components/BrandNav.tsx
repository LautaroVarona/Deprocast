import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveSession } from '../live/LiveSessionContext'

export type AppView =
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
  | 'conocimiento'
  | 'chats'
  | 'dialogo'
  | 'sentinela'
  | 'respaldo'
  | 'configuracion'
  | 'calendario'
  | 'amazona'
  | 'mapa'
  | 'atlas'
  | 'aleph'

type Leaf =
  | { kind: 'view'; id: AppView; label: string; stayHome: boolean }
  | { kind: 'path'; label: string; path: '/deprocast' }

type Group = {
  id: string
  label: string
  items: Leaf[]
}

const GROUPS: Group[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    items: [
      { kind: 'view', id: 'dashboard', label: 'Dashboard', stayHome: true },
      { kind: 'view', id: 'dialogo', label: 'Diálogo', stayHome: true },
      { kind: 'view', id: 'sentinela', label: 'Sentinela', stayHome: true },
    ],
  },
  {
    id: 'captura',
    label: 'Captura',
    items: [
      { kind: 'view', id: 'franca', label: 'Zona franca', stayHome: true },
      { kind: 'view', id: 'directo', label: 'Directo', stayHome: true },
      { kind: 'view', id: 'aduana', label: 'Aduana', stayHome: false },
      { kind: 'view', id: 'criba', label: 'Criba', stayHome: true },
      { kind: 'view', id: 'chats', label: 'Chats · import', stayHome: true },
      { kind: 'view', id: 'biblioteca', label: 'Biblioteca', stayHome: true },
      { kind: 'view', id: 'conocimiento', label: 'Conocimiento', stayHome: true },
    ],
  },
  {
    id: 'archivo',
    label: 'Archivo',
    items: [
      { kind: 'view', id: 'validada', label: 'Validada', stayHome: true },
      { kind: 'view', id: 'quantomos', label: 'Quántomos', stayHome: true },
    ],
  },
  {
    id: 'figuras',
    label: 'Figuras',
    items: [
      { kind: 'view', id: 'entidades', label: 'Entidades', stayHome: true },
      { kind: 'view', id: 'amazona', label: 'AmazonA', stayHome: true },
    ],
  },
  {
    id: 'espacio',
    label: 'Espacio',
    items: [
      { kind: 'view', id: 'atlas', label: 'Atlas', stayHome: true },
      { kind: 'view', id: 'aleph', label: 'Aleph', stayHome: true },
      { kind: 'view', id: 'grafo', label: 'Grafo', stayHome: true },
      { kind: 'view', id: 'mapa', label: 'Mapa', stayHome: true },
      { kind: 'view', id: 'calendario', label: 'Calendario', stayHome: true },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      { kind: 'view', id: 'respaldo', label: 'Respaldo', stayHome: true },
      { kind: 'view', id: 'configuracion', label: 'Config', stayHome: true },
      { kind: 'path', label: 'Núcleo', path: '/deprocast' },
    ],
  },
]

const PANEL_W = 220

type Props = {
  view: AppView
  onGo: (id: AppView, stayHome?: boolean) => void
  onPath: (path: string) => void
  aduanaHot: boolean
  pipelineRunning: boolean
  entityPending: number
}

function groupHasView(group: Group, view: AppView): boolean {
  return group.items.some((item) => item.kind === 'view' && item.id === view)
}

export function BrandNav({
  view,
  onGo,
  onPath,
  aduanaHot,
  pipelineRunning,
  entityPending,
}: Props) {
  const { status } = useLiveSession()
  const listening = status === 'listening'
  const [openId, setOpenId] = useState<string | null>(null)
  const [panelPos, setPanelPos] = useState<{
    top: number
    left: number
    scrimTop: number
  } | null>(null)
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const openGroup = GROUPS.find((g) => g.id === openId) ?? null

  const placePanel = useCallback(() => {
    if (!openId) {
      setPanelPos(null)
      return
    }
    const trigger = triggerRefs.current[openId]
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const bar = trigger.closest('.brand-bar')
    const scrimTop = bar?.getBoundingClientRect().bottom ?? rect.bottom
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - PANEL_W - 8),
    )
    setPanelPos({
      top: rect.bottom + 6,
      left,
      scrimTop,
    })
  }, [openId])

  useLayoutEffect(() => {
    placePanel()
  }, [placePanel])

  useEffect(() => {
    if (!openId) return
    const onWin = () => placePanel()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [openId, placePanel])

  return (
    <nav className="brand-nav" aria-label="Secciones">
      {GROUPS.map((group) => {
        const active = groupHasView(group, view)
        const open = openId === group.id
        const showAduana = group.id === 'captura' && aduanaHot
        const showEntities = group.id === 'figuras' && entityPending > 0
        const showLive = group.id === 'captura' && listening
        return (
          <div key={group.id} className={`nav-menu${open ? ' is-open' : ''}`}>
            <button
              type="button"
              ref={(el) => {
                triggerRefs.current[group.id] = el
              }}
              className={[
                'btn btn-tiny nav-menu-trigger',
                active ? 'is-nav-active' : '',
                open ? 'is-open' : '',
                showLive ? 'is-live-listening' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpenId(open ? null : group.id)}
            >
              {group.label}
              {showLive && <span className="nav-live-pulse" aria-hidden />}
              {showAduana && (
                <span className="nav-badge">
                  {pipelineRunning ? '●' : '!'}
                </span>
              )}
              {showEntities && (
                <span className="nav-badge">{entityPending}</span>
              )}
            </button>
          </div>
        )
      })}
      {openGroup &&
        panelPos &&
        createPortal(
          <>
            <button
              type="button"
              className="nav-menu-scrim"
              aria-label="Cerrar menú"
              style={{ top: panelPos.scrimTop }}
              onMouseDown={() => setOpenId(null)}
            />
            <div
              className="nav-menu-panel"
              role="menu"
              style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
            >
              {openGroup.items.map((item) => {
                if (item.kind === 'path') {
                  return (
                    <button
                      key={item.path}
                      type="button"
                      role="menuitem"
                      className="nav-menu-item"
                      onClick={() => {
                        setOpenId(null)
                        onPath(item.path)
                      }}
                    >
                      {item.label}
                    </button>
                  )
                }
                const current = view === item.id
                const itemLive = item.id === 'directo' && listening
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={[
                      'nav-menu-item',
                      current ? 'is-current' : '',
                      itemLive ? 'is-live-listening' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      setOpenId(null)
                      onGo(item.id, item.stayHome)
                    }}
                  >
                    {item.label}
                    {itemLive && (
                      <span className="nav-live-pulse" aria-hidden />
                    )}
                    {item.id === 'aduana' && aduanaHot && (
                      <span className="nav-badge">
                        {pipelineRunning ? '●' : '!'}
                      </span>
                    )}
                    {item.id === 'entidades' && entityPending > 0 && (
                      <span className="nav-badge">{entityPending}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </>,
          document.body,
        )}
    </nav>
  )
}
