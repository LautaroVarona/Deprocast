import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { api } from '../../services/api'
import type {
  AmaPlace,
  MapOccupancyItem,
  MapOverview,
} from '../../types'
import { PATERNA_VIEW, type MapCamera } from '../../lib/map/zones'
import { MapaCanvas, type MapPick } from './MapaCanvas'
import { MapaLayerPanel } from './MapaLayerPanel'
import { MapaOccupancy } from './MapaOccupancy'

const SYSTEM_KEY = 'deprocast.map.system'

type Props = {
  refreshKey: number
  onChanged?: () => void
  onOpenAtlas?: () => void
}

function cameraFromOverview(data: MapOverview): MapCamera {
  return {
    longitude: data.system.center_lng,
    latitude: data.system.center_lat,
    zoom: data.system.zoom,
    pitch: data.system.pitch,
    bearing: data.system.bearing,
  }
}

export function MapaSection({ refreshKey, onChanged, onOpenAtlas }: Props) {
  const mapRef = useRef<MapRef | null>(null)
  const [data, setData] = useState<MapOverview | null>(null)
  const [systemId, setSystemId] = useState(
    () => localStorage.getItem(SYSTEM_KEY) || 'map-sys-pghqg',
  )
  const [camera, setCamera] = useState<MapCamera>(PATERNA_VIEW)
  const [pick, setPick] = useState<MapPick | null>(null)
  const [occupancy, setOccupancy] = useState<MapOccupancyItem[]>([])
  const [radarDisk, setRadarDisk] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedPlace: AmaPlace | null =
    pick?.type === 'place'
      ? pick.place
      : pick?.type === 'hex'
        ? pick.place
        : null

  const load = useCallback(async (id?: string) => {
    try {
      const next = await api.mapOverview(id)
      setData(next)
      setSystemId(next.system.id)
      localStorage.setItem(SYSTEM_KEY, next.system.id)
      setError(null)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el mapa')
      return null
    }
  }, [])

  useEffect(() => {
    void load(systemId)
  }, [load, refreshKey])

  useEffect(() => {
    let cancelled = false
    void load(systemId).then((next) => {
      if (!next || cancelled) return
      const cam = cameraFromOverview(next)
      setCamera(cam)
      mapRef.current?.flyTo({
        center: [cam.longitude, cam.latitude],
        zoom: cam.zoom,
        pitch: cam.pitch,
        bearing: cam.bearing,
        duration: 700,
      })
    })
    return () => {
      cancelled = true
    }
  }, [load, systemId])

  useEffect(() => {
    if (!selectedPlace) {
      setOccupancy([])
      setRadarDisk([])
      return
    }
    let cancelled = false
    void api
      .mapOccupancy(selectedPlace.id)
      .then((res) => {
        if (!cancelled) setOccupancy(res.items)
      })
      .catch(() => {
        if (!cancelled) setOccupancy([])
      })
    if (selectedPlace.lat != null && selectedPlace.lng != null) {
      void api
        .mapH3(selectedPlace.lat, selectedPlace.lng, 8, 1)
        .then((res) => {
          if (!cancelled) setRadarDisk(res.disk.filter((h) => h !== res.cell))
        })
        .catch(() => {
          if (!cancelled) setRadarDisk([])
        })
    }
    return () => {
      cancelled = true
    }
  }, [selectedPlace])

  const moon = data?.moon

  const zoneTree = useMemo(() => {
    const zones = data?.zones ?? []
    return zones.filter(
      (z) => z.role === 'nucleo' || z.role === 'sector' || z.role === 'ruta',
    )
  }, [data?.zones])

  function flyHome() {
    const target = data ? cameraFromOverview(data) : PATERNA_VIEW
    setCamera(target)
    mapRef.current?.flyTo({
      center: [target.longitude, target.latitude],
      zoom: target.zoom,
      pitch: target.pitch,
      bearing: target.bearing,
      duration: 900,
    })
  }

  function flyToPlace(place: AmaPlace) {
    if (place.lat == null || place.lng == null) return
    mapRef.current?.flyTo({
      center: [place.lng, place.lat],
      zoom: Math.max(camera.zoom, 13),
      duration: 700,
    })
    setPick({ type: 'place', place })
  }

  async function patchLayer(id: string, visible?: boolean, opacity?: number) {
    setBusy(true)
    try {
      await api.mapPatchLayer(id, { visible, opacity })
      await load(systemId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la capa')
    } finally {
      setBusy(false)
    }
  }

  async function createSystem(name: string) {
    setBusy(true)
    try {
      const created = await api.mapCreateSystem({
        name,
        center_lat: camera.latitude,
        center_lng: camera.longitude,
        zoom: camera.zoom,
        pitch: camera.pitch,
        bearing: camera.bearing,
        copy_from: systemId,
      })
      setPick(null)
      setSystemId(created.system.id)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el sistema')
    } finally {
      setBusy(false)
    }
  }

  async function deleteSystem(id: string) {
    setBusy(true)
    try {
      await api.mapDeleteSystem(id)
      setPick(null)
      setSystemId('map-sys-pghqg')
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  async function occupy(
    kind: 'person' | 'project' | 'agrupacion' | 'entry',
    id: string,
  ) {
    if (!selectedPlace) return
    setBusy(true)
    try {
      await api.mapOccupy({ place_id: selectedPlace.id, kind, id })
      const occ = await api.mapOccupancy(selectedPlace.id)
      setOccupancy(occ.items)
      await load(systemId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anclar')
    } finally {
      setBusy(false)
    }
  }

  async function unoccupy(item: MapOccupancyItem) {
    if (!selectedPlace) return
    if (
      item.kind !== 'person' &&
      item.kind !== 'project' &&
      item.kind !== 'agrupacion' &&
      item.kind !== 'entry'
    ) {
      return
    }
    setBusy(true)
    try {
      await api.mapUnoccupy({
        place_id: selectedPlace.id,
        kind: item.kind,
        id: item.id,
      })
      const occ = await api.mapOccupancy(selectedPlace.id)
      setOccupancy(occ.items)
      await load(systemId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar')
    } finally {
      setBusy(false)
    }
  }

  async function createTag(label: string, notes: string) {
    if (pick?.type !== 'empty') return
    setBusy(true)
    try {
      const created = await api.mapCreateTag({
        system_id: systemId,
        lat: pick.lat,
        lng: pick.lng,
        label,
        notes,
      })
      await load(systemId)
      setPick({ type: 'tag', tag: created.tag })
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el tag')
    } finally {
      setBusy(false)
    }
  }

  async function deleteTag(id: string) {
    setBusy(true)
    try {
      await api.mapDeleteTag(id)
      setPick(null)
      await load(systemId)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el tag')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mapa-stage">
      <header className="mapa-head">
        <div>
          <p className="mapa-kicker">MAPA 4X · PGHQG</p>
          <h2>{data?.system.name ?? 'Paterna'}</h2>
        </div>
        <div className="mapa-hud">
          <span className="mapa-moon" title={moon?.label}>
            {moon?.label ?? 'Luna'}
            {moon ? ` · ${Math.round(moon.illumination * 100)}%` : ''}
          </span>
          <span className="mapa-bodies">Sol · Luna · Mercurio</span>
          <button type="button" className="btn btn-tiny" onClick={flyHome}>
            Home
          </button>
          {onOpenAtlas ? (
            <button type="button" className="btn btn-tiny" onClick={onOpenAtlas}>
              Atlas
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="mapa-error">{error}</p> : null}
      <div className="mapa-body">
        {data ? (
          <MapaCanvas
            camera={camera}
            onCamera={setCamera}
            mapRef={mapRef}
            layers={data.layers}
            zones={data.zones}
            tags={data.tags}
            flows={data.flows}
            occupancy={data.occupancy}
            moonIllumination={data.moon.illumination}
            radarDisk={radarDisk}
            selectedPlaceId={selectedPlace?.id ?? null}
            selectedTagId={pick?.type === 'tag' ? pick.tag.id : null}
            onPick={setPick}
          />
        ) : (
          <div className="mapa-canvas mapa-canvas-empty">Cargando mapa…</div>
        )}
        <aside className="mapa-side">
          {data ? (
            <MapaLayerPanel
              systems={data.systems}
              systemId={data.system.id}
              layers={data.layers}
              busy={busy}
              onSelectSystem={setSystemId}
              onToggleLayer={(id, visible) => void patchLayer(id, visible)}
              onOpacity={(id, opacity) => void patchLayer(id, undefined, opacity)}
              onCreateSystem={(name) => void createSystem(name)}
              onDeleteSystem={(id) => void deleteSystem(id)}
            />
          ) : null}
          <MapaOccupancy
            pick={pick}
            occupancy={occupancy}
            zones={data?.zones ?? []}
            busy={busy}
            onOccupy={(kind, id) => void occupy(kind, id)}
            onUnoccupy={(item) => void unoccupy(item)}
            onCreateTag={(label, notes) => void createTag(label, notes)}
            onDeleteTag={(id) => void deleteTag(id)}
          />
          <section className="mapa-panel-block">
            <p className="mapa-kicker">Zonas</p>
            <ul className="mapa-zone-list">
              {zoneTree.map((zone) => (
                <li key={zone.id}>
                  <button
                    type="button"
                    className={
                      selectedPlace?.id === zone.id
                        ? 'mapa-zone-btn is-active'
                        : 'mapa-zone-btn'
                    }
                    onClick={() => flyToPlace(zone)}
                  >
                    <span>{zone.name}</span>
                    <em>{zone.zone_code || zone.role}</em>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
