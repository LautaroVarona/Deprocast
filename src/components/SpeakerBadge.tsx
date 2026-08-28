import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { api } from '../services/api'
import type { BookmarkManualTag, SpeakerAssignment } from '../types'

type Props = {
  speaker: number
  assignment: SpeakerAssignment | undefined
  operatorTag: BookmarkManualTag | null
  personTags: BookmarkManualTag[]
  suggested?: boolean
  disabled?: boolean
  onAssign: (tag: BookmarkManualTag | null) => void
}

type PersonHit = {
  entity_id: string
  entity_name: string
  subtitle: string
}

function speakerLabel(
  speaker: number,
  assignment: SpeakerAssignment | undefined,
): string {
  if (assignment?.person_name) return assignment.person_name
  return `Speaker ${speaker}`
}

export function SpeakerBadge({
  speaker,
  assignment,
  operatorTag,
  personTags,
  suggested = false,
  disabled = false,
  onAssign,
}: Props) {
  const menuId = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbort = useRef<AbortController | null>(null)

  const assigned = Boolean(assignment?.person_id)
  const label = speakerLabel(speaker, assignment)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setHits([])
    setIdx(0)
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    const rect = btnRef.current?.getBoundingClientRect()
    setAnchor(rect ?? null)
    setOpen(true)
    setQuery('')
    setHits([])
    setIdx(0)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => searchRef.current?.focus(), 20)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (btnRef.current?.contains(t)) return
      const pop = document.getElementById(menuId)
      if (pop?.contains(t)) return
      close()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open, close, menuId])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchAbort.current?.abort()
    }
  }, [])

  const runSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchAbort.current?.abort()
    const trimmed = q.trim()
    if (!trimmed) {
      setHits([])
      setBusy(false)
      return
    }
    setBusy(true)
    searchTimer.current = setTimeout(() => {
      const ac = new AbortController()
      searchAbort.current = ac
      void (async () => {
        try {
          const res = await api.typeaheadEntities(trimmed, {
            kinds: ['person'],
            limit: 8,
            scope: 'masters',
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          setHits(
            res.results
              .filter((h) => h.kind === 'person')
              .map((h) => ({
                entity_id: h.id,
                entity_name: h.label,
                subtitle: h.subtitle,
              })),
          )
          setIdx(0)
        } catch {
          if (!ac.signal.aborted) setHits([])
        } finally {
          if (!ac.signal.aborted) setBusy(false)
        }
      })()
    }, 120)
  }, [])

  const pick = useCallback(
    (tag: BookmarkManualTag | null) => {
      onAssign(tag)
      close()
      btnRef.current?.focus()
    },
    [onAssign, close],
  )

  const quick: BookmarkManualTag[] = []
  if (operatorTag) quick.push(operatorTag)
  for (const t of personTags) {
    if (quick.some((q) => q.entity_id === t.entity_id)) continue
    quick.push(t)
  }

  const options: Array<{ tag: BookmarkManualTag | null; label: string; sub?: string }> =
    [
      { tag: null, label: 'Sin asignar' },
      ...quick.map((t) => ({
        tag: t,
        label:
          operatorTag && t.entity_id === operatorTag.entity_id
            ? `Yo — ${t.entity_name}`
            : t.entity_name,
      })),
      ...hits
        .filter((h) => !quick.some((q) => q.entity_id === h.entity_id))
        .map((h) => ({
          tag: {
            kind: 'person' as const,
            entity_id: h.entity_id,
            entity_name: h.entity_name,
          },
          label: h.entity_name,
          sub: h.subtitle,
        })),
    ]

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (options.length) setIdx((i) => (i + 1) % options.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (options.length) setIdx((i) => (i - 1 + options.length) % options.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[idx]
      if (opt) pick(opt.tag)
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const opt = options[idx]
      if (opt) pick(opt.tag)
    }
  }

  const menu =
    open && anchor
      ? createPortal(
          <div
            id={menuId}
            className="speaker-pop"
            role="listbox"
            aria-label={`Asignar voz ${speaker}`}
            style={{
              top: Math.min(anchor.bottom + 6, window.innerHeight - 280),
              left: Math.min(anchor.left, window.innerWidth - 280),
            }}
          >
            <header className="speaker-pop-head">
              <span className="speaker-pop-title">Voz S{speaker}</span>
              <span className="speaker-pop-hint">Enter confirma</span>
            </header>
            <input
              ref={searchRef}
              className="speaker-pop-search"
              type="search"
              placeholder="Buscar persona…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                runSearch(e.target.value)
              }}
              onKeyDown={onSearchKey}
            />
            {busy && hits.length === 0 && query.trim() ? (
              <p className="muted speaker-pop-empty">Buscando…</p>
            ) : null}
            <div className="speaker-pop-list">
              {options.map((opt, i) => {
                const on = opt.tag
                  ? opt.tag.entity_id === assignment?.person_id
                  : !assignment?.person_id
                return (
                  <button
                    key={`${opt.tag?.entity_id ?? 'none'}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === idx}
                    className={`speaker-pop-item${i === idx ? ' is-active' : ''}${
                      on ? ' is-on' : ''
                    }`}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => pick(opt.tag)}
                  >
                    <span className="speaker-pop-name">{opt.label}</span>
                    {opt.sub ? (
                      <span className="muted speaker-pop-sub">{opt.sub}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`speaker-badge${assigned ? ' is-linked' : ''}${
          suggested && !assigned ? ' is-suggested' : ''
        }${open ? ' is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Reasignar identidad"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <span className="speaker-badge-id mono">S{speaker}</span>
        <span className="speaker-badge-name">{label}</span>
        {suggested && !assigned ? (
          <span className="speaker-badge-hint">sugerido</span>
        ) : null}
      </button>
      {menu}
    </>
  )
}
