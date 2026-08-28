export type DeproIdaStage = 'investigacion' | 'desarrollo' | 'aplicacion'

export const IDA_MATRIX_ID = 'ama-matrix-ida'
export const IDA_PROCESS_LIST_ID = 'ama-lista6-ida-proceso'
export const IDA_DOMAIN_LIST_ID = 'ama-lista6-ida-dominio'

export const IDA_PROCESS_IDS = [
  'ama-item-ida-ingesta',
  'ama-item-ida-criba',
  'ama-item-ida-quantomo',
  'ama-item-ida-grafo',
  'ama-item-ida-entrenamiento',
  'ama-item-ida-obra',
] as const

export const IDA_DOMAIN_IDS = [
  'ama-item-ida-biologico',
  'ama-item-ida-sistemico',
  'ama-item-ida-hermetico',
  'ama-item-ida-normativo',
  'ama-item-ida-narrativo',
  'ama-item-ida-comunitario',
] as const

export type IdaProcessId = (typeof IDA_PROCESS_IDS)[number]
export type IdaDomainId = (typeof IDA_DOMAIN_IDS)[number]

function processIndex(rowItemId: string | null | undefined): number {
  if (!rowItemId) return -1
  return (IDA_PROCESS_IDS as readonly string[]).indexOf(rowItemId)
}

export function stageForProcessRow(
  rowItemId: string | null | undefined,
): DeproIdaStage {
  const i = processIndex(rowItemId)
  if (i < 0) return 'investigacion'
  if (i <= 2) return 'investigacion'
  if (i <= 4) return 'desarrollo'
  return 'aplicacion'
}

export function isCoagulaProcessRow(
  rowItemId: string | null | undefined,
): boolean {
  return processIndex(rowItemId) >= 3
}

export function suggestedProcessRow(
  stage: DeproIdaStage,
  currentRow: string | null | undefined,
): IdaProcessId {
  const cur = processIndex(currentRow)
  if (stage === 'investigacion') {
    if (cur >= 0 && cur <= 2) return IDA_PROCESS_IDS[cur]!
    return IDA_PROCESS_IDS[0]
  }
  if (stage === 'desarrollo') {
    if (cur >= 3 && cur <= 4) return IDA_PROCESS_IDS[cur]!
    return IDA_PROCESS_IDS[3]
  }
  return IDA_PROCESS_IDS[5]
}
