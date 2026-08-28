import type { ChatSpeakerMap, Person } from '../types'

function uniqueByRemitente(speakers: ChatSpeakerMap[]): ChatSpeakerMap[] {
  const seen = new Set<string>()
  const out: ChatSpeakerMap[] = []
  for (const s of speakers) {
    if (seen.has(s.remitente)) continue
    seen.add(s.remitente)
    out.push(s)
  }
  return out
}

export function matchPerson(
  name: string,
  persons: Person[],
): Person | undefined {
  const pool = persons.filter((p) => p.kind !== 'ia')
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  const exact = pool.find((p) => p.name.toLowerCase() === n)
  if (exact) return exact
  const alias = pool.find((p) =>
    (p.aliases_list ?? []).some((a) => a.toLowerCase() === n),
  )
  if (alias) return alias
  return pool.find(
    (p) =>
      p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase()),
  )
}

/** `is_ai` sale solo del perfil asignado a ESTE remitente. Nunca se hereda. */
export function bindSpeaker(
  remitente: string,
  person: Person | null | undefined,
  prev?: ChatSpeakerMap,
): ChatSpeakerMap {
  const is_ai = person?.kind === 'ia'
  return {
    remitente,
    person_id: person?.id ?? null,
    person_name: person?.name ?? null,
    is_ai,
    role: is_ai ? 'assistant' : 'human',
    model: is_ai ? (prev?.model ?? person?.name ?? null) : null,
  }
}

export function speakerIsAi(
  remitente: string | null | undefined,
  speakers: ChatSpeakerMap[],
): boolean {
  if (!remitente) return false
  const hit = speakers.find((s) => s.remitente === remitente)
  return hit?.is_ai === true
}

export function speakerMapsDiverge(
  a: ChatSpeakerMap[],
  b: ChatSpeakerMap[],
): boolean {
  if (a.length !== b.length) return true
  return a.some((s, i) => {
    const o = b[i]
    return (
      s.remitente !== o?.remitente ||
      s.person_id !== o?.person_id ||
      Boolean(s.is_ai) !== Boolean(o?.is_ai)
    )
  })
}

/**
 * Recalcula `is_ai` SOLO desde el perfil de ese remitente.
 * Un flag viejo en el map no se copia; un humano no hereda IA.
 */
export function normalizeConversationSpeakers(
  speakers: ChatSpeakerMap[],
  persons: Person[],
): ChatSpeakerMap[] {
  const unique = uniqueByRemitente(speakers)
  if (persons.length === 0) return unique
  return unique.map((s) => {
    const mapped = s.person_id
      ? persons.find((p) => p.id === s.person_id)
      : undefined
    if (mapped) return bindSpeaker(s.remitente, mapped, s)
    if (s.person_id) return s
    return bindSpeaker(s.remitente, matchPerson(s.remitente, persons), s)
  })
}

export function speakersFromParticipants(
  names: string[],
  persons: Person[],
  prev: ChatSpeakerMap[] = [],
): ChatSpeakerMap[] {
  return uniqueByRemitente(
    names.map((remitente) => {
      const existing = prev.find((s) => s.remitente === remitente)
      const byId = existing?.person_id
        ? persons.find((p) => p.id === existing.person_id)
        : undefined
      return bindSpeaker(
        remitente,
        byId ?? matchPerson(remitente, persons),
        existing,
      )
    }),
  )
}

export function patchSpeaker(
  list: ChatSpeakerMap[],
  remitente: string,
  person: Person | null,
): ChatSpeakerMap[] {
  return list.map((s) =>
    s.remitente === remitente ? bindSpeaker(remitente, person, s) : s,
  )
}
