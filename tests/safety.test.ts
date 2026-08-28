import { describe, expect, it } from 'vitest'
import { parseInstagramUrl } from '../server/services/urlSafety.ts'
import { sanitizePersistUrl } from '../server/services/urlSanitize.ts'
import { collectDescendantIds } from '../server/services/descendants.ts'

describe('parseInstagramUrl', () => {
  it('exige https e host exacto', () => {
    expect(parseInstagramUrl('http://instagram.com/p/x').ok).toBe(false)
    expect(parseInstagramUrl('https://evil.com/?u=instagram.com').ok).toBe(false)
    expect(parseInstagramUrl('https://instagram.com/p/abc').ok).toBe(true)
  })

  it('rechaza userinfo', () => {
    expect(parseInstagramUrl('https://user:pass@instagram.com/p/x').ok).toBe(
      false,
    )
  })
})

describe('sanitizePersistUrl', () => {
  it('elimina query y hash', () => {
    const out = sanitizePersistUrl(
      'https://x.com/a/status/1?access_token=SECRET#frag',
    )
    expect(out).not.toMatch(/SECRET/)
    expect(out).not.toMatch(/#/)
  })
})

describe('collectDescendantIds', () => {
  it('no entra en ciclo', () => {
    const tree: Record<string, string[]> = {
      a: ['b'],
      b: ['a', 'c'],
      c: [],
    }
    const ids = collectDescendantIds('a', (id) => tree[id] ?? [])
    expect(ids.sort()).toEqual(['b', 'c'])
  })
})
