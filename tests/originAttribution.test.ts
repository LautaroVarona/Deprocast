import { describe, expect, it } from 'vitest'
import {
  FALLBACK_TIMESTAMP,
  parseFromFilename,
  resolveOriginAttribution,
} from '../server/services/originAttribution.ts'

function localParts(iso: string | null) {
  expect(iso).toBeTruthy()
  const d = new Date(iso!)
  return {
    y: d.getFullYear(),
    mo: d.getMonth() + 1,
    d: d.getDate(),
    h: d.getHours(),
    mi: d.getMinutes(),
    s: d.getSeconds(),
  }
}

describe('parseFromFilename', () => {
  it('reconoce grabadora Android YYYYMMDD_HHMMSS', () => {
    expect(localParts(parseFromFilename('20260901_183207.m4a'))).toEqual({
      y: 2026,
      mo: 9,
      d: 1,
      h: 18,
      mi: 32,
      s: 7,
    })
  })

  it('reconoce el mismo patrón con sufijo de split', () => {
    expect(
      localParts(parseFromFilename('20260901_183207.m4a · parte 1')),
    ).toEqual({
      y: 2026,
      mo: 9,
      d: 1,
      h: 18,
      mi: 32,
      s: 7,
    })
  })

  it('reconoce variantes compactas y separadas', () => {
    expect(localParts(parseFromFilename('20260901-183207.m4a')).h).toBe(18)
    expect(localParts(parseFromFilename('20260901183207.m4a')).mi).toBe(32)
    expect(localParts(parseFromFilename('2026-09-01_18-32-07.m4a')).s).toBe(7)
    expect(localParts(parseFromFilename('2026-09-01 18:32:07.m4a')).d).toBe(1)
  })

  it('WhatsApp AUD-YYYYMMDD sin hora → mediodía local', () => {
    expect(localParts(parseFromFilename('AUD-20260901-WA0001.opus'))).toEqual({
      y: 2026,
      mo: 9,
      d: 1,
      h: 12,
      mi: 0,
      s: 0,
    })
  })

  it('sigue reconociendo Voice Memos ES', () => {
    const p = localParts(parseFromFilename('3 ago, 14.18_.m4a'))
    expect(p).toMatchObject({ mo: 8, d: 3, h: 14, mi: 18 })
    expect(localParts(parseFromFilename('03-ago-2026 14.18.m4a')).y).toBe(2026)
  })

  it('rechaza fechas civiles imposibles', () => {
    expect(parseFromFilename('20261301_183207.m4a')).toBeNull()
    expect(parseFromFilename('20260932_183207.m4a')).toBeNull()
    expect(parseFromFilename('20260901_256099.m4a')).toBeNull()
  })
})

describe('resolveOriginAttribution', () => {
  it('prioriza filename compacto sobre fallback 3 mar', () => {
    const r = resolveOriginAttribution({ filename: '20260901_183207.m4a' })
    expect(r.source).toBe('filename')
    expect(localParts(r.timestampExact)).toMatchObject({
      y: 2026,
      mo: 9,
      d: 1,
      h: 18,
      mi: 32,
      s: 7,
    })
  })

  it('sin fecha reconocida usa 3 mar 2026', () => {
    const r = resolveOriginAttribution({ filename: 'nota-voz.m4a' })
    expect(r.source).toBe('fallback')
    expect(r.timestampExact).toBe(FALLBACK_TIMESTAMP)
  })
})
