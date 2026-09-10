import { describe, expect, it } from 'vitest'
import {
  buildSpeechConcatFilter,
  shouldConcatSpeech,
} from '../server/services/audioAnalysis.ts'

describe('audio F1 concat filter', () => {
  it('no concat si no hay habla o cubre casi todo', () => {
    expect(shouldConcatSpeech([], 40)).toBe(false)
    expect(shouldConcatSpeech([{ start: 0, end: 38 }], 40)).toBe(false)
    expect(
      shouldConcatSpeech(
        [
          { start: 2, end: 8 },
          { start: 20, end: 28 },
        ],
        40,
      ),
    ).toBe(true)
  })

  it('arma filter_complex con atrim + concat', () => {
    const one = buildSpeechConcatFilter([{ start: 1.5, end: 4 }])
    expect(one).toContain('atrim=start=1.5:end=4')
    expect(one).toContain('[out]')
    const two = buildSpeechConcatFilter([
      { start: 0, end: 2 },
      { start: 10, end: 12 },
    ])
    expect(two).toContain('concat=n=2:v=0:a=1[out]')
    expect(two).toContain('[a0]')
    expect(two).toContain('[a1]')
  })
})
