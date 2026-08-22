import type { CalendarOccurrence, CalendarPole, CalendarTask } from '../../types'

export type { CalendarOccurrence, CalendarPole, CalendarTask }

export type TridentId = 'cuerpo' | 'mente' | 'alma'
export type ClockSkin = 'analog' | 'digital' | 'sensorial'
export type DimensionId = 'trinchera' | 'campamento' | 'castillo'
export type AlchemyStageKey =
  | 'materia'
  | 'nigredo'
  | 'albedo'
  | 'citrinitas'
  | 'rubedo'
  | 'cubo'
  | 'piedra'

export type AlchemyDay = {
  weekdayIndex: number
  name: string
  planet: string
  glyph: string
  stage: string
  stageKey: AlchemyStageKey
  solfeggioFactor: number
}

export const WEEKDAY_ALCHEMY: AlchemyDay[] = [
  {
    weekdayIndex: 0,
    name: 'Lunes',
    planet: 'Luna',
    glyph: '☽',
    stage: 'Materia Prima',
    stageKey: 'materia',
    solfeggioFactor: 1,
  },
  {
    weekdayIndex: 1,
    name: 'Martes',
    planet: 'Marte',
    glyph: '♂',
    stage: 'Nigredo',
    stageKey: 'nigredo',
    solfeggioFactor: 1.1,
  },
  {
    weekdayIndex: 2,
    name: 'Miércoles',
    planet: 'Mercurio',
    glyph: '☿',
    stage: 'Albedo',
    stageKey: 'albedo',
    solfeggioFactor: 0.95,
  },
  {
    weekdayIndex: 3,
    name: 'Jueves',
    planet: 'Júpiter',
    glyph: '♃',
    stage: 'Citrinitas',
    stageKey: 'citrinitas',
    solfeggioFactor: 1.05,
  },
  {
    weekdayIndex: 4,
    name: 'Viernes',
    planet: 'Venus',
    glyph: '♀',
    stage: 'Rubedo',
    stageKey: 'rubedo',
    solfeggioFactor: 1.08,
  },
  {
    weekdayIndex: 5,
    name: 'Sábado',
    planet: 'Saturno',
    glyph: '♄',
    stage: 'El Cubo Negro',
    stageKey: 'cubo',
    solfeggioFactor: 0.72,
  },
  {
    weekdayIndex: 6,
    name: 'Domingo',
    planet: 'Sol',
    glyph: '☉',
    stage: 'Piedra Filosofal',
    stageKey: 'piedra',
    solfeggioFactor: 1.2,
  },
]

export const TRIDENTS: Array<{
  id: TridentId
  label: string
  n: 3 | 6 | 9
  hz: number
}> = [
  { id: 'cuerpo', label: 'Cuerpo', n: 3, hz: 396 },
  { id: 'mente', label: 'Mente', n: 6, hz: 528 },
  { id: 'alma', label: 'Alma', n: 9, hz: 963 },
]

/** Lunes 6 ene 2020 — ancla de ciclos de 28 días. */
export const CYCLE_EPOCH = new Date(2020, 0, 6)

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const d = startOfLocalDay(date)
  d.setDate(d.getDate() + days)
  return d
}

export function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / 86400000)
}

/** Día 1 = fecha de inicio de la RUN (día civil local). */
export function runDayNumber(startedAt: string, now: Date = new Date()): number {
  const start = startOfLocalDay(new Date(startedAt))
  if (Number.isNaN(start.getTime())) return 1
  const n = daysBetween(start, startOfLocalDay(now)) + 1
  return n < 1 ? 1 : n
}

export function toDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function startOfWeekMonday(date: Date): Date {
  return addDays(startOfLocalDay(date), -mondayIndex(date))
}

export function getAlchemyForDate(date: Date): AlchemyDay {
  return WEEKDAY_ALCHEMY[mondayIndex(date)] ?? WEEKDAY_ALCHEMY[0]
}

export function cycle28Containing(date: Date): {
  start: Date
  days: Date[]
  lunarDay: number
  cycleIndex: number
} {
  const focus = startOfLocalDay(date)
  const epoch = startOfLocalDay(CYCLE_EPOCH)
  const diff = daysBetween(epoch, focus)
  const cycleIndex = Math.floor(diff / 28)
  const start = addDays(epoch, cycleIndex * 28)
  const lunarDay = daysBetween(start, focus) + 1
  const days = Array.from({ length: 28 }, (_, i) => addDays(start, i))
  return { start, days, lunarDay, cycleIndex }
}

export function isSaturnEclipse(lunarDay: number): boolean {
  return lunarDay === 27 || lunarDay === 28
}

export function lunarPhase(lunarDay: number): {
  key: 'nueva' | 'creciente' | 'llena' | 'menguante'
  label: string
  glyph: string
} {
  if (lunarDay <= 2 || lunarDay >= 27) {
    return { key: 'nueva', label: 'Luna nueva', glyph: '●' }
  }
  if (lunarDay <= 13) {
    return { key: 'creciente', label: 'Creciente', glyph: '☽' }
  }
  if (lunarDay <= 16) {
    return { key: 'llena', label: 'Luna llena', glyph: '○' }
  }
  return { key: 'menguante', label: 'Menguante', glyph: '☾' }
}

export function solfeggioHz(trident: TridentId, date: Date): number {
  const t = TRIDENTS.find((x) => x.id === trident) ?? TRIDENTS[0]
  const factor = getAlchemyForDate(date).solfeggioFactor
  return Math.round(t.hz * factor)
}

