import { describe, expect, it } from 'vitest'
import { pickOllamaModel } from '../server/services/providers/ollamaChat.ts'

describe('pickOllamaModel', () => {
  it('devuelve null si no hay modelos instalados', () => {
    expect(pickOllamaModel([], 'llama3')).toBeNull()
  })

  it('casa llama3 con llama3:latest, no con llama3.1', () => {
    expect(pickOllamaModel(['llama3.1:latest', 'llama3:latest'], 'llama3')).toBe(
      'llama3:latest',
    )
  })

  it('si el preferido no está, usa el primero instalado', () => {
    expect(pickOllamaModel(['qwen2.5:7b', 'mistral'], 'llama3')).toBe(
      'qwen2.5:7b',
    )
  })
})
