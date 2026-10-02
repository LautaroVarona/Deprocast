import { afterEach, describe, expect, it } from 'vitest'
import { pickSlotRoute } from '../server/services/appSettings.ts'

const ENV_KEYS = [
  'NAN_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'COHERE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OLLAMA_VISION_MODEL',
] as const

const saved = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function clearKeys(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('fallback de ruta NaN', () => {
  it('se queda en Groq si esa key existe, aunque NaN también', () => {
    clearKeys()
    process.env.GROQ_API_KEY = 'g-test'
    process.env.NAN_API_KEY = 'sk-nan'
    expect(
      pickSlotRoute('llm_main', 'openrouter', 'stealth/ox-alpha').provider,
    ).toBe('groq')
    expect(
      pickSlotRoute('llm_fast', 'groq', 'openai/gpt-oss-120b').provider,
    ).toBe('groq')
  })

  it('cae a nan/deepseek y nan/gemma4 si Groq y OpenRouter están vacíos', () => {
    clearKeys()
    process.env.NAN_API_KEY = 'sk-nan'
    expect(pickSlotRoute('llm_main', 'openrouter', 'stealth/ox-alpha')).toEqual(
      { provider: 'nan', model: 'deepseek-v4-flash' },
    )
    expect(pickSlotRoute('llm_fast', 'groq', 'openai/gpt-oss-120b')).toEqual({
      provider: 'nan',
      model: 'gemma4',
    })
    expect(pickSlotRoute('llm_vision', 'openrouter', 'stealth/ox-alpha')).toEqual(
      { provider: 'nan', model: 'deepseek-v4-flash' },
    )
  })

  it('no pisa OpenRouter cuando esa key está presente', () => {
    clearKeys()
    process.env.OPENROUTER_API_KEY = 'sk-or'
    process.env.NAN_API_KEY = 'sk-nan'
    expect(pickSlotRoute('llm_main', 'openrouter', 'stealth/ox-alpha')).toEqual(
      { provider: 'openrouter', model: 'stealth/ox-alpha' },
    )
  })

  it('el motor de inferencia sigue en Ollama si Groq no tiene key', () => {
    clearKeys()
    process.env.NAN_API_KEY = 'sk-nan'
    expect(
      pickSlotRoute('llm_sentinel', 'groq', 'openai/gpt-oss-20b').provider,
    ).toBe('ollama')
  })

  it('respeta nan elegido a mano', () => {
    clearKeys()
    process.env.NAN_API_KEY = 'sk-nan'
    expect(pickSlotRoute('llm_main', 'nan', 'qwen3.6')).toEqual({
      provider: 'nan',
      model: 'qwen3.6',
    })
    expect(pickSlotRoute('llm_sentinel', 'nan', 'glm5.3-flash')).toEqual({
      provider: 'nan',
      model: 'glm5.3-flash',
    })
  })
})
