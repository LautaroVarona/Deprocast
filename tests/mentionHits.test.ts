import { describe, expect, it } from 'vitest'
import {
  isMentionTagged,
  orderMentionHits,
  stepSelectableMentionIdx,
  type MentionMenuHit,
} from '../src/components/MentionMenu'

function hit(
  kind: MentionMenuHit['kind'],
  entity_id: string,
  entity_name = entity_id,
): MentionMenuHit {
  return { kind, entity_id, entity_name, subtitle: kind }
}

describe('orderMentionHits', () => {
  it('mueve los ya marcados al final y deja el resto adelante', () => {
    const hits = [
      hit('project', 'versa'),
      hit('person', 'versa-p'),
      hit('dominio', 'otro'),
    ]
    const tagged = new Set(['project:versa'])
    expect(orderMentionHits(hits, tagged).map((h) => h.entity_id)).toEqual([
      'versa-p',
      'otro',
      'versa',
    ])
  })

  it('no reordena si no hay tags activos', () => {
    const hits = [hit('project', 'a'), hit('person', 'b')]
    expect(orderMentionHits(hits)).toEqual(hits)
  })
})

describe('stepSelectableMentionIdx', () => {
  it('salta los ya marcados al navegar', () => {
    const hits = [
      hit('project', 'a'),
      hit('person', 'b'),
      hit('dominio', 'c'),
    ]
    const tagged = new Set(['person:b'])
    expect(stepSelectableMentionIdx(hits, 0, 1, tagged)).toBe(2)
    expect(stepSelectableMentionIdx(hits, 2, -1, tagged)).toBe(0)
  })

  it('reconoce kind+id como ya marcado', () => {
    expect(isMentionTagged(hit('project', 'x'), new Set(['project:x']))).toBe(
      true,
    )
    expect(isMentionTagged(hit('person', 'x'), new Set(['project:x']))).toBe(
      false,
    )
  })
})
