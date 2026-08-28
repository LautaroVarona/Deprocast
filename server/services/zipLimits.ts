export const ZIP_LIMITS = {
  maxEntries: 20_000,
  maxFileUncomp: 512 * 1024 * 1024,
  maxTotalUncomp: 4 * 1024 * 1024 * 1024,
  maxRatio: 100,
  maxUploadBytes: 4 * 1024 * 1024 * 1024,
}

export function assertZipBudget(
  entries: Array<{ name: string; compactSize: number; uncompSize: number }>,
): void {
  if (entries.length > ZIP_LIMITS.maxEntries) {
    throw new Error(`ZIP con demasiadas entradas (${entries.length})`)
  }
  let total = 0
  for (const e of entries) {
    if (e.uncompSize < 0 || e.compactSize < 0) {
      throw new Error(`ZIP tamaño inválido en ${e.name}`)
    }
    if (e.uncompSize > ZIP_LIMITS.maxFileUncomp) {
      throw new Error(`ZIP archivo demasiado grande: ${e.name}`)
    }
    if (
      e.compactSize > 0 &&
      e.uncompSize > 1024 * 1024 &&
      e.uncompSize / e.compactSize > ZIP_LIMITS.maxRatio
    ) {
      throw new Error(`ZIP ratio de descompresión excedido: ${e.name}`)
    }
    total += e.uncompSize
    if (total > ZIP_LIMITS.maxTotalUncomp) {
      throw new Error('ZIP descomprimido excede el máximo permitido')
    }
  }
}
