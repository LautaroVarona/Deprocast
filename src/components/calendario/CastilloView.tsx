import { useMemo } from 'react'
import type { CalendarOccurrence } from '../../types'
import {
  chipsForDay,
  cycle28Containing,
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

const TIDE_NODES: TideNode[] = [
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

function nodeHeat(node: TideNode, illumination: number): number {
  if (node.pillar === 'reloj') return illumination
  return 1 - illumination
}

export function CastilloView({
  focus,
  today,
  occurrences,
  onSelectDay,
}: Props) {
  const cycle = useMemo(() => cycle28Containing(focus), [focus])
  const todayKey = toDayKey(today)
  const focusKey = toDayKey(focus)
  const eclipseNow = isSaturnEclipse(cycle.lunarDay)
  const moon = useMemo(() => moonPhase(focus), [focus])
  const oracle = oracleLine(cycle.lunarDay, eclipseNow)

  return (
    <div className="cal-castillo">
      <div className="cal-castillo-main">
        <p className="cal-castillo-legend muted">
          Ciclo lunar 28 · índice {cycle.cycleIndex} · día {cycle.lunarDay}/28.
          Eclipse de Saturno en 27–28.
        </p>
        <div className="cal-lunar-ring" aria-label="Tapiz lunar de 28 días">
          <div className="cal-lunar-hub">
            <span className="cal-lunar-hub-phase">{lunarPhase(cycle.lunarDay).glyph}</span>
            <span className="mono">{lunarPhase(cycle.lunarDay).label}</span>
            <span className="muted mono">día {cycle.lunarDay}/28</span>
          </div>
          {cycle.days.map((date, i) => {
            const lunarDay = i + 1
            const alchemy = getAlchemyForDate(date)
            const phase = lunarPhase(lunarDay)
            const eclipse = isSaturnEclipse(lunarDay)
            const key = toDayKey(date)
            const count = chipsForDay(key, occurrences).length
            const rad = ((i / 28) * 360 - 90) * (Math.PI / 180)
            const x = 50 + 42 * Math.cos(rad)
            const y = 50 + 42 * Math.sin(rad)
            const cls = [
              'cal-lunar-bead',
              `is-${alchemy.stageKey}`,
              eclipse ? 'is-eclipse' : '',
              key === todayKey ? 'is-today' : '',
              key === focusKey ? 'is-focus' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={key}
                type="button"
                className={cls}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                }}
                onClick={() => onSelectDay(date)}
                title={`${phase.label} · ${date.toLocaleDateString('es-ES')}`}
              >
                <span className="cal-lunar-num mono">{lunarDay}</span>
                <span className="cal-lunar-phase" aria-hidden="true">
                  {phase.glyph}
                </span>
                <span className="cal-lunar-greg muted mono">
                  {date.getDate()}/{date.getMonth() + 1}
                </span>
                {count > 0 && (
                  <span className="cal-lunar-count mono">{count}</span>
                )}
                {eclipse && <span className="cal-eclipse-tag mono">Eclipse</span>}
              </button>
            )
          })}
        </div>
      </div>

      <aside className="cal-castillo-rail">
        <section className="cal-oracle">
          <p className="cal-ingest-label mono">Oráculo</p>
          <p className="cal-oracle-text">{oracle}</p>
        </section>
        <section className="cal-tide">
          <p className="cal-ingest-label mono">Marea lunar</p>
          <p className="muted mono cal-tide-meta">
            {moon.label} · {Math.round(moon.illumination * 100)}%
          </p>
          <ul className="cal-tide-list">
            {TIDE_NODES.map((node) => {
              const heat = nodeHeat(node, moon.illumination)
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
