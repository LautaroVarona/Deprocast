import { describe, expect, it } from 'vitest'
import { assertZipBudget, ZIP_LIMITS } from '../server/services/zipLimits.ts'

describe('assertZipBudget', () => {
  it('rechaza ratio absurdo', () => {
    expect(() =>
      assertZipBudget([
        {
          name: 'bomb.bin',
          compactSize: 100,
          uncompSize: 2 * 1024 * 1024 * ZIP_LIMITS.maxRatio,
        },
      ]),
    ).toThrow(/ratio/)
  })

  it('rechaza archivo demasiado grande', () => {
    expect(() =>
      assertZipBudget([
        {
          name: 'huge.bin',
          compactSize: ZIP_LIMITS.maxFileUncomp,
          uncompSize: ZIP_LIMITS.maxFileUncomp + 1,
        },
      ]),
    ).toThrow(/grande/)
  })

  it('acepta backup chico', () => {
    expect(() =>
      assertZipBudget([
        { name: 'dump.json', compactSize: 50, uncompSize: 200 },
      ]),
    ).not.toThrow()
  })
})
