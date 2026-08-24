import { ANATOMY_SYSTEMS } from '../systems'
import { findNode, nodesForBand } from '../sceneGraph'
import {
  LOD_RANGES,
  MAX_CAMERA_DISTANCE,
  MIN_CAMERA_DISTANCE,
  clampCameraDistance,
  formatScale,
  lodMeta,
} from '../lod'
import {
  patchOverride,
  patchSystems,
  requestDistance,
  setBpm,
  setEegBand,
  setRenderMode,
  selectNode,
  useAlephLod,
  useAlephUi,
  useResetAleph,
} from '../store'
import type { RenderMode } from '../types'

const MODES: Array<{ id: RenderMode; label: string }> = [
  { id: 'solid', label: 'Sólido' },
  { id: 'xray', label: 'Rayos X' },
  { id: 'wireframe', label: 'Alambre' },
]

const EEG_LABELS = [
  ['delta', 'δ'],
  ['theta', 'θ'],
  ['alpha', 'α'],
  ['beta', 'β'],
  ['gamma', 'γ'],
] as const

export function AlephHud() {
  const ui = useAlephUi()
  const lod = useAlephLod()
  const reset = useResetAleph()
  const meta = lodMeta(lod.band)
  const selected = ui.selectedId ? findNode(ui.selectedId) : undefined
  const selectedOverride = selected ? ui.overrides[selected.id] : undefined
  const bandNodes = nodesForBand(lod.band)
  const logMin = Math.log10(MIN_CAMERA_DISTANCE)
  const logMax = Math.log10(MAX_CAMERA_DISTANCE)

  return (
    <div className="aleph-hud">
      <aside className="aleph-panel" aria-label="Controles Aleph">
        <p className="aleph-kicker">Aleph</p>
        <h2 className="aleph-title">{meta.label}</h2>
        <p className="aleph-scale mono">{formatScale(lod.distance, lod.log10)}</p>
        <p className="muted aleph-hint">{meta.hint}</p>

        <label className="aleph-slider-label">
          Escala
          <input
            type="range"
            min={logMin}
            max={logMax}
            step={0.02}
            value={lod.log10}
            onChange={(e) =>
              requestDistance(
                clampCameraDistance(10 ** Number(e.target.value)),
              )
            }
          />
        </label>

        <div className="aleph-band-row">
          {LOD_RANGES.map((range) => (
            <button
              key={range.band}
              type="button"
              className={
                range.band === lod.band
                  ? 'btn btn-tiny is-on'
                  : 'btn btn-tiny btn-ghost'
              }
              title={range.hint}
              onClick={() => requestDistance(range.midpoint)}
            >
              {range.label}
            </button>
          ))}
        </div>

        <p className="aleph-kicker">Sistemas</p>
        <ul className="aleph-sys-list">
          {ANATOMY_SYSTEMS.map((sys) => (
            <li key={sys.id}>
              <label>
                <input
                  type="checkbox"
                  checked={ui.systems[sys.id]}
                  onChange={(e) => patchSystems(sys.id, e.target.checked)}
                />
                <span>{sys.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <p className="aleph-kicker">Render</p>
        <div className="aleph-band-row">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={
                ui.renderMode === mode.id
                  ? 'btn btn-tiny is-on'
                  : 'btn btn-tiny btn-ghost'
              }
              onClick={() => setRenderMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <p className="aleph-kicker">Telemetría</p>
        <label className="aleph-slider-label">
          BPM {ui.telemetry.bpm}
          <input
            type="range"
            min={40}
            max={160}
            step={1}
            value={ui.telemetry.bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </label>
        {EEG_LABELS.map(([id, glyph]) => (
          <label key={id} className="aleph-slider-label">
            EEG {glyph} {ui.telemetry.eeg[id].toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ui.telemetry.eeg[id]}
              onChange={(e) => setEegBand(id, Number(e.target.value))}
            />
          </label>
        ))}

        <button
          type="button"
          className="btn btn-tiny btn-ghost aleph-reset"
          onClick={reset}
        >
          Reset
        </button>
      </aside>

      <div className="aleph-hud-right">
        <section className="aleph-panel aleph-panel-narrow" aria-label="Nodos">
          <p className="aleph-kicker">Nodos · {meta.label}</p>
          <ul className="aleph-node-list">
            {bandNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className={
                    ui.selectedId === node.id
                      ? 'aleph-node-btn is-on'
                      : 'aleph-node-btn'
                  }
                  onClick={() => selectNode(node.id)}
                >
                  {node.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {selected ? (
          <section className="aleph-panel aleph-panel-narrow" aria-label="Inspector">
            <p className="aleph-kicker">Inspector</p>
            <h3 className="aleph-inspect-title">{selected.label}</h3>
            <p className="muted mono aleph-hint">
              {selected.kind}
              {selected.procedural ? ` · ${selected.procedural}` : ''}
              {selected.url ? ` · ${selected.url}` : ''}
            </p>
            <label className="aleph-slider-label">
              Color
              <input
                type="color"
                value={selectedOverride?.color ?? selected.color}
                onChange={(e) =>
                  patchOverride(selected.id, { color: e.target.value })
                }
              />
            </label>
            <label className="aleph-check">
              <input
                type="checkbox"
                checked={selectedOverride?.visible !== false}
                onChange={(e) =>
                  patchOverride(selected.id, { visible: e.target.checked })
                }
              />
              Visible
            </label>
            {selected.systems.length > 0 ? (
              <p className="muted aleph-hint">
                Sistemas: {selected.systems.join(', ')}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
