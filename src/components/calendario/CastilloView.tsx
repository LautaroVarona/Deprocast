import { useMemo, useState } from 'react'
import type { AmaPlace, CalendarOccurrence, SuggestedTodo } from '../../types'
import {
  chipsForDay,
  cycle28Containing,
  floatingGregorianDays,
  getAlchemyForDate,
  isSaturnEclipse,
  lunarPhase,
  toDayKey,
} from '../../lib/calendar/engine'
import { moonPhase } from '../../lib/map/zones'
import { CastilloSealPanel } from './QuantomoPipePanels'

type TideNode = {
  id: string
  name: string
  pillar: 'torre' | 'iglesia' | 'reloj'
}

const FALLBACK_TIDE: TideNode[] = [
  { id: 'paterna', name: 'Paterna', pillar: 'torre' },
  { id: 'horta', name: 'Horta Sud', pillar: 'iglesia' },
  { id: 'castillo', name: 'Castillo Sagunto', pillar: 'torre' },
  { id: 'puerto', name: 'Puerto Sagunto', pillar: 'reloj' },
]

type Props = {
  focus: Date
  today: Date
  occurrences: CalendarOccurrence[]
  onSelectDay: (date: Date) => void
  places?: AmaPlace[]
  holds?: SuggestedTodo[]
}

function oracleLine(lunarDay: number, eclipse: boolean): string {
  const phase = lunarPhase(lunarDay)
  if (eclipse) {
    return 'Eclipse de Saturno: el más allá y el más acá. Reconfiguración, no empuje.'
  }
  if (phase.key === 'nueva') {
    return 'Luna nueva: siembra y estructura. Torre e Iglesia ganan marea.'
  }
  if (phase.key === 'llena') {
    return 'Luna llena: visibilidad y transacciones. El Reloj sube al tope.'
  }
  if (phase.key === 'creciente') {
    return 'Creciente: acumulación táctica. Cierra el frente que ya late.'
  }
  return 'Menguante: archiva, recorta, deja margen. El Castillo guarda.'
}

function pillarOf(place: AmaPlace, index: number): TideNode['pillar'] {
  const blob = `${place.name} ${place.role ?? ''} ${place.zone_code ?? ''}`.toLowerCase()
  if (/reloj|puerto/.test(blob)) return 'reloj'
  if (/iglesia|horta/.test(blob)) return 'iglesia'
  if (/castillo|torre/.test(blob)) return 'torre'
  return index % 3 === 0 ? 'reloj' : index % 2 === 0 ? 'iglesia' : 'torre'
}

function nodeHeat(pillar: TideNode['pillar'], illumination: number): number {
  if (pillar === 'reloj') return illumination
  return 1 - illumination
}

