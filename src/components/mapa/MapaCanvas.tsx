import { useMemo, type RefObject } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { MapboxOverlayProps } from '@deck.gl/mapbox'
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import {
  Map as MapLibreMap,
  NavigationControl,
  useControl,
} from 'react-map-gl/maplibre'
import type { MapRef } from 'react-map-gl/maplibre'
import type { PickingInfo } from '@deck.gl/core'
import type {
  AmaFlow,
  AmaPlace,
  MapLayer,
  MapOccupancyCounts,
  MapTag,
} from '../../types'
import { parentHex } from '../../lib/map/h3'
import {
  CARTO_DARK_STYLE,
  type MapCamera,
  resolutionForZoom,
} from '../../lib/map/zones'

export type MapPick =
  | { type: 'place'; place: AmaPlace }
  | { type: 'hex'; hex: string; place: AmaPlace | null }
  | { type: 'tag'; tag: MapTag }
  | { type: 'empty'; lat: number; lng: number }

type Props = {
  camera: MapCamera
  onCamera: (next: MapCamera) => void
  mapRef: RefObject<MapRef | null>
  layers: MapLayer[]
  zones: AmaPlace[]
  tags: MapTag[]
  flows: AmaFlow[]
  occupancy: MapOccupancyCounts[]
  moonIllumination: number
  radarDisk: string[]
  selectedPlaceId: string | null
  selectedTagId: string | null
  onPick: (pick: MapPick) => void
}

type PlaceDatum = {
  kind: 'place'
  id: string
  label: string
  place: AmaPlace
  position: [number, number]
}

type HexDatum = {
  kind: 'hex'
  hex: string
  label: string
  place: AmaPlace | null
  color: [number, number, number, number]
  elevation: number
}

type TagDatum = {
  kind: 'tag'
  id: string
  label: string
  tag: MapTag
  position: [number, number]
}

type ArcDatum = {
  from: [number, number]
  to: [number, number]
  label: string
  width: number
}

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props))
  overlay.setProps(props)
  return null
}

function layerOf(layers: MapLayer[], kind: string): MapLayer | undefined {
  return layers.find((l) => l.kind === kind)
}

function isOn(layer: MapLayer | undefined): boolean {
  return Boolean(layer && layer.visible)
}

function opacityOf(layer: MapLayer | undefined, fallback = 1): number {
  if (!layer) return fallback
  return Number.isFinite(layer.opacity) ? layer.opacity : fallback
}

function roleColor(
  role: string | null | undefined,
): [number, number, number, number] {
  if (role === 'nucleo') return [255, 176, 0, 230]
  if (role === 'sector') return [61, 155, 122, 210]
  if (role === 'ruta') return [120, 170, 210, 200]
  return [196, 163, 90, 190]
}

function heatColor(
  total: number,
): [number, number, number, number] {
  const t = Math.min(1, total / 8)
  return [255, Math.round(176 + (80 - 176) * t), Math.round(40 * (1 - t)), 220]
}

