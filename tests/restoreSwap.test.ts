import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { swapPath, swapSqliteFile, rmQuiet } from '../server/services/restoreSwap.ts'

describe('restoreSwap', () => {
  it('swapPath mueve staging sobre live y deja prev', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-swap-'))
    const live = path.join(root, 'vault')
    const staging = path.join(root, 'vault.staging')
    fs.mkdirSync(live)
    fs.writeFileSync(path.join(live, 'old.txt'), 'old')
    fs.mkdirSync(staging)
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new')
    swapPath(staging, live)
    expect(fs.existsSync(path.join(live, 'new.txt'))).toBe(true)
    expect(fs.existsSync(path.join(`${live}.prev`, 'old.txt'))).toBe(true)
    rmQuiet(root)
  })

  it('swapSqliteFile reemplaza el archivo vivo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-dbs-'))
    const live = path.join(root, 'deprocast.db')
    const staging = path.join(root, 'deprocast.restore.db')
    fs.writeFileSync(live, 'LIVE')
    fs.writeFileSync(staging, 'STAGING')
    swapSqliteFile(staging, live)
    expect(fs.readFileSync(live, 'utf8')).toBe('STAGING')
    expect(fs.readFileSync(`${live}.prev`, 'utf8')).toBe('LIVE')
    rmQuiet(root)
  })
})
