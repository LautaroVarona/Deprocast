export type BackupFormat = 'json' | 'csv' | 'xml' | 'zip'

export function parseBackupFormat(raw: unknown): BackupFormat {
  const s = String(raw ?? 'json').toLowerCase()
  if (s === 'json' || s === 'csv' || s === 'xml' || s === 'zip') return s
  throw new Error('format debe ser json, csv, xml o zip')
}

export function parseConfirmDestroy(raw: unknown): boolean {
  return String(raw ?? '').trim() === 'DESTRUIR'
}
