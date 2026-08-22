import type { AmaCycleSlot, AmaListKind, AmaPlaceKind } from '../../types'

export const KIND_LABEL: Record<AmaListKind, string> = {
  tridente: 'Tridente',
  lista6: 'Lista6',
  base12: 'Base 12',
  base22: 'Base 22',
  base72: 'Base 72',
}

export const KIND_SIZE: Record<AmaListKind, number> = {
  tridente: 3,
  lista6: 6,
  base12: 12,
  base22: 22,
  base72: 72,
}

export const PLACE_KIND_LABEL: Record<AmaPlaceKind, string> = {
  lugar: 'Lugar',
  enclave: 'Enclave',
  ruta: 'Ruta',
  region: 'Región',
}

export const CYCLE_LABEL: Record<AmaCycleSlot, string> = {
  ayer: 'Ayer',
  hoy: 'Hoy',
  manana: 'Mañana',
}

export const CYCLE_SLOTS: AmaCycleSlot[] = ['ayer', 'hoy', 'manana']

export const TITLE_AXIS = [
  'Lista AmazonA',
  'Lista6 filas',
  'Lista6 columnas',
] as const

export const VALENCIA_CENTER: [number, number] = [39.47, -0.4]