export function MapaCanvas({
  camera,
  onCamera,
  mapRef,
  layers,
  zones,
  tags,
  flows,
  occupancy,
  moonIllumination,
  radarDisk,
  selectedPlaceId,
  selectedTagId,
  onPick,
}: Props) {
  const occByPlace = useMemo(() => {
    const map = new Map<string, MapOccupancyCounts>()
    for (const row of occupancy) map.set(row.place_id, row)
    return map
  }, [occupancy])

  const fisico = layerOf(layers, 'fisico')
  const h3 = layerOf(layers, 'h3')
  const occupancyLayer = layerOf(layers, 'occupancy')
  const amazona = layerOf(layers, 'amazona')
  const aristas = layerOf(layers, 'aristas')
  const chronos = layerOf(layers, 'chronos')
  const tagsLayer = layerOf(layers, 'tags')

  const pinned = useMemo(
    () => zones.filter((z) => z.lat != null && z.lng != null),
    [zones],
  )

  const placeData: PlaceDatum[] = useMemo(
    () =>
      pinned.map((place) => ({
        kind: 'place' as const,
        id: place.id,
        label: place.name,
        place,
        position: [place.lng as number, place.lat as number],
      })),
    [pinned],
  )

  const hexData: HexDatum[] = useMemo(() => {
    const res = resolutionForZoom(camera.zoom)
    const seen = new Map<string, HexDatum>()
    const moonBoost = isOn(chronos) ? 0.45 + moonIllumination * 1.15 : 1
    for (const place of pinned) {
      if (!place.h3_index) continue
      const hex =
        res === 7 ? parentHex(place.h3_index) : place.h3_index
      if (!hex) continue
      const counts = occByPlace.get(place.id)
      const total = counts?.total ?? 0
      const prev = seen.get(hex)
      if (prev && (prev.place ? occByPlace.get(prev.place.id)?.total ?? 0 : 0) >= total) {
        continue
      }
      const color = isOn(occupancyLayer)
        ? heatColor(total)
        : roleColor(place.role)
      const elevation =
        (8 + total * 18) * moonBoost * (isOn(chronos) || isOn(occupancyLayer) ? 1 : 0.35)
      seen.set(hex, {
        kind: 'hex',
        hex,
        label: place.name,
        place,
        color,
        elevation,
      })
    }
    return [...seen.values()]
  }, [
    camera.zoom,
    pinned,
    occByPlace,
    occupancyLayer,
    chronos,
    moonIllumination,
  ])

  const radarData: HexDatum[] = useMemo(
    () =>
      radarDisk.map((hex) => ({
        kind: 'hex' as const,
        hex,
        label: 'Radar',
        place: null,
        color: [0, 210, 220, 55] as [number, number, number, number],
        elevation: 6,
      })),
    [radarDisk],
  )

  const tagData: TagDatum[] = useMemo(
    () =>
      tags.map((tag) => ({
        kind: 'tag' as const,
        id: tag.id,
        label: tag.label,
        tag,
        position: [tag.lng, tag.lat] as [number, number],
      })),
    [tags],
  )

  const aristaData: ArcDatum[] = useMemo(() => {
    const out: ArcDatum[] = []
    for (const flow of flows) {
      if (
        flow.from_lat == null ||
        flow.from_lng == null ||
        flow.to_lat == null ||
        flow.to_lng == null
      ) {
        continue
      }
      const isArista = flow.id.startsWith('ama-flow-arista-')
      if (isArista && !isOn(aristas)) continue
      if (!isArista && !isOn(amazona)) continue
      out.push({
        from: [flow.from_lng, flow.from_lat],
        to: [flow.to_lng, flow.to_lat],
        label: flow.notes || `${flow.from_name} → ${flow.to_name}`,
        width: isArista ? 3.2 : 1.2,
      })
    }
    return out
  }, [flows, aristas, amazona])

  const deckLayers = useMemo(() => {
    const list = []
    if (isOn(h3) || isOn(occupancyLayer) || isOn(chronos)) {
      list.push(
        new H3HexagonLayer<HexDatum>({
          id: 'panal',
          data: hexData,
          extruded: true,
          pickable: true,
          filled: true,
          highPrecision: true,
          opacity: opacityOf(h3, 0.7),
          elevationScale: 70,
          getHexagon: (d) => d.hex,
          getFillColor: (d) => d.color,
          getElevation: (d) => d.elevation,
          updateTriggers: {
            getFillColor: hexData,
            getElevation: hexData,
          },
        }),
      )
    }
    if (radarData.length > 0) {
      list.push(
        new H3HexagonLayer<HexDatum>({
          id: 'radar',
          data: radarData,
          extruded: true,
          pickable: false,
          filled: true,
          highPrecision: true,
          opacity: 0.45,
          elevationScale: 40,
          getHexagon: (d) => d.hex,
          getFillColor: (d) => d.color,
          getElevation: (d) => d.elevation,
        }),
      )
    }
    if (isOn(aristas) || isOn(amazona)) {
      list.push(
        new ArcLayer<ArcDatum>({
          id: 'aristas',
          data: aristaData,
          pickable: false,
          getSourcePosition: (d) => d.from,
          getTargetPosition: (d) => d.to,
          getSourceColor: [255, 176, 0, 200],
          getTargetColor: [0, 200, 210, 200],
          getWidth: (d) => d.width,
          getHeight: 0.45,
          opacity: opacityOf(aristas, 0.9),
        }),
      )
    }
    if (isOn(fisico) || isOn(amazona)) {
      list.push(
        new ScatterplotLayer<PlaceDatum>({
          id: 'zonas',
          data: placeData,
          pickable: true,
          opacity: opacityOf(fisico, 1),
          radiusMinPixels: 4,
          radiusMaxPixels: 22,
          getPosition: (d) => d.position,
          getRadius: (d) => {
            if (d.place.role === 'nucleo') return 140
            if (d.place.role === 'sector') return 110
            if (d.place.role === 'ruta') return 90
            return 55
          },
          getFillColor: (d) =>
            d.id === selectedPlaceId
              ? [255, 220, 120, 255]
              : roleColor(d.place.role),
          getLineColor: [8, 10, 13, 220],
          lineWidthMinPixels: 1,
          stroked: true,
          updateTriggers: { getFillColor: selectedPlaceId },
        }),
      )
    }
    if (isOn(tagsLayer)) {
      list.push(
        new ScatterplotLayer<TagDatum>({
          id: 'tags',
          data: tagData,
          pickable: true,
          opacity: opacityOf(tagsLayer, 1),
          radiusMinPixels: 5,
          getPosition: (d) => d.position,
          getRadius: 40,
          getFillColor: (d) =>
            d.id === selectedTagId ? [255, 90, 70, 255] : [255, 120, 70, 230],
          stroked: true,
          getLineColor: [255, 220, 160, 255],
          lineWidthMinPixels: 1,
          updateTriggers: { getFillColor: selectedTagId },
        }),
      )
    }
    return list
  }, [
    h3,
    occupancyLayer,
    chronos,
    hexData,
    radarData,
    aristas,
    amazona,
    aristaData,
    fisico,
    placeData,
    selectedPlaceId,
    tagsLayer,
    tagData,
    selectedTagId,
  ])

  function handleDeckClick(info: PickingInfo) {
    const obj = info.object as
      | PlaceDatum
      | HexDatum
      | TagDatum
      | undefined
    if (obj?.kind === 'place') {
      onPick({ type: 'place', place: obj.place })
      return
    }
    if (obj?.kind === 'tag') {
      onPick({ type: 'tag', tag: obj.tag })
      return
    }
    if (obj?.kind === 'hex') {
      onPick({ type: 'hex', hex: obj.hex, place: obj.place })
      return
    }
    const coord = info.coordinate
    if (coord && coord.length >= 2) {
      onPick({ type: 'empty', lng: coord[0], lat: coord[1] })
    }
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
        reuseMaps
        maxPitch={70}
      >
        <NavigationControl position="top-right" visualizePitch />
        <DeckGLOverlay
          interleaved={false}
          layers={deckLayers}
          pickingRadius={8}
          getCursor={({ isHovering, isDragging }) =>
            isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
          }
          getTooltip={({ object }) => {
            const obj = object as { label?: string } | null
            if (!obj?.label) return null
            return {
              text: obj.label,
              style: {
                backgroundColor: '#080a0d',
                color: '#ffb000',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '11px',
                border: '1px solid #ffb00055',
              },
            }
          }}
          onClick={handleDeckClick}
        />
      </MapLibreMap>
    </div>
  )
}