function beadClass(
  alchemyStage: string,
  eclipse: boolean,
  isToday: boolean,
  isFocus: boolean,
  heat: 'low' | 'high' | null,
): string {
  return [
    'cal-lunar-bead',
    `is-${alchemyStage}`,
    eclipse ? 'is-eclipse' : '',
    isToday ? 'is-today' : '',
    isFocus ? 'is-focus' : '',
    heat === 'low' ? 'is-heat-new' : '',
    heat === 'high' ? 'is-heat-full' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function CastilloView({
  focus,
  today,
  occurrences,
  onSelectDay,
  places = [],
  holds = [],
}: Props) {
  const [tapiz, setTapiz] = useState<'grid' | 'ring'>('grid')
  const cycle = useMemo(() => cycle28Containing(focus), [focus])
  const todayKey = toDayKey(today)
  const focusKey = toDayKey(focus)
  const eclipseNow = isSaturnEclipse(cycle.lunarDay)
  const moon = useMemo(() => moonPhase(focus), [focus])
  const oracle = oracleLine(cycle.lunarDay, eclipseNow)
  const floating = useMemo(() => floatingGregorianDays(focus), [focus])
  const phase = lunarPhase(cycle.lunarDay)
  const heatKind: 'low' | 'high' | null =
    phase.key === 'nueva' ? 'low' : phase.key === 'llena' ? 'high' : null

  const tideNodes: TideNode[] = useMemo(() => {
    const pinned = places.filter((p) => p.lat != null && p.lng != null)
    if (pinned.length === 0) return FALLBACK_TIDE
    return pinned.slice(0, 6).map((p, i) => ({
      id: p.id,
      name: p.name,
      pillar: pillarOf(p, i),
    }))
  }, [places])

  function dayButton(date: Date, lunarDay: number, ringStyle?: { left: string; top: string }) {
    const alchemy = getAlchemyForDate(date)
    const eclipse = isSaturnEclipse(lunarDay)
    const key = toDayKey(date)
    const count =
      chipsForDay(key, occurrences).length +
      holds.filter((t) => t.hold_at && toDayKey(new Date(t.hold_at)) === key).length
    const visibleBoost =
      heatKind === 'high' &&
      holds.some(
        (t) =>
          t.hold_at &&
          toDayKey(new Date(t.hold_at)) === key &&
          (t.priority <= 2 || t.area === 'territorio' || t.area === 'finanzas'),
      )
    const structureBoost =
      heatKind === 'low' &&
      holds.some(
        (t) =>
          t.hold_at &&
          toDayKey(new Date(t.hold_at)) === key &&
          (t.gravity ?? 12) <= 6,
      )
    return (
      <button
        key={key}
        type="button"
        className={beadClass(
          alchemy.stageKey,
          eclipse,
          key === todayKey,
          key === focusKey,
          visibleBoost ? 'high' : structureBoost ? 'low' : heatKind,
        )}
        style={ringStyle}
        onClick={() => onSelectDay(date)}
        title={`${lunarPhase(lunarDay).label} · ${date.toLocaleDateString('es-ES')}`}
      >
        <span className="cal-lunar-num mono">{lunarDay}</span>
        <span className="cal-lunar-phase" aria-hidden="true">
          {lunarPhase(lunarDay).glyph}
        </span>
        <span className="cal-lunar-greg muted mono">
          {date.getDate()}/{date.getMonth() + 1}
        </span>
        {count > 0 && <span className="cal-lunar-count mono">{count}</span>}
        {eclipse && <span className="cal-eclipse-tag mono">Eclipse</span>}
      </button>
    )
  }

  return (
    <div className="cal-castillo">
      <div className="cal-castillo-main">
        <p className="cal-castillo-legend muted">
          Ciclo lunar 28 · índice {cycle.cycleIndex} · día {cycle.lunarDay}/28.
          Eclipse de Saturno en 27–28.
        </p>
        <div className="cal-tapiz-toggle">
          <button
            type="button"
            className={tapiz === 'grid' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setTapiz('grid')}
          >
            Grilla 4×7
          </button>
          <button
            type="button"
            className={tapiz === 'ring' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setTapiz('ring')}
          >
            Anillo
          </button>
        </div>
        {tapiz === 'grid' ? (
          <div className="cal-lunar-grid" aria-label="Tapiz lunar de 28 días">
            {cycle.days.map((date, i) => dayButton(date, i + 1))}
          </div>
        ) : (
          <div className="cal-lunar-ring" aria-label="Tapiz lunar de 28 días">
            <div className="cal-lunar-hub">
              <span className="cal-lunar-hub-phase">{phase.glyph}</span>
              <span className="mono">{phase.label}</span>
              <span className="muted mono">día {cycle.lunarDay}/28</span>
            </div>
            {cycle.days.map((date, i) => {
              const rad = ((i / 28) * 360 - 90) * (Math.PI / 180)
              const x = 50 + 42 * Math.cos(rad)
              const y = 50 + 42 * Math.sin(rad)
              return dayButton(date, i + 1, { left: `${x}%`, top: `${y}%` })
            })}
          </div>
        )}
        {floating.length > 0 && (
          <div className="cal-float-days">
            <p className="cal-ingest-label mono">Días gregorianos flotantes</p>
            <div className="cal-float-row">
              {floating.map((date) => (
                <button
                  key={toDayKey(date)}
                  type="button"
                  className="cal-float-chip"
                  onClick={() => onSelectDay(date)}
                >
                  {date.getDate()}/{date.getMonth() + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="cal-castillo-rail">
        <section className="cal-oracle">
          <p className="cal-ingest-label mono">Oráculo</p>
          <p className="cal-oracle-text">{oracle}</p>
        </section>
        <section className={`cal-tide is-${phase.key}`}>
          <p className="cal-ingest-label mono">Marea lunar</p>
          <p className="muted mono cal-tide-meta">
            {moon.label} · {Math.round(moon.illumination * 100)}%
          </p>
          <ul className="cal-tide-list">
            {tideNodes.map((node) => {
              const heat = nodeHeat(node.pillar, moon.illumination)
              return (
                <li key={node.id} className="cal-tide-node">
                  <div className="cal-tide-row">
                    <span>{node.name}</span>
                    <span className="mono muted">{node.pillar}</span>
                  </div>
                  <span
                    className="cal-tide-bar"
                    style={{ ['--heat' as string]: String(heat) }}
                  />
                </li>
              )
            })}
          </ul>
        </section>
        <CastilloSealPanel />
      </aside>
    </div>
  )
}
