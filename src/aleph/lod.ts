import type { LodBand } from './types'

export const MIN_CAMERA_DISTANCE = 0.001
export const MAX_CAMERA_DISTANCE = 80000

export const LOD_RANGES: Array<{
  band: LodBand
  min: number
  max: number
  midpoint: number
  label: string
  hint: string
}> = [
  {
    band: 'cosmic',
    min: 8000,
    max: Number.POSITIVE_INFINITY,
    midpoint: 22000,
    label: 'Cósmico',
    hint: 'estrellas · Mercurio · Tierra',
  },
  {
    band: 'planet',
    min: 800,
    max: 8000,
    midpoint: 2200,
    label: 'Planeta',
    hint: 'globos',
  },
  {
    band: 'landscape',
    min: 80,
    max: 800,
    midpoint: 220,
    label: 'Paisaje',
    hint: 'ríos · bosques · caminos',
  },
  {
    band: 'body',
    min: 8,
    max: 80,
    midpoint: 28,
    label: 'Cuerpo',
    hint: 'figura humana',
  },
  {
    band: 'organ',
    min: 0.8,
    max: 8,
    midpoint: 3.2,
    label: 'Órgano',
    hint: 'corazón · cerebro · glándulas',
  },
  {
    band: 'tissue',
    min: 0.08,
    max: 0.8,
    midpoint: 0.28,
    label: 'Tejido',
    hint: 'neuronas · vasos',
  },
  {
    band: 'micro',
    min: 0,
    max: 0.08,
    midpoint: 0.028,
    label: 'Micro',
    hint: 'células · bacterias',
  },
]

export const DEFAULT_CAMERA_DISTANCE = 28

export function bandFromDistance(distance: number): LodBand {
  for (const range of LOD_RANGES) {
    if (distance >= range.min && distance < range.max) return range.band
  }
  return 'cosmic'
}

export function lodMeta(band: LodBand) {
  return LOD_RANGES.find((r) => r.band === band) ?? LOD_RANGES[0]
}

export function clampCameraDistance(distance: number): number {
  if (!Number.isFinite(distance)) return DEFAULT_CAMERA_DISTANCE
  return Math.min(MAX_CAMERA_DISTANCE, Math.max(MIN_CAMERA_DISTANCE, distance))
}

export function formatScale(distance: number, log10: number): string {
  const mag = Number.isFinite(log10)
    ? log10
    : Math.log10(Math.max(distance, 1e-6))
  const distLabel =
    distance >= 1000 || distance < 1
      ? distance.toExponential(1)
      : distance.toFixed(1)
  return `10^${mag.toFixed(2)} · ${distLabel} u`
}
