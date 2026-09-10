/** Fallback de prueba cuando no hay fecha clara en nombre / metadata / audio. */
export const FALLBACK_TIMESTAMP = '2026-03-03T12:00:00.000Z'

export interface OriginResult {
  timestampExact: string
  source: 'filename' | 'transcript' | 'metadata' | 'fallback'
}

const MONTHS_ES: Record<string, number> = {
  enero: 0,
  ene: 0,
  febrero: 1,
  feb: 1,
  marzo: 2,
  mar: 2,
  abril: 3,
  abr: 3,
  mayo: 4,
  may: 4,
  junio: 5,
  jun: 5,
  julio: 6,
  jul: 6,
  agosto: 7,
  ago: 7,
  septiembre: 8,
  setiembre: 8,
  sept: 8,
  sep: 8,
  set: 8,
  octubre: 9,
  oct: 9,
  noviembre: 10,
  nov: 10,
  diciembre: 11,
  dic: 11,
}

const MONTH_ALT = Object.keys(MONTHS_ES).join('|')

/** e.g. "3 ago, 14.18.m4a" | "3 ago 14:18" | "03-ago-2026 14.18" */
const FILENAME_RE = new RegExp(
  `(\\d{1,2})\\s*[.\\-_]*\\s*(?:de\\s+)?(${MONTH_ALT})\\.?(?:\\s*[.,\\-_]?\\s*|\\s+)(?:(\\d{4})\\s*[.\\-_]*\\s*)?(\\d{1,2})[.:](\\d{2})`,
  'i',
)

const FILENAME_DATE_ONLY_RE = new RegExp(
  `(\\d{1,2})\\s*[.\\-_]*\\s*(?:de\\s+)?(${MONTH_ALT})(?:\\s*[.,\\-_]?\\s*|\\s+)(\\d{4})?`,
  'i',
)

const TRANSCRIPT_RE = new RegExp(
  `(?:(?:el|hoy\\s+es|estamos\\s+a|hoy\\s+a)\\s+)?(\\d{1,2})\\s*(?:de\\s+)?(${MONTH_ALT})(?:\\s+(?:de\\s+)?(\\d{4}))?(?:[^\\d]{0,20}?(?:a\\s+las?\\s+|a\\s+)?(\\d{1,2})[.:h](\\d{2}))?`,
  'i',
)

/**
 * Grabadoras Android/Samsung, p.ej. 20260901_183207.m4a
 * También 20260901-183207, 20260901T183207, 20260901183207.
 */
const COMPACT_DT_RE = /(\d{4})(\d{2})(\d{2})[_T\-]?(\d{2})(\d{2})(\d{2})(?!\d)/

/** ISO / WhatsApp-ish: 2026-09-01_18-32-07 | 2026-09-01 18:32:07 | 2026/09/01 18.32 */
const SEPARATED_DT_RE =
  /(\d{4})[-/.](\d{2})[-/.](\d{2})[ T_](\d{1,2})[:.\-](\d{2})(?:[:.\-](\d{2}))?/

/** Solo día compacto: 20260901, AUD-20260901-WA0001 */
const COMPACT_DATE_RE = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/

function civilToIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): string | null {
  if (
    year < 1990 ||
    year > 2100 ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null
  }
  // Reloj del archivo = reloj local (como datetime-local en Aduana).
  const d = new Date(year, monthIndex, day, hour, minute, second)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== monthIndex ||
    d.getDate() !== day
  ) {
    return null
  }
  return d.toISOString()
}

function parseMatch(
  dayStr: string,
  monthStr: string,
  yearStr: string | undefined,
  hourStr: string | undefined,
  minuteStr: string | undefined,
  defaultYear: number,
): string | null {
  const monthIndex = MONTHS_ES[monthStr.toLowerCase()]
  if (monthIndex === undefined) return null
  const day = Number(dayStr)
  const year = yearStr ? Number(yearStr) : defaultYear
  const hour = hourStr !== undefined ? Number(hourStr) : 12
  const minute = minuteStr !== undefined ? Number(minuteStr) : 0
  if (
    Number.isNaN(day) ||
    Number.isNaN(year) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null
  }
  return civilToIso(year, monthIndex, day, hour, minute, 0)
}

function fromCompactMatch(m: RegExpMatchArray): string | null {
  return civilToIso(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] !== undefined ? Number(m[6]) : 0,
  )
}

function parseCompactDate(base: string, defaultHour = 12): string | null {
  const m = base.match(COMPACT_DATE_RE)
  if (!m) return null
  return civilToIso(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    defaultHour,
    0,
    0,
  )
}

function filenameStem(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/\s*[·•]\s*parte\s+\d+/i, '')
}

export function parseFromFilename(
  filename: string,
  defaultYear = 2026,
): string | null {
  const base = filenameStem(filename)

  const compactDt = base.match(COMPACT_DT_RE)
  if (compactDt) return fromCompactMatch(compactDt)

  const separatedDt = base.match(SEPARATED_DT_RE)
  if (separatedDt) return fromCompactMatch(separatedDt)

  const withTime = base.match(FILENAME_RE)
  if (withTime) {
    return parseMatch(
      withTime[1]!,
      withTime[2]!,
      withTime[3],
      withTime[4],
      withTime[5],
      defaultYear,
    )
  }

  const compactDate = parseCompactDate(base)
  if (compactDate) return compactDate

  const dateOnly = base.match(FILENAME_DATE_ONLY_RE)
  if (dateOnly) {
    return parseMatch(
      dateOnly[1]!,
      dateOnly[2]!,
      dateOnly[3],
      undefined,
      undefined,
      defaultYear,
    )
  }
  return null
}

export function parseFromTranscript(
  transcript: string,
  defaultYear = 2026,
): string | null {
  if (!transcript?.trim()) return null
  const m = transcript.match(TRANSCRIPT_RE)
  if (!m) return null
  return parseMatch(m[1]!, m[2]!, m[3], m[4], m[5], defaultYear)
}

export function resolveOriginAttribution(opts: {
  filename: string
  transcript?: string | null
  fileMtime?: Date | null
  /** Ignorado: sin fecha clara → FALLBACK_TIMESTAMP (3 mar 2026). */
  uploadNow?: Date
  defaultYear?: number
}): OriginResult {
  const year = opts.defaultYear ?? 2026
  const fromName = parseFromFilename(opts.filename, year)
  if (fromName) {
    return { timestampExact: fromName, source: 'filename' }
  }

  const fromTranscript = parseFromTranscript(opts.transcript ?? '', year)
  if (fromTranscript) {
    return { timestampExact: fromTranscript, source: 'transcript' }
  }

  if (opts.fileMtime) {
    return {
      timestampExact: opts.fileMtime.toISOString(),
      source: 'metadata',
    }
  }

  return {
    timestampExact: FALLBACK_TIMESTAMP,
    source: 'fallback',
  }
}
