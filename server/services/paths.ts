import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/
const UNC = /^[\\/]{2}/

export const VAULT_DIR = path.resolve(process.cwd(), 'vault')
export const FEEDBACK_DIR = path.resolve(process.cwd(), 'feedback')

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathEscapeError'
  }
}

export function isUnsafeRelative(rel: string): boolean {
  const raw = String(rel ?? '')
  if (!raw || raw === '.' || raw === '..') return true
  if (path.isAbsolute(raw)) return true
  if (WINDOWS_ABS.test(raw) || UNC.test(raw)) return true
  const n = raw.replaceAll('\\', '/')
  if (n.startsWith('/') || n.startsWith('~/')) return true
  const parts = n.split('/')
  if (parts.some((p) => p === '..' || p === '')) return true
  return false
}

function containedPrefix(root: string): { base: string; prefix: string } {
  const base = path.resolve(root)
  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  return { base, prefix }
}

function assertInside(root: string, abs: string, label: string): void {
  const { base, prefix } = containedPrefix(root)
  const resolved = path.resolve(abs)
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new PathEscapeError(`Ruta fuera de ${label}: ${abs}`)
  }
}

/**
 * Resuelve `relative` dentro de `root`. Rechaza absolutos, `..`, drives
 * Windows, UNC y escape por symlink.
 */
export function resolveContained(root: string, relative: string): string {
  if (isUnsafeRelative(relative)) {
    throw new PathEscapeError(`Ruta no contenida: ${relative}`)
  }
  const { base, prefix } = containedPrefix(root)
  const abs = path.resolve(base, relative.replaceAll('\\', '/'))
  if (abs !== base && !abs.startsWith(prefix)) {
    throw new PathEscapeError(`Ruta fuera de raíz: ${relative}`)
  }
  try {
    if (fs.existsSync(abs)) {
      const real = fs.realpathSync(abs)
      const realBase = fs.existsSync(base) ? fs.realpathSync(base) : base
      assertInside(realBase, real, 'raíz (symlink)')
      return real
    }
    const parent = path.dirname(abs)
    if (fs.existsSync(parent)) {
      const realParent = fs.realpathSync(parent)
      const realBase = fs.existsSync(base) ? fs.realpathSync(base) : base
      assertInside(realBase, path.join(realParent, path.basename(abs)), 'raíz')
    }
  } catch (err) {
    if (err instanceof PathEscapeError) throw err
  }
  return abs
}

const ID_RE = /^[a-zA-Z0-9._-]+$/

export function vaultEntryDir(entryId: string): string {
  if (!ID_RE.test(entryId)) {
    throw new PathEscapeError('entryId inválido')
  }
  return resolveContained(VAULT_DIR, entryId)
}

export function notebookSourceDir(notebookId: string, sourceId: string): string {
  if (!ID_RE.test(notebookId) || !ID_RE.test(sourceId)) {
    throw new PathEscapeError('id de cuaderno/fuente inválido')
  }
  return resolveContained(VAULT_DIR, path.posix.join('notebooks', notebookId, 'sources', sourceId))
}

export function toPosixRelative(abs: string, root = process.cwd()): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

export function hashFileSha256(abs: string): string {
  const h = createHash('sha256')
  h.update(fs.readFileSync(abs))
  return h.digest('hex')
}

export function fileFingerprint(abs: string): { size: number; sha256: string } {
  const st = fs.statSync(abs)
  return { size: st.size, sha256: hashFileSha256(abs) }
}
