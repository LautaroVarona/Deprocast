/** Status que el drain puede tomar sin HITL. */
export const DRAINABLE_STATUSES = ['queued', 'pending_extract'] as const

/** Une ids pedidos (voto, ingest) con el resto drenable, sin duplicar. */
export function mergeEnqueueIds(
  requested: string[] | undefined,
  drainable: string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  if (requested) {
    for (const id of requested) add(id)
  }
  for (const id of drainable) add(id)
  return out
}

/**
 * Trabajo que quedó al cerrar un drain: leftover en memoria, extracts
 * votados, y queued nuevos. No reintenta los que acabamos de fallar ni
 * los queued ya intentados en este ciclo (evita bucle).
 */
export function continueDrainIds(opts: {
  leftoverQueue: string[]
  pendingExtract: string[]
  queued: string[]
  attempted: string[]
  failed: string[]
}): string[] {
  const failed = new Set(opts.failed)
  const attempted = new Set(opts.attempted)
  const leftover = opts.leftoverQueue.filter((id) => !failed.has(id))
  const extract = opts.pendingExtract.filter((id) => !failed.has(id))
  const freshQueued = opts.queued.filter(
    (id) => !attempted.has(id) && !failed.has(id),
  )
  return mergeEnqueueIds(leftover, [...extract, ...freshQueued])
}
