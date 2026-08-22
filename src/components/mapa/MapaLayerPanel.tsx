import type { MapLayer, MapSystem } from '../../types'

type Props = {
  systems: MapSystem[]
  systemId: string
  layers: MapLayer[]
  onSelectSystem: (id: string) => void
  onToggleLayer: (id: string, visible: boolean) => void
  onOpacity: (id: string, opacity: number) => void
  onCreateSystem: (name: string) => void
  onDeleteSystem: (id: string) => void
  busy?: boolean
}

export function MapaLayerPanel({
  systems,
  systemId,
  layers,
  onSelectSystem,
  onToggleLayer,
  onOpacity,
  onCreateSystem,
  onDeleteSystem,
  busy,
}: Props) {
  return (
    <section className="mapa-panel-block">
      <p className="mapa-kicker">Sistemas</p>
      <select
        className="mapa-select"
        value={systemId}
        disabled={busy}
        onChange={(e) => onSelectSystem(e.target.value)}
      >
        {systems.map((sys) => (
          <option key={sys.id} value={sys.id}>
            {sys.name}
          </option>
        ))}
      </select>
      <form
        className="mapa-inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const input = form.elements.namedItem('sysname') as HTMLInputElement
          const name = input.value.trim()
          if (!name) return
          onCreateSystem(name)
          input.value = ''
        }}
      >
        <input name="sysname" placeholder="Nuevo sistema…" disabled={busy} />
        <button type="submit" className="btn btn-tiny" disabled={busy}>
          Crear
        </button>
      </form>
      {systemId !== 'map-sys-pghqg' ? (
        <button
          type="button"
          className="btn btn-tiny btn-ghost"
          disabled={busy}
          onClick={() => onDeleteSystem(systemId)}
        >
          Borrar sistema
        </button>
      ) : null}

      <p className="mapa-kicker">Capas</p>
      <ul className="mapa-layer-list">
        {layers.map((layer) => (
          <li key={layer.id}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(layer.visible)}
                disabled={busy}
                onChange={(e) => onToggleLayer(layer.id, e.target.checked)}
              />
              <span>{layer.title}</span>
            </label>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={layer.opacity}
              disabled={busy || !layer.visible}
              onChange={(e) => onOpacity(layer.id, Number(e.target.value))}
              aria-label={`Opacidad ${layer.title}`}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
