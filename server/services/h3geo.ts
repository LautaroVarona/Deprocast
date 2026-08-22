import { cellToParent, gridDisk, isValidCell, latLngToCell } from 'h3-js'

export const H3_RES_URBAN = 8
export const H3_RES_REGIONAL = 7

export function cellAt(
  lat: number,
  lng: number,
  res = H3_RES_URBAN,
): string {
  return latLngToCell(lat, lng, res)
}

export function parentCell(hex: string, res = H3_RES_REGIONAL): string | null {
  if (!isValidCell(hex)) return null
  try {
    return cellToParent(hex, res)
  } catch {
    return null
  }
}

export function diskAround(
  lat: number,
  lng: number,
  res: number,
  k: number,
): { cell: string; disk: string[] } {
  const safeRes = res === H3_RES_REGIONAL ? H3_RES_REGIONAL : H3_RES_URBAN
  const safeK = Math.max(0, Math.min(4, Math.floor(k)))
  const cell = latLngToCell(lat, lng, safeRes)
  return { cell, disk: gridDisk(cell, safeK) }
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
