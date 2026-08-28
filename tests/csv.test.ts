import { describe, expect, it } from 'vitest'
import { csvEscape } from '../server/services/csvSafe.ts'

describe('csvEscape', () => {
  it('neutraliza fórmulas', () => {
    for (const p of ['=CMD()', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(csvEscape(p).startsWith("'")).toBe(true)
    }
  })

  it('deja texto normal', () => {
    expect(csvEscape('hola')).toBe('hola')
  })
})
