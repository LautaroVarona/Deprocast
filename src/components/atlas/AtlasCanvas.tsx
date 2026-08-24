import { useMemo, type RefObject } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  Source,
  Layer,
} from 'react-map-gl/maplibre'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import type { FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl'
import type { FeatureCollection, Geometry } from 'geojson'
import type { GeografiaMapPayload } from '../../types'
import { CARTO_DARK_STYLE, type MapCamera } from '../../lib/map/zones'

type Props = {
  camera: MapCamera
  onCamera: (next: MapCamera) => void
  mapRef: RefObject<MapRef | null>
  payload: GeografiaMapPayload | null
  selectedId: string | null
  onSelect: (id: string) => void
}

function weightColor(w: number, selected: boolean): string {
  const t = Math.max(0, Math.min(1, w / 12))
  const a = selected ? 0.72 : 0.18 + t * 0.55
  const r = Math.round(196 + (255 - 196) * t)
  const g = Math.round(163 + (176 - 163) * (1 - t))
  const b = Math.round(90 * (1 - t))
  return `rgba(${r},${g},${b},${a})`
}

export function AtlasCanvas({
  camera,
  onCamera,
  mapRef,
  payload,
  selectedId,
  onSelect,
}: Props) {
  const data = useMemo(() => {
    const feats = payload?.features.features ?? []
    const hasChildren = feats.some((f) => f.properties.role === 'child')
    return {
      type: 'FeatureCollection' as const,
      features: feats
        .filter((f) => !(hasChildren && f.properties.role === 'self'))
        .map((f) => ({
          ...f,
          geometry: f.geometry as Geometry,
          properties: {
            ...f.properties,
            fill: weightColor(
              f.properties.human_weight,
              f.properties.id === selectedId,
            ),
            line:
              f.properties.id === selectedId
                ? '#ffd27a'
                : 'rgba(255,176,0,0.55)',
            lineW: f.properties.id === selectedId ? 2.4 : 1,
          },
        })),
    } satisfies FeatureCollection
  }, [payload, selectedId])

  const fillLayer: FillLayerSpecification = {
    id: 'atlas-fill',
    type: 'fill',
    source: 'atlas',
    paint: {
      'fill-color': ['get', 'fill'],
      'fill-outline-color': 'rgba(0,0,0,0)',
    },
  }

  const lineLayer: LineLayerSpecification = {
    id: 'atlas-line',
    type: 'line',
    source: 'atlas',
    paint: {
      'line-color': ['get', 'line'],
      'line-width': ['get', 'lineW'],
    },
  }

  function onClick(ev: MapLayerMouseEvent) {
    const id = ev.features?.[0]?.properties?.id
    if (typeof id === 'string' && id) onSelect(id)
  }

  return (
    <div className="mapa-canvas">
      <MapLibreMap
        ref={mapRef}
        longitude={camera.longitude}
        latitude={camera.latitude}
        zoom={camera.zoom}
        pitch={camera.pitch}
        bearing={camera.bearing}
        onMove={(evt) => {
          const vs = evt.viewState
          onCamera({
            longitude: vs.longitude,
            latitude: vs.latitude,
            zoom: vs.zoom,
            pitch: vs.pitch ?? 0,
            bearing: vs.bearing ?? 0,
          })
        }}
        mapStyle={CARTO_DARK_STYLE}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={['atlas-fill']}
        onClick={onClick}
        reuseMaps
        maxPitch={60}
      >
        <NavigationControl position="top-right" visualizePitch />
        {data.features.length > 0 ? (
          <Source id="atlas" type="geojson" data={data}>
            <Layer {...fillLayer} />
            <Layer {...lineLayer} />
          </Source>
        ) : null}
      </MapLibreMap>
    </div>
  )
}
