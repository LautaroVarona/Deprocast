import { describe, expect, it } from 'vitest'
import {
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
