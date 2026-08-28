import { describe, expect, it } from 'vitest'
import {
  isUnsafeRelative,
  resolveContained,
  PathEscapeError,
} from '../server/services/paths.ts'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

describe('resolveContained', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-vault-'))

  it('rechaza absolutos', () => {
    expect(isUnsafeRelative('/etc/passwd')).toBe(true)
    expect(isUnsafeRelative('C:\\Windows\\System32')).toBe(true)
    expect(() => resolveContained(root, '/tmp/x')).toThrow(PathEscapeError)
  })

  it('rechaza ..', () => {
    expect(isUnsafeRelative('../secret')).toBe(true)
    expect(isUnsafeRelative('vault/../x')).toBe(true)
    expect(() => resolveContained(root, 'a/../../b')).toThrow(PathEscapeError)
  })

  it('acepta relativo canónico', () => {
    const abs = resolveContained(root, 'entry-1/audio.m4a')
    expect(abs.startsWith(root)).toBe(true)
  })
})
