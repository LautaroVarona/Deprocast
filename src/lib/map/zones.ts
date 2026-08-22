export const PATERNA_LAT = 39.5026
export const PATERNA_LNG = -0.4415

export const PATERNA_VIEW = {
  longitude: PATERNA_LNG,
  latitude: PATERNA_LAT,
  zoom: 13,
  pitch: 45,
  bearing: 0,
}

export const H3_RES_URBAN = 8
export const H3_RES_REGIONAL = 7

export const CARTO_DARK_STYLE = {
  version: 8 as const,
  name: 'Carto Dark Matter',
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [{ id: 'carto-dark', type: 'raster' as const, source: 'carto' }],
}

export function resolutionForZoom(zoom: number): number {
  return zoom >= 12 ? H3_RES_URBAN : H3_RES_REGIONAL
}

export function moonPhase(date = new Date()): {
  phase: number
  illumination: number
  label: string
} {
  const synodic = 29.53058867
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0)
  const days = (date.getTime() - knownNew) / 86400000
  const phase = (((days % synodic) + synodic) % synodic) / synodic
  const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase))
  let label = 'Creciente'
  if (phase < 0.03 || phase > 0.97) label = 'Luna nueva'
  else if (phase >= 0.22 && phase <= 0.28) label = 'Cuarto creciente'
  else if (phase >= 0.47 && phase <= 0.53) label = 'Luna llena'
  else if (phase >= 0.72 && phase <= 0.78) label = 'Cuarto menguante'
  else if (phase > 0.53) label = 'Menguante'
  return { phase, illumination, label }
}

export type MapCamera = {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
}
