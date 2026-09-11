import { describe, expect, it } from 'vitest'
import {
  extractQuantomoIdsFromVotePayload,
  parseQuantomoExportStage,
  quantomoStageExportBasename,
  QUANTOMO_STAGE_FILE_SLUG,
  QUANTOMO_STAGE_LABEL,
} from '../server/services/quantomoExport.ts'

describe('parseQuantomoExportStage', () => {
  it('acepta etapas canónicas y alias de UI', () => {
    expect(parseQuantomoExportStage('proto')).toBe('proto')
    expect(parseQuantomoExportStage('pre')).toBe('pre')
    expect(parseQuantomoExportStage('sealed')).toBe('sealed')
    expect(parseQuantomoExportStage('protoquantomos')).toBe('proto')
    expect(parseQuantomoExportStage('prequantomos')).toBe('pre')
    expect(parseQuantomoExportStage('quantomos')).toBe('sealed')
    expect(parseQuantomoExportStage('Quántomos')).toBe(null)
    expect(parseQuantomoExportStage('all')).toBe(null)
    expect(parseQuantomoExportStage('')).toBe(null)
  })
})

describe('extractQuantomoIdsFromVotePayload', () => {
  it('lee dump de etapa, export de Corpus, ids sueltos y arrays', () => {
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    expect(
      extractQuantomoIdsFromVotePayload({
        format: 'deprocast-quantomos',
        quantomos: [{ id: a }, { id: b }, { id: a }],
      }),
    ).toEqual([a, b])
    expect(
      extractQuantomoIdsFromVotePayload({
        source: 'deprocast-quantomos',
        quantomos: [{ id: a, title: 'x' }],
      }),
    ).toEqual([a])
    expect(extractQuantomoIdsFromVotePayload({ ids: [a, b] })).toEqual([a, b])
    expect(extractQuantomoIdsFromVotePayload([a, { id: b }])).toEqual([a, b])
    expect(
      extractQuantomoIdsFromVotePayload({ format: 'deprocast-quantomos' }),
    ).toEqual([])
    expect(extractQuantomoIdsFromVotePayload(null)).toEqual([])
  })
})

describe('nombres de export por etapa', () => {
  it('usa slug distinto para proto, pre y sellados', () => {
    expect(QUANTOMO_STAGE_FILE_SLUG.proto).toBe('protoquantomos')
    expect(QUANTOMO_STAGE_FILE_SLUG.pre).toBe('prequantomos')
    expect(QUANTOMO_STAGE_FILE_SLUG.sealed).toBe('quantomos')
    expect(QUANTOMO_STAGE_LABEL.proto).toBe('Protoquántomos')
    expect(quantomoStageExportBasename('pre')).toMatch(
      /^deprocast-prequantomos-\d{4}-\d{2}-\d{2}$/,
    )
    expect(quantomoStageExportBasename('sealed')).toMatch(
      /^deprocast-quantomos-\d{4}-\d{2}-\d{2}$/,
    )
  })
})
