import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { api } from '../../services/api'
import type { Geografia, GeografiaMapPayload, GeografiaTreeNode } from '../../types'
import type { MapCamera } from '../../lib/map/zones'
import { AtlasCanvas } from './AtlasCanvas'
import { AtlasTree } from './AtlasTree'

const START: MapCamera = {
  longitude: -0.4,
  latitude: 39.5,
  zoom: 6.2,
  pitch: 0,
  bearing: 0,
}

const ROOT_ID = 'geo-europa'

type Props = {
  refreshKey: number
  focusId?: string | null
  onFocusConsumed?: () => void
}

function collectIds(nodes: GeografiaTreeNode[], into: string[]): string[] {
  for (const n of nodes) {
    into.push(n.id)
    collectIds(n.children, into)
  }
  return into
}

function findNode(
  nodes: GeografiaTreeNode[],
  id: string,
): GeografiaTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return null
}

function ancestorIds(nodes: GeografiaTreeNode[], id: string): string[] {
  const walk = (
    list: GeografiaTreeNode[],
    trail: string[],
  ): string[] | null => {
    for (const n of list) {
      if (n.id === id) return trail
      const hit = walk(n.children, [...trail, n.id])
      if (hit) return hit
    }
    return null
  }
  return walk(nodes, []) ?? []
}

export function AtlasSection({
  refreshKey,
  focusId,
  onFocusConsumed,
}: Props) {
  const mapRef = useRef<MapRef | null>(null)
  const [tree, setTree] = useState<GeografiaTreeNode[]>([])
  const [selectedId, setSelectedId] = useState(ROOT_ID)
  const [payload, setPayload] = useState<GeografiaMapPayload | null>(null)
  const [camera, setCamera] = useState<MapCamera>(START)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([ROOT_ID, 'geo-es', 'geo-es-vc']),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadTree = useCallback(async () => {
    try {
      const res = await api.listGeografiaTree()
      setTree(res.tree ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el árbol')
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree, refreshKey])

  useEffect(() => {
    if (!focusId) return
    setSelectedId(focusId)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestorIds(tree, focusId)) next.add(id)
      next.add(focusId)
      return next
    })
    onFocusConsumed?.()
  }, [focusId, tree, onFocusConsumed])

  useEffect(() => {
    let cancelled = false
    void api
      .getGeografiaMap(selectedId)
      .then((res) => {
        if (cancelled) return
        setPayload(res)
        if (res.bbox) {
          const [w, s, e, n] = res.bbox
          mapRef.current?.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            { padding: 48, duration: 700, maxZoom: 11 },
          )
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar el mapa')
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected: Geografia | null = payload?.node ?? findNode(tree, selectedId)

  const crumb = useMemo(() => {
    const anc = payload?.ancestors ?? []
    const node = payload?.node
    return node ? [...anc, node] : []
  }, [payload])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setWeight(value: number) {
    if (!selected || busy) return
    setBusy(true)
    try {
      await api.updateGeografia(selected.id, { human_weight: value })
      await loadTree()
      const res = await api.getGeografiaMap(selected.id)
      setPayload(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el peso')
    } finally {
      setBusy(false)
    }
  }

  const count = collectIds(tree, []).length

  return (
    <div className="mapa-stage atlas-stage">
      <header className="mapa-head">
        <div>
          <p className="mapa-kicker">ATLAS · gazetteer</p>
          <h2>{selected?.name ?? 'Atlas'}</h2>
        </div>
        <div className="mapa-hud">
          <span className="mapa-bodies">{count} nodos</span>
        </div>
      </header>
      {error ? <p className="mapa-error">{error}</p> : null}
      <nav className="atlas-crumb" aria-label="Jerarquía">
        {crumb.map((n, i) => (
          <span key={n.id}>
            {i > 0 ? <span className="atlas-crumb-sep">/</span> : null}
            <button type="button" onClick={() => setSelectedId(n.id)}>
              {n.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="mapa-body">
        <AtlasCanvas
          camera={camera}
          onCamera={setCamera}
          mapRef={mapRef}
          payload={payload}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <aside className="mapa-side">
          <section className="mapa-panel-block">
            <p className="mapa-kicker">Listado</p>
            {tree.length === 0 ? (
              <p className="muted mono">Sin nodos.</p>
            ) : (
              <AtlasTree
                nodes={tree}
                selectedId={selectedId}
                expanded={expanded}
                onToggle={toggle}
                onSelect={setSelectedId}
              />
            )}
          </section>
          {selected ? (
            <section className="mapa-panel-block">
              <p className="mapa-kicker">Nodo</p>
              <p className="atlas-node-name">{selected.name}</p>
              <p className="muted mono atlas-node-meta">
                {selected.admin_type || selected.kind}
                {selected.admin_code ? ` · ${selected.admin_code}` : ''}
                {selected.capital_name ? ` · cap. ${selected.capital_name}` : ''}
              </p>
              <label className="field">
                <span className="mono">Peso {selected.human_weight ?? 0}</span>
                <input
                  type="range"
                  min={0}
                  max={12}
                  value={selected.human_weight ?? 0}
                  disabled={busy}
                  onChange={(e) => void setWeight(Number(e.target.value))}
                />
              </label>
              <p className="muted atlas-weight-hint">
                El mismo peso pinta el polígono y el listado de Entidades.
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
