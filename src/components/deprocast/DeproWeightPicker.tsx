type Props = {
  value: number | null
  onChange: (next: number | null) => void
  disabled?: boolean
}

export function DeproWeightPicker({ value, onChange, disabled }: Props) {
  return (
    <div className="depro-weight-row" role="group" aria-label="Peso HITL 1 a 12">
      <span className="muted mono">Peso</span>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={value === n ? 'filter-chip is-active' : 'filter-chip'}
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
