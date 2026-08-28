import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../server/errors.ts'
import {
  CognitiveEngine,
  isGroqRateLimitError,
} from '../server/services/cognitiveEngine.ts'
import { SerialQueue } from '../server/services/queue.ts'

const FORENSIC_JSON = {
  quantomos: ['La vault local-first es el núcleo operativo'],
  acciones: ['Pasar el corte por Aduana'],
  entidades: [{ nombre: 'Camila', tipo: 'Persona' as const }],
}

describe('CognitiveEngine (Groq)', () => {
  it('devuelve JSON estricto con quantomos, acciones y entidades', async () => {
    const groqComplete = vi.fn(async () => JSON.stringify(FORENSIC_JSON))
    const ollamaComplete = vi.fn(async () => {
      throw new Error('Ollama no debería correr')
    })
    const engine = new CognitiveEngine({
      groqComplete,
      ollamaComplete,
      skipQueue: true,
    })

    const { extraction, provider } = await engine.extractKnowledge(
      'Hablé con Camila sobre la vault local-first y hay que pasar el corte por Aduana.',
    )

    expect(provider).toBe('groq')
    expect(groqComplete).toHaveBeenCalledOnce()
    expect(ollamaComplete).not.toHaveBeenCalled()
    expect(Array.isArray(extraction.quantomos)).toBe(true)
    expect(Array.isArray(extraction.acciones)).toBe(true)
    expect(Array.isArray(extraction.entidades)).toBe(true)
    expect(extraction.quantomos[0]).toBe(FORENSIC_JSON.quantomos[0])
    expect(extraction.acciones[0]).toBe(FORENSIC_JSON.acciones[0])
    expect(extraction.entidades[0]).toEqual({
      nombre: 'Camila',
      tipo: 'Persona',
    })
    expect(['Persona', 'Proyecto', 'Agrupacion', 'Artefacto', 'Ubicacion', 'Hito']).toContain(
      extraction.entidades[0]?.tipo,
    )
  })
})

describe('CognitiveEngine fallback Ollama', () => {
  it('ante 429 de Groq redirige a Ollama y resuelve el JSON', async () => {
    const groqComplete = vi.fn(async () => {
      throw new AppError('Too Many Requests', 429, 'GROQ_RATE_LIMIT')
    })
    const ollamaComplete = vi.fn(async (input: {
      url: string
      model: string
      system: string
      user: string
    }) => {
      expect(input.url).toContain('11434')
      expect(input.model).toBe('llama3')
      expect(input.system).toMatch(/analizador forense/i)
      return JSON.stringify({
        quantomos: ['Fallback local'],
        acciones: ['Reintentar Groq más tarde'],
        entidades: [{ nombre: 'Deprocast', tipo: 'Proyecto' }],
      })
    })
    const engine = new CognitiveEngine({
      groqComplete,
      ollamaComplete,
      skipQueue: true,
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3',
    })

    const rateErr = new AppError('Too Many Requests', 429, 'GROQ_RATE_LIMIT')
    expect(isGroqRateLimitError(rateErr)).toBe(true)

    const { extraction, provider } = await engine.extractKnowledge(
      'Nota de prueba para forzar rate limit.',
    )

    expect(provider).toBe('ollama')
    expect(groqComplete).toHaveBeenCalledOnce()
    expect(ollamaComplete).toHaveBeenCalledOnce()
    expect(extraction.quantomos).toEqual(['Fallback local'])
    expect(extraction.acciones).toEqual(['Reintentar Groq más tarde'])
    expect(extraction.entidades).toEqual([
      { nombre: 'Deprocast', tipo: 'Proyecto' },
    ])
  })
})

describe('SerialQueue (rate limiter)', () => {
  it('resuelve 5 peticiones simultáneas en serie respetando el delay', async () => {
    const delayMs = 40
    const queue = new SerialQueue({ delayMs, concurrency: 1 })
    const starts: number[] = []
    let concurrent = 0
    let maxConcurrent = 0

    const jobs = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        starts.push(Date.now())
        await new Promise((r) => setTimeout(r, 5))
        concurrent -= 1
        return i
      }),
    )

    const results = await Promise.all(jobs)

    expect(results).toEqual([0, 1, 2, 3, 4])
    expect(maxConcurrent).toBe(1)
    expect(starts).toHaveLength(5)
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!
      expect(gap).toBeGreaterThanOrEqual(delayMs - 8)
    }
  })
})
