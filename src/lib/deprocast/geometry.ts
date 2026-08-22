import { amazonaCoords } from '../calendar/engine'
import type {
  DeproCma,
  DeproDomainId,
  DeproIpo,
  DeproPowerGeometry,
  DeproTypology,
} from '../../types'

export const DEPRO_DOMAIN_IDS: DeproDomainId[] = [
  'captura',
  'criba',
  'biblioteca',
  'memoria',
  'territorio',
  'finanzas',
  'derecho',
  'vitalidad',
]

export const DEPRO_DOMAIN_META: Record<
  DeproDomainId,
  { index: number; label: string; origin: string }
> = {
  captura: { index: 0, label: 'Captura', origin: 'Zona franca, audio, blobs' },
  criba: { index: 1, label: 'Criba', origin: 'Aduana, bookmarks, HITL' },
  biblioteca: { index: 2, label: 'Biblioteca', origin: 'Cuadernos, OCR, visión' },
  memoria: { index: 3, label: 'Memoria', origin: 'Quántomos, chats, NER, grafo' },
  territorio: { index: 4, label: 'Territorio', origin: 'Calendario, mapa, AmazonA' },
  finanzas: { index: 5, label: 'Finanzas', origin: 'nuevo' },
  derecho: { index: 6, label: 'Derecho', origin: 'nuevo' },
  vitalidad: {
    index: 7,
    label: 'Vitalidad',
    origin: 'Salud, deporte, nutrición',
  },
}

export const DEPRO_IPO: DeproIpo[] = ['input', 'procesamiento', 'output']
export const DEPRO_CMA: DeproCma[] = ['cuerpo', 'mente', 'alma']

export const IPO_LABEL: Record<DeproIpo, string> = {
  input: 'Input',
  procesamiento: 'Procesamiento',
  output: 'Output',
}

export const CMA_LABEL: Record<DeproCma, string> = {
  cuerpo: 'Cuerpo',
  mente: 'Mente',
  alma: 'Alma',
}

export const TYPOLOGY_LABEL: Record<DeproTypology, string> = {
  vectorizador: 'Vectorizador',
  clasificador: 'Clasificador',
  crawler: 'Crawler',
  generativo: 'Generativo',
  ejecutivo: 'Ejecutivo',
  omnivoro: 'Omnívoro',
}

export const TYPOLOGIES: DeproTypology[] = [
  'vectorizador',
  'clasificador',
  'crawler',
  'generativo',
  'ejecutivo',
  'omnivoro',
]

export const OFICIO_LABELS: string[] = DEPRO_IPO.flatMap((ipo) =>
  DEPRO_CMA.map((cma) => `${IPO_LABEL[ipo]} · ${CMA_LABEL[cma]}`),
)

export function clampPowerIndex(index: number): number {
  return ((index % 72) + 72) % 72
}

/** Número visible 01–72. El índice interno sigue siendo 0–71. */
export function powerNumber(index: number): string {
  return String(clampPowerIndex(index) + 1).padStart(2, '0')
}

export function powerGeometry(index: number): DeproPowerGeometry {
  const i = clampPowerIndex(index)
  const domainIndex = Math.floor(i / 9)
  const oficioIndex = i % 9
  const ipo = DEPRO_IPO[Math.floor(oficioIndex / 3)]
  const cma = DEPRO_CMA[oficioIndex % 3]
  const domain = DEPRO_DOMAIN_IDS[domainIndex]
  const amazona = amazonaCoords(i)
  const typology = TYPOLOGIES[(domainIndex + oficioIndex) % 6]
  return {
    index: i,
    domain,
    domainIndex,
    oficioIndex,
    ipo,
    cma,
    typology,
    amazona,
  }
}

export function oficioLabel(geo: DeproPowerGeometry): string {
  return `${IPO_LABEL[geo.ipo]} · ${CMA_LABEL[geo.cma]}`
}
