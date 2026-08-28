import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { api } from '../../services/api'

export type ChipKind =
  | 'person'
  | 'project'
  | 'dominio'
  | 'agrupacion'
  | 'geografia'

/** Orden de sugerencias en criba: personas, dominios, proyectos, geografía. */
export const CHAT_ENTITY_KINDS: ChipKind[] = [
  'person',
  'dominio',
  'project',
  'agrupacion',
  'geografia',
]

const KIND_RANK: Record<ChipKind, number> = {
  person: 0,
  dominio: 1,
  project: 2,
  agrupacion: 3,
  geografia: 4,
}

export const CHIP_KIND_LABEL: Record<ChipKind, string> = {
  person: 'persona',
  project: 'proyecto',
  dominio: 'dominio',
  agrupacion: 'agrupación',
  geografia: 'geografía',
}

export function isChipKind(v: string): v is ChipKind {
  return (CHAT_ENTITY_KINDS as string[]).includes(v)
}

export type EntityChip = {
  id: string
  name: string
  kind: ChipKind
}

type Hit = EntityChip & { subtitle?: string }

type Props = {
  kinds: ChipKind[]
  selected: EntityChip[]
  onChange: (next: EntityChip[]) => void
  disabled?: boolean
  placeholder?: string
  allowCreate?: boolean
  onCreate?: (name: string, kind: ChipKind) => void
  primaryId?: string | null
  onPrimary?: (id: string | null) => void
}

export function EntityChipPicker({
  kinds,
  selected,
  onChange,
  disabled,
  placeholder = 'Buscar entidad…',
  allowCreate,
  onCreate,
  primaryId,
  onPrimary,
}: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abort = useRef<AbortController | null>(null)
  const selectedIds = new Set(selected.map((s) => `${s.kind}:${s.id}`))
  const visibleHits = hits.filter(
    (h) => !selectedIds.has(`${h.kind}:${h.id}`),
  )

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      abort.current?.abort()
    }
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const runSearch = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current)
      abort.current?.abort()
      const trimmed = q.trim()
      if (!trimmed) {
        setHits([])
        setBusy(false)
        setOpen(false)
        return
      }
      timer.current = setTimeout(() => {
        const ac = new AbortController()
        abort.current = ac
        setBusy(true)
        void api
          .typeaheadEntities(trimmed, {
            kinds,
            limit: 24,
            scope: 'masters',
            signal: ac.signal,
          })
          .then((res) => {
            const allowed = new Set(kinds)
            const taken = new Set(selected.map((s) => `${s.kind}:${s.id}`))
            const next: Hit[] = (res.results ?? [])
              .filter((r): r is typeof r & { kind: ChipKind } =>
                isChipKind(r.kind) &&
                allowed.has(r.kind) &&
                !taken.has(`${r.kind}:${r.id}`),
              )
              .map((r) => ({
                id: r.id,
                name: r.label,
                kind: r.kind,
                subtitle: r.subtitle,
              }))
              .sort((a, b) => {
                const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind]
                if (rank !== 0) return rank
                return a.name.localeCompare(b.name, 'es')
              })
              .slice(0, 10)
            setHits(next)
            setIdx(0)
            setOpen(true)
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return
            setHits([])
          })
          .finally(() => setBusy(false))
      }, 120)
    },
    [kinds, selected],
  )

  function add(hit: Hit) {
    if (selectedIds.has(`${hit.kind}:${hit.id}`)) {
      setQuery('')
      setOpen(false)
      return
    }
    onChange([...selected, { id: hit.id, name: hit.name, kind: hit.kind }])
    setQuery('')
    setHits([])
    setOpen(false)
  }

  function remove(chip: EntityChip) {
    onChange(selected.filter((s) => !(s.kind === chip.kind && s.id === chip.id)))
    if (primaryId === chip.id) onPrimary?.(null)
  }

  const canCreate =
    Boolean(allowCreate && onCreate && query.trim()) &&
    !hits.some(
      (h) => h.name.toLowerCase() === query.trim().toLowerCase(),
    ) &&
    !selected.some(
      (s) => s.name.toLowerCase() === query.trim().toLowerCase(),
    )

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (visibleHits.length) setIdx((i) => (i + 1) % visibleHits.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (visibleHits.length) {
        setIdx((i) => (i - 1 + visibleHits.length) % visibleHits.length)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = visibleHits[idx]
      if (hit) add(hit)
      else if (canCreate && kinds.length === 1) {
        onCreate?.(query.trim(), kinds[0] ?? 'person')
      }
    }
  }

  return (
    <div className="chat-chip-picker" ref={wrapRef}>
      <div className="chat-chip-row">
        {selected.map((chip) => {
          const isPrimary = primaryId === chip.id
          return (
            <span
              key={`${chip.kind}:${chip.id}`}
              className={`chat-entity-chip kind-${chip.kind}${
                isPrimary ? ' is-primary' : ''
              }`}
            >
              {onPrimary &&
              chip.kind === (kinds.length === 1 ? kinds[0] : chip.kind) ? (
                <button
                  type="button"
                  className="chat-chip-name"
                  disabled={disabled}
                  title={isPrimary ? 'Principal' : 'Marcar como principal'}
                  onClick={() => onPrimary(isPrimary ? null : chip.id)}
                >
                  {chip.name}
                  {isPrimary ? ' · principal' : ''}
                </button>
              ) : (
                <span className="chat-chip-name">{chip.name}</span>
              )}
              <button
                type="button"
                className="chat-chip-x"
                disabled={disabled}
                aria-label={`Quitar ${chip.name}`}
                onClick={() => remove(chip)}
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
      <input
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          runSearch(e.target.value)
        }}
        onKeyDown={onKey}
        onFocus={() => {
          if (query.trim()) runSearch(query)
        }}
      />
      {open && (visibleHits.length > 0 || busy || canCreate) && (
        <ul className="chat-chip-menu" role="listbox">
          {busy && visibleHits.length === 0 ? (
            <li className="muted">Buscando…</li>
          ) : null}
          {visibleHits.map((hit, i) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <button
                type="button"
                className={i === idx ? 'is-active' : ''}
                onMouseEnter={() => setIdx(i)}
                onClick={() => add(hit)}
              >
                <strong>{hit.name}</strong>
                <span className="muted">
                  {CHIP_KIND_LABEL[hit.kind]}
                  {hit.subtitle ? ` · ${hit.subtitle}` : ''}
                </span>
              </button>
            </li>
          ))}
          {canCreate
            ? kinds.map((kind) => (
                <li key={`create:${kind}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onCreate?.(query.trim(), kind)
                      setQuery('')
                      setHits([])
                      setOpen(false)
                    }}
                  >
                    Crear {CHIP_KIND_LABEL[kind]} «{query.trim()}»
                  </button>
                </li>
              ))
            : null}
        </ul>
      )}
    </div>
  )
}
