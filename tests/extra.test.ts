import { describe, expect, it } from 'vitest'
import { buildAcyclicForest, collectDescendantIds } from '../server/services/descendants.ts'
import { isUnsafeRelative } from '../server/services/paths.ts'
import { parseInstagramUrl } from '../server/services/urlSafety.ts'
import { csvEscape } from '../server/services/csvSafe.ts'
import { parseBackupFormat, parseConfirmDestroy } from '../shared/httpSchemas.ts'
import { ZIP_LIMITS, assertZipBudget } from '../server/services/zipLimits.ts'
import { planIngestFiles } from '../server/services/ingestBatch.ts'

describe('httpSchemas', () => {
  it('parseBackupFormat', () => {
    expect(parseBackupFormat('ZIP')).toBe('zip')
    expect(() => parseBackupFormat('exe')).toThrow()
  })
  it('parseConfirmDestroy', () => {
    expect(parseConfirmDestroy('DESTRUIR')).toBe(true)
    expect(parseConfirmDestroy('no')).toBe(false)
  })
})

describe('paths extra', () => {
  it('rechaza UNC y tilde', () => {
    expect(isUnsafeRelative('\\\\server\\share')).toBe(true)
    expect(isUnsafeRelative('~/secret')).toBe(true)
    expect(isUnsafeRelative('ok/file.txt')).toBe(false)
  })
})

describe('instagram extra', () => {
  it('www.instagram.com ok, puerto no', () => {
    expect(parseInstagramUrl('https://www.instagram.com/p/x').ok).toBe(true)
    expect(parseInstagramUrl('https://instagram.com:8443/p/x').ok).toBe(false)
  })
})

describe('csv extra', () => {
  it('quote commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
})

describe('zip extra', () => {
  it('demasiadas entradas', () => {
    const entries = Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `f${i}`,
      compactSize: 1,
      uncompSize: 1,
    }))
    expect(() => assertZipBudget(entries)).toThrow(/entradas/)
  })
})

describe('forest', () => {
  it('corta ciclos', () => {
    const nodes = [
      { id: 'a', parent_id: null as string | null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
    ]
    const tree = buildAcyclicForest(nodes)
    expect(tree.length).toBe(1)
    expect(collectDescendantIds('a', (id) =>
      id === 'a' ? ['b'] : id === 'b' ? ['c'] : [],
    )).toEqual(['b', 'c'])
  })
})

describe('ingest batch', () => {
  it('mismo batch_id no colapsa archivos distintos', () => {
    const plan = planIngestFiles(
      [
        { name: 'a.m4a', size: 10 },
        { name: 'b.m4a', size: 20 },
        { name: 'c.m4a', size: 30 },
      ],
      [{ name: 'a.m4a', size: 10 }],
    )
    expect(plan.map((p) => p.action)).toEqual(['reuse', 'create', 'create'])
  })

  it('retry del mismo archivo+tamaño es reuse', () => {
    const plan = planIngestFiles(
      [{ name: 'a.m4a', size: 10 }],
      [{ name: 'a.m4a', size: 10 }],
    )
    expect(plan[0]?.action).toBe('reuse')
  })

  it('mismo nombre distinto tamaño se crea', () => {
    const plan = planIngestFiles(
      [{ name: 'audio.m4a', size: 99 }],
      [{ name: 'audio.m4a', size: 10 }],
    )
    expect(plan[0]?.action).toBe('create')
  })
})
