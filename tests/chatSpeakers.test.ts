import { describe, expect, it } from 'vitest'
import { normalizePersonKind } from '../server/services/personKinds.ts'
import {
  conversationTodoTask,
  parseChatSpeakerMap,
  previewMessagesByBlock,
  resolveChatProcessWeight,
  sessionSpeakersReady,
  speakersHaveAi,
  tasksFromChatExtraction,
} from '../server/services/chatSpeakers.ts'
import type { Person } from '../src/types.ts'
import {
  bindSpeaker,
  normalizeConversationSpeakers,
  patchSpeaker,
  speakerIsAi,
  speakersFromParticipants,
} from '../src/lib/chatSpeakersMap.ts'

describe('personKinds ia', () => {
  it('normaliza alias de modelo a ia', () => {
    expect(normalizePersonKind('assistant')).toBe('ia')
    expect(normalizePersonKind('ai')).toBe('ia')
    expect(normalizePersonKind('bot')).toBe('ia')
    expect(normalizePersonKind('IA')).toBe('ia')
  })
})

describe('chatSpeakers', () => {
  it('parsea is_ai del speaker_map', () => {
    const mapped = parseChatSpeakerMap(
      JSON.stringify([
        { remitente: 'ChatGPT', person_id: 'p1', person_name: 'GPT', is_ai: true },
        { remitente: 'Lau', person_id: 'p2', person_name: 'Lautaro' },
      ]),
    )
    expect(mapped[0]?.is_ai).toBe(true)
    expect(mapped[0]?.role).toBe('assistant')
    expect(mapped[1]?.is_ai).toBe(false)
    expect(mapped[1]?.role).toBe('human')
    expect(speakersHaveAi(mapped)).toBe(true)
  })

  it('peso default 4 con IA y 7 sin IA; no pisa HITL', () => {
    expect(resolveChatProcessWeight({ hasAi: true })).toBe(4)
    expect(resolveChatProcessWeight({ hasAi: false })).toBe(7)
    expect(
      resolveChatProcessWeight({
        hasAi: false,
        conversationWeight: 10,
        blockWeight: 4,
      }),
    ).toBe(6)
    expect(
      resolveChatProcessWeight({
        hasAi: true,
        suggestedWeight: 3,
      }),
    ).toBe(3)
  })

  it('preview toma 3 mensajes no-sistema por bloque', () => {
    const map = previewMessagesByBlock([
      {
        id: '1',
        chat_session_id: 's',
        remitente: 'A',
        texto_crudo: 'uno',
        timestamp_exact: 't',
        is_system: 0,
        is_media: 0,
        estado_procesamiento: 'pendiente',
        block_id: 'b1',
        sort_index: 0,
      },
      {
        id: 'sys',
        chat_session_id: 's',
        remitente: null,
        texto_crudo: 'sys',
        timestamp_exact: 't',
        is_system: 1,
        is_media: 0,
        estado_procesamiento: 'pendiente',
        block_id: 'b1',
        sort_index: 1,
      },
      {
        id: '2',
        chat_session_id: 's',
        remitente: 'A',
        texto_crudo: 'dos',
        timestamp_exact: 't',
        is_system: 0,
        is_media: 0,
        estado_procesamiento: 'pendiente',
        block_id: 'b1',
        sort_index: 2,
      },
    ])
    expect(map.get('b1')?.map((m) => m.texto_crudo)).toEqual(['uno', 'dos'])
  })
})

describe('chat extraction tasks', () => {
  it('dedupea actions y milestones como todos', () => {
    const tasks = tasksFromChatExtraction({
      actions: [
        { task_text: 'Llamar a Camila', tag: 'todo' },
        { task_text: ' llamar a camila ', tag: 'seguimiento' },
      ],
      milestones: ['Llamar a Camila', 'Entrega lunes'],
    })
    expect(tasks).toEqual([
      { task_text: 'Llamar a Camila', tag: 'todo' },
      { task_text: 'Entrega lunes', tag: 'hito' },
    ])
  })

  it('arma el todo de conversación votada', () => {
    expect(conversationTodoTask('Versa', 9)).toEqual({
      task_text: 'Conversación «Versa» · peso 9',
      tag: 'todo',
    })
  })

  it('sessionSpeakersReady exige perfiles', () => {
    expect(sessionSpeakersReady([])).toBe(false)
    expect(
      sessionSpeakersReady([{ remitente: 'A', person_id: null, person_name: null }]),
    ).toBe(false)
    expect(
      sessionSpeakersReady([
        { remitente: 'A', person_id: 'p1', person_name: 'Ana' },
      ]),
    ).toBe(true)
  })
})

function person(p: Partial<Person> & Pick<Person, 'id' | 'name' | 'kind'>): Person {
  return {
    aliases: '',
    notes: null,
    status: 'active',
    created_at: '',
    updated_at: '',
    source: 'manual',
    ...p,
  }
}

describe('chatSpeakersMap is_ai por remitente', () => {
  const camila = person({
    id: 'p-camila',
    name: 'Camila Verdún Lomba',
    kind: 'fisica',
  })
  const lau = person({
    id: 'p-lau',
    name: 'Lautaro J. Sarni',
    kind: 'fisica',
    is_operator: 1,
  })
  const gpt = person({ id: 'p-gpt', name: 'gpt-4o', kind: 'ia' })

  it('un flag is_ai viejo no se pega a un perfil humano', () => {
    const healed = normalizeConversationSpeakers(
      [
        {
          remitente: 'Camila Verdún Lomba',
          person_id: 'p-camila',
          person_name: 'Camila Verdún Lomba',
          is_ai: true,
          role: 'assistant',
        },
        {
          remitente: 'Lautaro J. Sarni',
          person_id: 'p-lau',
          person_name: 'Lautaro J. Sarni',
          is_ai: false,
          role: 'human',
        },
      ],
      [camila, lau, gpt],
    )
    expect(speakerIsAi('Camila Verdún Lomba', healed)).toBe(false)
    expect(speakerIsAi('Lautaro J. Sarni', healed)).toBe(false)
    expect(healed.find((s) => s.remitente === 'Camila Verdún Lomba')?.role).toBe(
      'human',
    )
  })

  it('sin roster no borra person_id ya asignado', () => {
    const mapped = [
      {
        remitente: 'Camila Verdún Lomba',
        person_id: 'p-camila',
        person_name: 'Camila Verdún Lomba',
        is_ai: false,
        role: 'human' as const,
      },
    ]
    expect(normalizeConversationSpeakers(mapped, [])).toEqual(mapped)
  })

  it('marcar IA en un remitente no contagia al resto', () => {
    const base = speakersFromParticipants(
      ['Camila Verdún Lomba', 'Lautaro J. Sarni'],
      [camila, lau, gpt],
    )
    const next = patchSpeaker(base, 'Lautaro J. Sarni', gpt)
    expect(speakerIsAi('Lautaro J. Sarni', next)).toBe(true)
    expect(speakerIsAi('Camila Verdún Lomba', next)).toBe(false)
    expect(next.find((s) => s.remitente === 'Camila Verdún Lomba')?.person_id).toBe(
      'p-camila',
    )
  })

  it('bindSpeaker ignora is_ai previo si el perfil no es ia', () => {
    const bound = bindSpeaker('Camila Verdún Lomba', camila, {
      remitente: 'Camila Verdún Lomba',
      person_id: 'p-camila',
      person_name: 'Camila',
      is_ai: true,
      role: 'assistant',
      model: 'gpt-4o',
    })
    expect(bound.is_ai).toBe(false)
    expect(bound.role).toBe('human')
    expect(bound.model).toBeNull()
  })
})
