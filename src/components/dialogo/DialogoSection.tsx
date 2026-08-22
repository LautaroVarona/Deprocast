import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../services/api'
import type {
  DialogoEntityRef,
  DialogoEntityRefType,
  DialogoMessage,
  DialogoThread,
} from '../../types'

type TypeaheadHit = {
  kind: DialogoEntityRefType
  id: string
  label: string
}

interface Props {
  refreshKey: number
  initialThreadId?: string | null
  seedQuery?: string | null
  onSeedConsumed?: () => void
}

export function DialogoSection({
  refreshKey,
  initialThreadId = null,
  seedQuery = null,
  onSeedConsumed,
}: Props) {
  const [threads, setThreads] = useState<DialogoThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId)
  const [messages, setMessages] = useState<DialogoMessage[]>([])
  const [thread, setThread] = useState<DialogoThread | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entityQuery, setEntityQuery] = useState('')
  const [entityHits, setEntityHits] = useState<TypeaheadHit[]>([])
  const [refLabels, setRefLabels] = useState<Record<string, string>>({})
  const seedDone = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    try {
      const data = await api.listDialogoThreads()
      setThreads(data.threads)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadThread = useCallback(async (id: string) => {
    try {
      const data = await api.getDialogoThread(id)
      setThread(data.thread)
      setMessages(data.messages)
      setSelectedId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads, refreshKey])

  useEffect(() => {
    if (initialThreadId) {
      seedDone.current = !seedQuery
      setSelectedId(initialThreadId)
      void loadThread(initialThreadId)
    }
  }, [initialThreadId, seedQuery, loadThread])

  useEffect(() => {
    if (!selectedId) {
      setThread(null)
      setMessages([])
      return
    }
    if (selectedId !== initialThreadId) {
      void loadThread(selectedId)
    }
  }, [selectedId, initialThreadId, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (!seedQuery || !selectedId || seedDone.current) return
    seedDone.current = true
    const q = seedQuery.trim()
    if (!q) {
      onSeedConsumed?.()
      return
    }
    setBusy(true)
    void api
      .postDialogoMessage(selectedId, q)
      .then((data) => {
        setMessages((prev) => [...prev, data.user, data.assistant])
        setThread(data.thread)
        void loadThreads()
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setBusy(false)
        onSeedConsumed?.()
      })
  }, [seedQuery, selectedId, loadThreads, onSeedConsumed])

  useEffect(() => {
    const q = entityQuery.trim()
    if (q.length < 1) {
      setEntityHits([])
      return
    }
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      void api
        .typeaheadEntities(q, { limit: 6, signal: ac.signal })
        .then((data) => {
          if (ac.signal.aborted) return
          setEntityHits(
            data.results
              .filter(
                (r): r is typeof r & { kind: DialogoEntityRefType } =>
                  r.kind === 'person' ||
                  r.kind === 'project' ||
                  r.kind === 'agrupacion' ||
                  r.kind === 'quantomo' ||
                  r.kind === 'dominio',
              )
              .map((r) => ({
                kind: r.kind,
                id: r.id,
                label: r.label,
              })),
          )
        })
        .catch(() => {
          if (!ac.signal.aborted) setEntityHits([])
        })
    }, 160)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [entityQuery])

  const createEmpty = async () => {
    setBusy(true)
    setError(null)
    try {
      const { thread: t } = await api.createDialogoThread({
        title: 'Nuevo diálogo',
      })
      seedDone.current = true
      await loadThreads()
      setSelectedId(t.id)
      setThread(t)
      setMessages([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!selectedId || !draft.trim() || busy) return
    const content = draft.trim()
    setDraft('')
    setBusy(true)
    setError(null)
    try {
      const data = await api.postDialogoMessage(selectedId, content)
      setMessages((prev) => [...prev, data.user, data.assistant])
      setThread(data.thread)
      void loadThreads()
    } catch (err) {
      setDraft(content)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const removeRef = async (ref: DialogoEntityRef) => {
    if (!thread) return
    const next = thread.entity_refs.filter(
      (r) => !(r.type === ref.type && r.id === ref.id),
    )
    try {
      const data = await api.updateDialogoThread(thread.id, {
        entity_refs: next,
      })
      setThread(data.thread)
      void loadThreads()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const addRef = async (hit: TypeaheadHit) => {
    if (!thread) return
    if (thread.entity_refs.some((r) => r.type === hit.kind && r.id === hit.id)) {
      setEntityQuery('')
      setEntityHits([])
      return
    }
    const next: DialogoEntityRef[] = [
      ...thread.entity_refs,
      { type: hit.kind, id: hit.id },
    ]
    try {
      const data = await api.updateDialogoThread(thread.id, {
        entity_refs: next,
      })
      setThread(data.thread)
      setRefLabels((prev) => ({
        ...prev,
        [`${hit.kind}:${hit.id}`]: hit.label,
      }))
      setEntityQuery('')
      setEntityHits([])
      void loadThreads()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="dialogo-stage">
      <aside className="dialogo-rail">
        <div className="dialogo-rail-head">
          <h2>Diálogo</h2>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy}
            onClick={() => void createEmpty()}
          >
            + Nuevo
          </button>
        </div>
        <ul className="dialogo-thread-list">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={
                  t.id === selectedId
                    ? 'dialogo-thread-item is-active'
                    : 'dialogo-thread-item'
                }
                onClick={() => {
                  seedDone.current = true
                  setSelectedId(t.id)
                }}
              >
                <span className="dialogo-thread-title">{t.title}</span>
                <span className="muted mono dialogo-thread-meta">
                  {new Date(t.updated_at).toLocaleString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            </li>
          ))}
          {threads.length === 0 && (
            <li className="muted dialogo-empty">Sin hilos todavía.</li>
          )}
        </ul>
      </aside>

      <section className="dialogo-main">
        {!selectedId || !thread ? (
          <div className="dialogo-placeholder">
            <p>Elegí un hilo o creá uno nuevo.</p>
            <p className="muted">
              Desde el Dashboard, Enter en BUSCAR abre un diálogo con esa
              pregunta.
            </p>
          </div>
        ) : (
          <>
            <header className="dialogo-main-head">
              <h3>{thread.title}</h3>
              <div className="dialogo-refs">
                {thread.entity_refs.map((r) => {
                  const key = `${r.type}:${r.id}`
                  const label = refLabels[key] ?? `${r.type}`
                  return (
                  <button
                    key={key}
                    type="button"
                    className="dialogo-ref-chip"
                    onClick={() => void removeRef(r)}
                    title="Quitar ancla"
                  >
                    {label} ×
                  </button>
                  )
                })}
                <div className="dialogo-ref-add">
                  <input
                    type="search"
                    className="dialogo-ref-input"
                    placeholder="Anclar entidad…"
                    value={entityQuery}
                    onChange={(e) => setEntityQuery(e.target.value)}
                  />
                  {entityHits.length > 0 && (
                    <ul className="dialogo-ref-suggest">
                      {entityHits.map((h) => (
                        <li key={`${h.kind}:${h.id}`}>
                          <button
                            type="button"
                            onClick={() => void addRef(h)}
                          >
                            <span className="dialogo-suggest-kind">
                              {h.kind}
                            </span>{' '}
                            {h.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </header>

            <div className="dialogo-messages">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === 'user'
                      ? 'dialogo-bubble is-user'
                      : 'dialogo-bubble is-assistant'
                  }
                >
                  <span className="dialogo-bubble-role">
                    {m.role === 'user' ? 'Vos' : 'Oráculo'}
                  </span>
                  <div className="dialogo-bubble-body">{m.content}</div>
                </div>
              ))}
              {busy && (
                <p className="muted dialogo-thinking">Oráculo pensando…</p>
              )}
              <div ref={bottomRef} />
            </div>

            {error && <p className="dialogo-error">{error}</p>}

            <form
              className="dialogo-composer"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Preguntá al corpus…"
                rows={2}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="submit"
                className="btn"
                disabled={busy || !draft.trim()}
              >
                Enviar
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
