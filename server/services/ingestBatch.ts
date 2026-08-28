/**
 * Idempotencia de ingesta: por archivo dentro del lote, no por batch_id entero.
 *
 * Zona franca y Calendario suben 1 archivo por request con el mismo batch_id
 * (tags/nota compartidos). Tratar «ya hay filas con este batch_id» como retry
 * del lote completo descartaba los audios 2–N y borraba el temp.
 */

export type IngestFileRef = { name: string; size: number }

export type IngestFilePlan = IngestFileRef & { action: 'create' | 'reuse' }

export function ingestFileKey(file: IngestFileRef): string {
  return `${file.name}\0${file.size}`
}

export function decodeMulterOriginalName(originalname: string): string {
  return Buffer.from(originalname, 'latin1').toString('utf8')
}

export function planIngestFiles(
  incoming: IngestFileRef[],
  alreadyInBatch: IngestFileRef[],
): IngestFilePlan[] {
  const seen = new Set(alreadyInBatch.map(ingestFileKey))
  return incoming.map((file) => {
    const key = ingestFileKey(file)
    if (seen.has(key)) return { ...file, action: 'reuse' }
    seen.add(key)
    return { ...file, action: 'create' }
  })
}