export function amazonaCoords(index: number): {
  index: number
  face: 0 | 1
  cell: number
  row: number
  col: number
  x: number
  y: number
  z: number
  sum: number
  product: number
} {
  const i = ((index % 72) + 72) % 72
  const face = (Math.floor(i / 36) === 1 ? 1 : 0) as 0 | 1
  const cell = i % 36
  const x = (i % 3) + 1
  const y = (Math.floor(i / 3) % 3) + 1
  const z = (Math.floor(i / 9) % 3) + 1
  return {
    index: i,
    face,
    cell,
    row: Math.floor(cell / 6),
    col: cell % 6,
    x,
    y,
    z,
    sum: x + y + z,
    product: x * y * z,
  }
}

export function stableHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) >>> 0
}

export function defaultMatrixCell(
  taskId: string,
  tag: string | null,
  sourceType: string,
): number {
  return stableHash(`${tag ?? ''}|${sourceType}|${taskId}`) % 36
}

export function sameMinute(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate() &&
    da.getHours() === db.getHours() &&
    da.getMinutes() === db.getMinutes()
  )
}

export function formatHm(iso: string): { h24: string; h12: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { h24: '—', h12: '—' }
  const h24 = d.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const h12 = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return { h24, h12 }
}

export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

export function sourceLabel(sourceType: string): string {
  switch (sourceType) {
    case 'audio':
      return 'Audio'
    case 'blob':
      return 'Nota'
    case 'chat':
      return 'Chat'
    case 'bookmark':
      return 'Bookmark'
    case 'instagram':
      return 'Instagram'
    case 'notebook_page':
      return 'Cuaderno'
    default:
      return sourceType
  }
}

export type DayChip = {
  key: string
  record_id: string
  source_type: string
  title: string
  status: string
  tasks: CalendarTask[]
  hermetic_weight: number | null
  poles: CalendarPole[]
  ingested_at: string | null
  native_at: string | null
  display_at: string
  collapsed: boolean
}

export function chipsForDay(
  dayKey: string,
  occs: CalendarOccurrence[],
): DayChip[] {
  const allByRecord = new Map<string, CalendarOccurrence[]>()
  for (const o of occs) {
    const list = allByRecord.get(o.record_id) ?? []
    list.push(o)
    allByRecord.set(o.record_id, list)
  }

  const inDay = occs.filter((o) => {
    const t = new Date(o.at)
    if (Number.isNaN(t.getTime())) return false
    return toDayKey(t) === dayKey
  })

  const byRecord = new Map<string, CalendarOccurrence[]>()
  for (const o of inDay) {
    const list = byRecord.get(o.record_id) ?? []
    list.push(o)
    byRecord.set(o.record_id, list)
  }

  const chips: DayChip[] = []
  for (const [recordId, list] of byRecord) {
    const all = allByRecord.get(recordId) ?? list
    const ingested = all.find((o) => o.pole === 'ingested') ?? null
    const native = all.find((o) => o.pole === 'native') ?? null
    const collapsed = Boolean(
      ingested && native && sameMinute(ingested.at, native.at),
    )
    const sample = list[0]
    if (collapsed) {
      chips.push({
        key: `${recordId}:both`,
        record_id: recordId,
        source_type: sample.source_type,
        title: sample.title,
        status: sample.status,
        tasks: sample.tasks,
        hermetic_weight: sample.hermetic_weight,
        poles: ['ingested', 'native'],
        ingested_at: ingested?.at ?? null,
        native_at: native?.at ?? null,
        display_at: ingested?.at ?? sample.at,
        collapsed: true,
      })
      continue
    }
    for (const o of list) {
      chips.push({
        key: o.id,
        record_id: recordId,
        source_type: o.source_type,
        title: o.title,
        status: o.status,
        tasks: o.tasks,
        hermetic_weight: o.hermetic_weight,
        poles: [o.pole],
        ingested_at: ingested?.at ?? null,
        native_at: native?.at ?? null,
        display_at: o.at,
        collapsed: false,
      })
    }
  }

  chips.sort((a, b) => a.display_at.localeCompare(b.display_at))
  return chips
}

export function tasksOnDay(
  dayKey: string,
  occs: CalendarOccurrence[],
): Array<CalendarTask & { source_type: string }> {
  const chips = chipsForDay(dayKey, occs)
  const seen = new Set<string>()
  const out: Array<CalendarTask & { source_type: string }> = []
  for (const chip of chips) {
    if (!chip.poles.includes('native') && !chip.collapsed) continue
    for (const t of chip.tasks) {
      if (t.status === 'rejected') continue
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push({ ...t, source_type: chip.source_type })
    }
  }
  return out
}

export function weekTasks(
  weekStart: Date,
  occs: CalendarOccurrence[],
): Array<CalendarTask & { source_type: string; dayKey: string }> {
  const seen = new Set<string>()
  const out: Array<CalendarTask & { source_type: string; dayKey: string }> = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i)
    const key = toDayKey(day)
    const chips = chipsForDay(key, occs)
    for (const chip of chips) {
      if (!chip.poles.includes('native') && !chip.collapsed) continue
      for (const t of chip.tasks) {
        if (t.status === 'rejected') continue
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push({ ...t, source_type: chip.source_type, dayKey: key })
      }
    }
  }
  return out
}

const MATRIX_PREFIX = 'deprocast.amazona.week:'

export function loadMatrixMap(weekKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`${MATRIX_PREFIX}${weekKey}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= 0 && v < 36) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function saveMatrixMap(weekKey: string, map: Record<string, number>) {
  localStorage.setItem(`${MATRIX_PREFIX}${weekKey}`, JSON.stringify(map))
}

export function sensoryBlock(date: Date): TridentId {
  const h = date.getHours()
  if (h < 8) return 'cuerpo'
  if (h < 16) return 'mente'
  return 'alma'
}
