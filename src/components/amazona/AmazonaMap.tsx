import { useMemo } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet'
import * as L from 'leaflet'
import type { AmaFlow, AmaPlace } from '../../types'
import { VALENCIA_CENTER } from './labels'

type Props = {
  places: AmaPlace[]
  flows: AmaFlow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onMapClick: (lat: number, lng: number) => void
}

const pin = L.divIcon({
  className: 'ama-pin',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const pinActive = L.divIcon({
  className: 'ama-pin is-active',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function ClickCatch({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function AmazonaMap({
  places,
  flows,
  selectedId,
  onSelect,
  onMapClick,
}: Props) {
  const lines = useMemo(() => {
    const map = new Map<
      string,
      { from: [number, number]; to: [number, number]; n: number }
    >()
    for (const flow of flows) {
      if (
        flow.from_lat == null ||
        flow.from_lng == null ||
        flow.to_lat == null ||
        flow.to_lng == null
      ) {
        continue
      }
      const key = `${flow.from_place_id}|${flow.to_place_id}`
      const prev = map.get(key)
      if (prev) {
        prev.n += 1
      } else {
        map.set(key, {
          from: [flow.from_lat, flow.from_lng],
          to: [flow.to_lat, flow.to_lng],
          n: 1,
        })
      }
    }
    return [...map.entries()].map(([key, value]) => ({ key, ...value }))
  }, [flows])

  const pinned = places.filter((p) => p.lat != null && p.lng != null)

  return (
    <MapContainer
      center={VALENCIA_CENTER}
      zoom={10}
      className="ama-leaflet"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; OpenStreetMap &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ClickCatch onMapClick={onMapClick} />
      {lines.map((line) => (
        <Polyline
          key={line.key}
          positions={[line.from, line.to]}
          pathOptions={{
            color: '#c4a35a',
            weight: Math.min(6, 1.5 + line.n),
            opacity: 0.75,
          }}
        />
      ))}
      {pinned.map((place) => (
        <Marker
          key={place.id}
          position={[place.lat as number, place.lng as number]}
          icon={place.id === selectedId ? pinActive : pin}
          eventHandlers={{ click: () => onSelect(place.id) }}
        >
          <Popup>
            <strong>{place.name}</strong>
            <br />
            {place.kind}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
