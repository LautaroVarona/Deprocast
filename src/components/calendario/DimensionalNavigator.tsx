import type { DimensionId } from '../../lib/calendar/engine'

const TABS: Array<{
  id: DimensionId
  label: string
  hint: string
  shortcut: string
}> = [
  { id: 'trinchera', label: 'Trinchera', hint: 'Ahora', shortcut: 'Alt+E' },
  { id: 'campamento', label: 'Campamento', hint: 'Rutina', shortcut: 'Alt+W' },
  { id: 'castillo', label: 'Castillo', hint: 'Ciclo 28', shortcut: 'Alt+Q' },
]

type Props = {
  value: DimensionId
  onChange: (id: DimensionId) => void
}

export function DimensionalNavigator({ value, onChange }: Props) {
  return (
    <div
      className="cal-navigator"
      role="tablist"
      aria-label="Navegación dimensional"
    >
      {TABS.map((tab) => {
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={tab.shortcut}
            className={active ? 'cal-nav-tab is-active' : 'cal-nav-tab'}
            onClick={() => onChange(tab.id)}
          >
            <span className="cal-nav-label">{tab.label}</span>
            <span className="cal-nav-hint mono">
              {tab.hint} · {tab.shortcut}
            </span>
          </button>
        )
      })}
    </div>
  )
}
