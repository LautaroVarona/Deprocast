import { describe, expect, it } from 'vitest'
import {
  NO_EVIDENCE_REPLY,
  citationsFromContext,
  formatOracleGraphBlock,
  hasOracleEvidence,
  isSealedQuantomoForRag,
  parseCitationsJson,
  ragAllowsObjectType,
} from '../shared/oracleRag.ts'

describe('oracle RAG contract', () => {
  it('excluye entries crudas y proto; acepta sellados', () => {
    expect(ragAllowsObjectType('entry')).toBe(false)
    expect(ragAllowsObjectType('entry_chunk')).toBe(false)
    expect(ragAllowsObjectType('quantomo')).toBe(true)
    expect(isSealedQuantomoForRag(0, 'proto')).toBe(false)
    expect(isSealedQuantomoForRag(1, 'proto')).toBe(false)
    expect(isSealedQuantomoForRag(1, 'pre')).toBe(false)
    expect(isSealedQuantomoForRag(1, 'sealed')).toBe(true)
  })

  it('cita quántomo sellado con id en el bloque', () => {
    const block = formatOracleGraphBlock({
      mode: 'semantic',
      seeds: [
        {
          type: 'quantomo',
          id: 'q-sealed-1',
          label: 'Vault local-first',
          snippet: 'La vault es el núcleo operativo.',
          score: 0.91,
        },
      ],
      neighbors: [
        {
          type: 'person',
          id: 'p-1',
          label: 'Camila',
          via: 'entity_links',
        },
      ],
    })
    expect(block).toContain('[quantomo:q-sealed-1]')
    expect(block).toContain('Vault local-first')
    expect(block).toContain('[person:p-1]')
    expect(block).not.toContain('[entry')
    const cites = citationsFromContext(
      [
        {
          type: 'quantomo',
          id: 'q-sealed-1',
          label: 'Vault local-first',
          snippet: '',
          score: 0.9,
        },
      ],
      [{ type: 'entry', id: 'e-raw', label: 'transcript', via: 'parent' }],
    )
    expect(cites).toEqual([
      { type: 'quantomo', id: 'q-sealed-1', label: 'Vault local-first' },
    ])
  })

  it('sin hits no hay evidencia y el reply no inventa hechos', () => {
    expect(hasOracleEvidence([], [])).toBe(false)
    expect(NO_EVIDENCE_REPLY).toMatch(/no hay evidencia/i)
    expect(NO_EVIDENCE_REPLY.toLowerCase()).not.toContain('según el corpus')
    const block = formatOracleGraphBlock({
      mode: 'none',
      seeds: [],
      neighbors: [],
    })
    expect(block).toContain('sin evidencia')
    expect(block).toContain('(ningún nodo semántico cercano)')
  })

  it('parsea citations_json y descarta tipos crudos', () => {
    expect(
      parseCitationsJson(
        JSON.stringify([
          { type: 'quantomo', id: 'q1', label: 'A' },
          { type: 'entry', id: 'e1', label: 'crudo' },
        ]),
      ),
    ).toEqual([{ type: 'quantomo', id: 'q1', label: 'A' }])
    expect(parseCitationsJson('no-json')).toEqual([])
  })
})
