import { describe, expect, it } from 'vitest'
import { hybridScore } from '../server/services/lattice72.ts'
import {
  NO_EVIDENCE_REPLY,
  bm25ToUnit,
  citationsFromContext,
  formatOracleGraphBlock,
  formatOracleSourceLine,
  fuseHybridCandidate,
  hasOracleEvidence,
  isSealedQuantomoForRag,
  mergeHybridHits,
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
      {
        type: 'quantomo',
        id: 'q-sealed-1',
        label: 'Vault local-first',
        entry_id: null,
        source_kind: null,
        timestamp_exact: null,
        locator: null,
      },
    ])
  })

  it('incluye línea fuente y no cita entries crudas', () => {
    const block = formatOracleGraphBlock({
      mode: 'hybrid',
      seeds: [
        {
          type: 'quantomo',
          id: 'q-1',
          label: 'Caminata',
          snippet: 'viento',
          score: 0.8,
          entry_id: 'e-audio-1',
          source_kind: 'audio',
          timestamp_exact: '2026-09-02T10:00:00.000Z',
          locator: null,
        },
      ],
      neighbors: [],
    })
    expect(block).toContain('RAG híbrido')
    expect(block).toContain('fuente: entry e-audio-1 · audio · 2026-09-02T10:00:00.000Z')
    expect(block).not.toContain('[entry:')
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
          {
            type: 'quantomo',
            id: 'q1',
            label: 'A',
            entry_id: 'e1',
            source_kind: 'notebook',
            locator: 'page:8',
          },
          { type: 'entry', id: 'e1', label: 'crudo' },
        ]),
      ),
    ).toEqual([
      {
        type: 'quantomo',
        id: 'q1',
        label: 'A',
        entry_id: 'e1',
        source_kind: 'notebook',
        timestamp_exact: null,
        locator: 'page:8',
      },
    ])
    expect(parseCitationsJson('no-json')).toEqual([])
  })
})

describe('índice híbrido', () => {
  it('fusiona léxico + semántico por max, no descarta el segundo si hay léxico', () => {
    const fused = mergeHybridHits(
      [{ id: 'lex-only', type: 'person', label: 'Ada', score: 0.9 }],
      [
        { id: 'lex-only', type: 'person', label: 'Ada', score: 0.4 },
        { id: 'sem-only', type: 'project', label: 'Vault', score: 0.8 },
      ],
      10,
    )
    expect(fused.map((h) => h.id)).toEqual(['lex-only', 'sem-only'])
    expect(fused[0]?.score).toBe(0.9)
    expect(fused[1]?.score).toBe(0.8)
  })

  it('cablea hybridScore L72 (0.25 / 0.40 / 0.35)', () => {
    expect(hybridScore({ fts: 1, embedding: 1, lattice: 1 })).toBeCloseTo(1)
    expect(hybridScore({ fts: 0, embedding: 0, lattice: 1 })).toBeCloseTo(0.35)
    expect(
      fuseHybridCandidate({ ftsScore: 1, embedScore: 1, latticeScore: 1 }),
    ).toBeCloseTo(1)
    expect(fuseHybridCandidate({ ftsScore: 0.5, embedScore: 1 })).toBeCloseTo(
      0.5 * 0.4 + 1 * 0.6,
    )
    expect(bm25ToUnit(-10)).toBe(0.35)
  })

  it('formatea locator de hoja', () => {
    expect(
      formatOracleSourceLine({
        entry_id: 'e',
        source_kind: 'notebook',
        locator: 'page:14',
      }),
    ).toBe('fuente: entry e · notebook · page:14')
  })
})
