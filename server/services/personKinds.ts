/** Kinds de persona: perfiles maestros vs clasificación en Validador. */

export const PERSON_KINDS = [
  'fisica',
  'juridica',
  'ficticia',
  'ia',
  'abstracta',
  'ruido',
  'geografia',
] as const

/** Solo estos pueden vivir en el roster de perfiles creados. */
export const PROFILE_KINDS = ['fisica', 'juridica', 'ficticia', 'ia'] as const

/**
 * Pueden vivir en la sala de espera como filas de `persons`.
 * Geografía ya no: va a la tabla `geografia`.
 */
export const WAITING_KINDS = [
  'fisica',
  'juridica',
  'ficticia',
  'agrupacion',
] as const

export type PersonKind = (typeof PERSON_KINDS)[number]
export type ProfileKind = (typeof PROFILE_KINDS)[number]
export type WaitingKind = (typeof WAITING_KINDS)[number]

export function normalizePersonKind(raw: unknown): PersonKind {
  const k = String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  if (k === 'agrupacion' || k === 'ficticio') return 'ficticia'
  if (
    k === 'ai' ||
    k === 'ia' ||
    k === 'bot' ||
    k === 'assistant' ||
    k === 'llm' ||
    k.includes('inteligencia')
  ) {
    return 'ia'
  }
  if ((PERSON_KINDS as readonly string[]).includes(k)) {
    return k as PersonKind
  }
  if (
    k.includes('geograf') ||
    k.includes('toponim') ||
    k === 'lugar' ||
    k === 'lugar_geo'
  ) {
    return 'geografia'
  }
  if (k.includes('jurid') || k.includes('empresa') || k.includes('org')) {
    return 'juridica'
  }
  if (k.includes('abstract') || k.includes('concepto')) {
    return 'abstracta'
  }
  if (k.includes('ruido') || k.includes('noise')) {
    return 'ruido'
  }
  return 'fisica'
}

export function isProfileKind(kind: string): kind is ProfileKind {
  return (PROFILE_KINDS as readonly string[]).includes(kind)
}

/** Waiting como persona (no incluye geografia → tabla propia). */
export function isWaitingKind(kind: string): boolean {
  const k = normalizePersonKind(kind)
  return k === 'fisica' || k === 'juridica' || k === 'ficticia'
}

/** Se descartan en el validador (no van a sala). */
export function isDiscardKind(kind: string): boolean {
  const k = normalizePersonKind(kind)
  return k === 'abstracta' || k === 'ruido'
}

export function isGeografiaKind(kind: string): boolean {
  return normalizePersonKind(kind) === 'geografia'
}
