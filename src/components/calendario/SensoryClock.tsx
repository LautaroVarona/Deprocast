import { useEffect, useState } from 'react'
import {
  sensoryBlock,
  type ClockSkin,
  type TridentId,
} from '../../lib/calendar/engine'

type Props = {
  now: Date
  skin: ClockSkin
  trident: TridentId
  onSkin: (skin: ClockSkin) => void
  onTrident: (id: TridentId) => void
}

const SKINS: Array<{ id: ClockSkin; label: string }> = [
  { id: 'analog', label: 'Analógico' },
  { id: 'digital', label: 'Digital' },
  { id: 'sensorial', label: 'Sensorial' },
]

const BLOCKS: Array<{ id: TridentId; from: number; to: number }> = [
  { id: 'cuerpo', from: 0, to: 8 },
  { id: 'mente', from: 8, to: 16 },
  { id: 'alma', from: 16, to: 24 },
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function polar(cx: number, cy: number, r: number, hour: number) {
  const a = ((hour / 24) * 360 * Math.PI) / 180
  return {
    x: cx + r * Math.sin(a),
    y: cy - r * Math.cos(a),
  }
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  fromHour: number,
  toHour: number,
): string {
  const start = polar(cx, cy, r, fromHour)
  const end = polar(cx, cy, r, toHour)
  const sweep = toHour - fromHour
  const large = sweep > 12 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`
}

function AnalogFace24({
  now,
  trident,
}: {
  now: Date
  trident: TridentId
}) {
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const hourA = (h / 24) * 360
  const minA = now.getMinutes() * 6 + now.getSeconds() * 0.1
  const secA = now.getSeconds() * 6
  const hourMarks = [0, 6, 12, 18]
  const ticks = Array.from({ length: 24 }, (_, i) => i)

  return (
    <svg className="cal-clock-svg" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="cal-clock-ring" />
      <circle cx="60" cy="60" r="42" className="cal-clock-inner" />
      {BLOCKS.map((b) => (
        <path
          key={b.id}
          d={arcPath(60, 60, 50, b.from, b.to)}
          className={
            trident === b.id
              ? `cal-clock-arc is-${b.id} is-active`
              : `cal-clock-arc is-${b.id}`
          }
        />
      ))}
      {ticks.map((i) => {
        const inner = polar(60, 60, i % 6 === 0 ? 46 : 51, i)
        const outer = polar(60, 60, 54, i)
        return (
          <line
            key={i}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            className={i % 6 === 0 ? 'cal-clock-tick is-major' : 'cal-clock-tick'}
          />
        )
      })}
      {hourMarks.map((hMark) => {
        const p = polar(60, 60, 36, hMark)
        return (
          <text
            key={hMark}
            x={p.x}
            y={p.y}
            className="cal-clock-hour"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {pad(hMark)}
          </text>
        )
      })}
      <g transform={`rotate(${hourA} 60 60)`}>
        <line x1="60" y1="60" x2="60" y2="28" className="cal-clock-hand is-hour" />
      </g>
      <g transform={`rotate(${minA} 60 60)`}>
        <line x1="60" y1="60" x2="60" y2="22" className="cal-clock-hand is-min" />
      </g>
      <g transform={`rotate(${secA} 60 60)`}>
        <line x1="60" y1="64" x2="60" y2="18" className="cal-clock-hand is-sec" />
      </g>
      <circle cx="60" cy="60" r="3.2" className="cal-clock-cap" />
    </svg>
  )
}

export function SensoryClock({
  now,
  skin,
  trident,
  onSkin,
  onTrident,
}: Props) {
  const h24 = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const h12 = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  const block = sensoryBlock(now)

  return (
    <div className="cal-clock">
      <div className="cal-clock-skins" role="tablist" aria-label="Skin del reloj">
        {SKINS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={skin === s.id}
            className={skin === s.id ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => onSkin(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {skin === 'analog' && (
        <div className="cal-clock-analog">
          <AnalogFace24 now={now} trident={trident} />
          <div className="cal-clock-dual mono">
            <span>{h24}</span>
            <span className="muted">00–24h</span>
          </div>
        </div>
      )}

      {skin === 'digital' && (
        <div className="cal-clock-digital">
          <p className="cal-clock-phosphor mono">{h24}</p>
          <p className="cal-clock-phosphor-sub mono">{h12}</p>
          <p className="cal-clock-range muted mono">00–24h</p>
        </div>
      )}

      {skin === 'sensorial' && (
        <div className="cal-clock-sensorial">
          {(
            [
              ['cuerpo', 'Cuerpo', '00–08h'],
              ['mente', 'Mente', '08–16h'],
              ['alma', 'Alma', '16–24h'],
            ] as const
          ).map(([id, label, range]) => (
            <button
              key={id}
              type="button"
              className={
                trident === id
                  ? 'cal-sensor-block is-active'
                  : block === id
                    ? 'cal-sensor-block is-now'
                    : 'cal-sensor-block'
              }
              onClick={() => onTrident(id)}
            >
              <span className="mono">{label}</span>
              <span className="muted">{range}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useClockNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}
