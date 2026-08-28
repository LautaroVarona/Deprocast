import fs from 'node:fs'
import path from 'node:path'

export const RESTORE_DB_PATH = path.resolve(
  process.cwd(),
  'data',
  'deprocast.restore.db',
)
export const VAULT_STAGING_DIR = path.resolve(process.cwd(), 'vault.staging')
export const FEEDBACK_STAGING_DIR = path.resolve(
  process.cwd(),
  'feedback.staging',
)

export function rmQuiet(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

export function sqliteSidecars(dbPath: string): string[] {
  return [`${dbPath}-wal`, `${dbPath}-shm`]
}

export function rmSqliteBundle(dbPath: string): void {
  rmQuiet(dbPath)
  for (const s of sqliteSidecars(dbPath)) rmQuiet(s)
}

/**
 * Renombra `from` sobre `to`. Si `to` existía, queda en `to.prev`.
 * Si el segundo rename falla, intenta devolver `to.prev` a `to`.
 */
export function swapPath(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    throw new Error(`No existe el origen para swap: ${from}`)
  }
  const prev = `${to}.prev`
  rmQuiet(prev)
  if (fs.existsSync(to)) {
    fs.renameSync(to, prev)
  }
  try {
    fs.renameSync(from, to)
  } catch (err) {
    if (fs.existsSync(prev) && !fs.existsSync(to)) {
      try {
        fs.renameSync(prev, to)
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

export function swapSqliteFile(stagingPath: string, livePath: string): void {
  const livePrev = `${livePath}.prev`
  rmSqliteBundle(livePrev)
  if (fs.existsSync(livePath)) {
    fs.renameSync(livePath, livePrev)
    for (const s of sqliteSidecars(livePath)) {
      if (fs.existsSync(s)) {
        fs.renameSync(s, `${livePrev}${s.slice(livePath.length)}`)
      }
    }
  }
  try {
    fs.renameSync(stagingPath, livePath)
    for (const s of sqliteSidecars(stagingPath)) {
      if (fs.existsSync(s)) {
        fs.renameSync(s, `${livePath}${s.slice(stagingPath.length)}`)
      }
    }
  } catch (err) {
    if (fs.existsSync(livePrev) && !fs.existsSync(livePath)) {
      try {
        fs.renameSync(livePrev, livePath)
        for (const s of sqliteSidecars(livePrev)) {
          if (fs.existsSync(s)) {
            fs.renameSync(s, `${livePath}${s.slice(livePrev.length)}`)
          }
        }
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

export function cleanupRestoreStaging(): void {
  rmSqliteBundle(RESTORE_DB_PATH)
  rmQuiet(VAULT_STAGING_DIR)
  rmQuiet(FEEDBACK_STAGING_DIR)
}
