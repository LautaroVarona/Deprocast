import { describe, expect, it } from 'vitest'
import {
  continueDrainIds,
  mergeEnqueueIds,
} from '../server/services/pipelineQueue.ts'

describe('mergeEnqueueIds', () => {
  it('prioriza el id votado y suma el resto de la cola', () => {
    expect(mergeEnqueueIds(['voted'], ['a', 'voted', 'b'])).toEqual([
      'voted',
      'a',
      'b',
    ])
  })

  it('sin pedido, drena todo lo de DB', () => {
    expect(mergeEnqueueIds(undefined, ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('continueDrainIds', () => {
  it('rescata leftover y pending_extract (carrera voto / fin de drain)', () => {
    expect(
      continueDrainIds({
        leftoverQueue: ['extract-new'],
        pendingExtract: ['extract-db'],
        queued: ['old'],
        attempted: ['old'],
        failed: [],
      }),
    ).toEqual(['extract-new', 'extract-db'])
  })

  it('toma queued nuevos (ingest a mitad de drain) y no reintenta fallidos', () => {
    expect(
      continueDrainIds({
        leftoverQueue: [],
        pendingExtract: [],
        queued: ['failed', 'fresh'],
        attempted: ['failed'],
        failed: ['failed'],
      }),
    ).toEqual(['fresh'])
  })
})
