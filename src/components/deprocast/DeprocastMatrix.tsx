import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type { DeproPower, DeproPowerStatus } from '../../types'
import {
  AGENT_BY_ID,
  CMA_LABEL,
  DEPRO_DOMAIN_META,
  IPO_LABEL,
  oficioLabel,
  powerNumber,
  TYPOLOGY_LABEL,
} from '../../lib/deprocast'
import type { IdaDraft } from './idaDraft'

type Props = {
  powers: DeproPower[]
  onChanged: () => void
  onOpenIda: (draft: IdaDraft) => void
}

const STATUSES: DeproPowerStatus[] = ['hueco', 'bosquejo', 'cargado']

export function DeprocastMatrix({ powers, onChanged, onOpenIda }: Props) {
  const [selected, setSelected] = useState(71)
  const [notesDraft, setNotesDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const power = powers[selected] ?? powers[0]
  const face0 = useMemo(() => powers.filter((p) => p.amazona.face === 0), [powers])
  const face1 = useMemo(() => powers.filter((p) => p.amazona.face === 1), [powers])

  useEffect(() => {
    const next = powers[selected]
    setNotesDraft(next?.operator_notes ?? '')
  }, [selected, powers])

  function pick(index: number) {
    setSelected(index)
    setStatusMsg(null)
  }

  async function saveNotes() {
    if (!power) return
    setSaving(true)
    try {
      await api.deprocastPatchPower(power.index, { notes: notesDraft })
      setStatusMsg('Notas guardadas')
      onChanged()
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(status: DeproPowerStatus | null) {
    if (!power) return
    setSaving(true)
    try {
      await api.deprocastPatchPower(power.index, { status })
      onChanged()
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const loaded = powers.filter((p) => (p.status_override ?? p.status) !== 'hueco').length

  return (
    <div className="depro-layout">
      <section className="panel depro-board">
        <header className="panel-head">
          <h2>Matrix 72</h2>
          <span className="muted mono">
            {loaded}/72 · 8 dominios × 9 oficios
          </span>
        </header>
        <p className="muted depro-lead">
          Dos caras 6×6. La semántica es dominio × (Input | Procesamiento |
          Output) × (Cuerpo | Mente | Alma). Los huecos se cargan en código,
          uno a uno.
        </p>
        <div className="depro-faces">
          <FaceGrid
            title="Cara 1"
            cells={face0}
            selected={selected}
            onPick={pick}
          />
          <FaceGrid
            title="Cara 2"
            cells={face1}
            selected={selected}
            onPick={pick}
          />
        </div>
      </section>

      {power && (
        <aside className="panel depro-inspect">
          <header className="panel-head">
            <h2>
              <span className="mono depro-idx">
                {powerNumber(power.index)}
              </span>{' '}
              {power.name}
            </h2>
            <span className={`depro-pill is-${power.status_override ?? power.status}`}>
              {power.status_override ?? power.status}
            </span>
          </header>

          <dl className="depro-meta">
            <div>
              <dt>Dominio</dt>
              <dd>{DEPRO_DOMAIN_META[power.domain].label}</dd>
            </div>
            <div>
              <dt>Oficio</dt>
              <dd>{oficioLabel(power)}</dd>
            </div>
            <div>
              <dt>Tipología</dt>
              <dd>{TYPOLOGY_LABEL[power.typology]}</dd>
            </div>
            <div>
              <dt>Amazona</dt>
              <dd className="mono">
                cara {power.amazona.face + 1} · {power.amazona.row + 1},
                {power.amazona.col + 1} · ({power.amazona.x},{power.amazona.y},
                {power.amazona.z})
              </dd>
            </div>
          </dl>

          <p className="depro-notes">{power.notes}</p>

          <div className="depro-trident">
            <div>
              <span>Input</span>
              <p>{power.contract.input}</p>
            </div>
            <div>
              <span>Procesamiento</span>
              <p>{power.contract.processing}</p>
            </div>
            <div>
              <span>Output</span>
              <p>{power.contract.output}</p>
            </div>
          </div>

          {power.agentIds.length > 0 && (
            <div className="depro-agents-mini">
              <span className="muted mono">Agentes</span>
              <ul>
                {power.agentIds.map((id) => (
                  <li key={id}>{AGENT_BY_ID[id]?.name ?? id}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="depro-label" htmlFor="depro-op-notes">
            Notas del operador
          </label>
          <textarea
            id="depro-op-notes"
            className="depro-textarea"
            rows={4}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Ir anotando. El catálogo hardcodeado no se pisa."
          />
          <div className="depro-inspect-actions">
            <button
              type="button"
              className="btn btn-tiny"
              disabled={saving}
              onClick={() => void saveNotes()}
            >
              Guardar notas
            </button>
            <button
              type="button"
              className="btn btn-tiny"
              onClick={() =>
                onOpenIda({
                  title: `${power.name} (${powerNumber(power.index)})`,
                  body: power.notes,
                  power_indexes: [power.index],
                  agent_ids: power.agentIds,
                  tags: [power.domain, power.ipo, power.cma],
                })
              }
            >
              Abrir en IDA
            </button>
          </div>

          <div className="depro-status-row">
            <span className="muted mono">Override</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={
                  (power.status_override ?? power.status) === s
                    ? 'filter-chip is-active'
                    : 'filter-chip'
                }
                disabled={saving}
                onClick={() => void setStatus(s)}
              >
                {s}
              </button>
            ))}
            {power.status_override && (
              <button
                type="button"
                className="filter-chip"
                disabled={saving}
                onClick={() => void setStatus(null)}
              >
                catálogo
              </button>
            )}
          </div>
          {statusMsg && <p className="muted depro-save-msg">{statusMsg}</p>}
          <p className="muted depro-geo-hint">
            {IPO_LABEL[power.ipo]} × {CMA_LABEL[power.cma]} ·{' '}
            {DEPRO_DOMAIN_META[power.domain].origin}
          </p>
        </aside>
      )}
    </div>
  )
}

function FaceGrid({
  title,
  cells,
  selected,
  onPick,
}: {
  title: string
  cells: DeproPower[]
  selected: number
  onPick: (index: number) => void
}) {
  const grid = Array.from({ length: 36 }, (_, cell) => {
    const row = Math.floor(cell / 6)
    const col = cell % 6
    return cells.find((p) => p.amazona.row === row && p.amazona.col === col)
  })

  return (
    <div className="depro-face">
      <h3>{title}</h3>
      <div className="depro-grid" role="grid" aria-label={title}>
        {grid.map((p, i) => {
          if (!p) {
            return <div key={`empty-${i}`} className="depro-cell is-missing" />
          }
          const st = p.status_override ?? p.status
          return (
            <button
              key={p.index}
              type="button"
              role="gridcell"
              className={
                p.index === selected
                  ? `depro-cell is-${st} is-selected`
                  : `depro-cell is-${st}`
              }
              data-ipo={p.ipo}
              data-cma={p.cma}
              title={`${powerNumber(p.index)} ${p.name}`}
              onClick={() => onPick(p.index)}
            >
              <span className="mono">{powerNumber(p.index)}</span>
              <em>{p.name}</em>
            </button>
          )
        })}
      </div>
    </div>
  )
}
