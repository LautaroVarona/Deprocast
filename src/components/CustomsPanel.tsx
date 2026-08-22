import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ProposalBundle } from '../services/api'
import { AudioCribaPanel } from './AudioCribaPanel'

interface Props {
  refreshKey: number
  onEmpty: () => void
  onChanged: () => void
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): string {
  const d = new Date(value)
  return d.toISOString()
}

function entityTypeLabel(type: string): string {
  if (type === 'person') return 'Persona'
  if (type === 'project') return 'Proyecto'
  return type
}

export function CustomsPanel({ refreshKey, onEmpty, onChanged }: Props) {
  const [proposals, setProposals] = useState<ProposalBundle[]>([])
  const [cribaCount, setCribaCount] = useState(0)
  const [tab, setTab] = useState<'criba' | 'review'>('criba')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftTs, setDraftTs] = useState<Record<string, string>>({})
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({})
  const [draftQuantomos, setDraftQuantomos] = useState<
    Record<string, { title: string; content: string }>
  >({})
  const [draftTasks, setDraftTasks] = useState<
    Record<string, { task_text: string; tag: string }>
  >({})
  const [draftEntities, setDraftEntities] = useState<
    Record<string, { name: string }>
  >({})
  const [itemStatus, setItemStatus] = useState<
    Record<string, 'pending' | 'accepted' | 'rejected'>
  >({})
  const [busy, setBusy] = useState(false)
  const proposalsInFlight = useRef(false)

  const loadProposals = useCallback(async () => {
    if (proposalsInFlight.current) return
    proposalsInFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const [data, criba] = await Promise.all([
        api.getPendingProposals(),
        api.getCribaAudios().catch(() => ({ entries: [] })),
      ])
      setProposals(data.proposals)
      setCribaCount(criba.entries.length)
      setTab((prev) => {
        if (prev === 'criba' && criba.entries.length === 0 && data.proposals.length > 0) {
          return 'review'
        }
        if (prev === 'review' && data.proposals.length === 0 && criba.entries.length > 0) {
          return 'criba'
        }
        if (criba.entries.length > 0 && data.proposals.length === 0) return 'criba'
        return prev
      })

      if (data.proposals.length === 0 && criba.entries.length === 0) {
        setActiveId(null)
        onEmpty()
      } else if (data.proposals.length === 0) {
        setActiveId(null)
      } else {
        setActiveId((prev) =>
          prev && data.proposals.some((p) => p.id === prev)
            ? prev
            : data.proposals[0]!.id,
        )
      }

      setDraftTs((prev) => {
        const next = { ...prev }
        for (const p of data.proposals) {
          if (!next[p.id]) next[p.id] = toDatetimeLocal(p.timestamp_exact)
        }
        return next
      })

      setDraftTitles((prev) => {
        const next: Record<string, string> = {}
        for (const p of data.proposals) {
          next[p.id] = prev[p.id] !== undefined ? prev[p.id]! : p.title
        }
        return next
      })

      setDraftQuantomos((prev) => {
        const next = { ...prev }
        for (const p of data.proposals) {
          for (const q of p.quantomos) {
            if (!next[q.id]) {
              next[q.id] = { title: q.title, content: q.content ?? '' }
            }
          }
        }
        return next
      })

      setDraftTasks((prev) => {
        const next = { ...prev }
        for (const p of data.proposals) {
          for (const t of p.tasks) {
            if (!next[t.id]) {
              next[t.id] = { task_text: t.task_text, tag: t.tag ?? '' }
            }
          }
        }
        return next
      })

      setDraftEntities((prev) => {
        const next = { ...prev }
        for (const p of data.proposals) {
          for (const e of p.entities ?? []) {
            if (!next[e.id]) next[e.id] = { name: e.name }
          }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar aduana')
    } finally {
      setLoading(false)
      proposalsInFlight.current = false
    }
  }, [onEmpty])

  useEffect(() => {
    void loadProposals()
  }, [loadProposals, refreshKey])

  useEffect(() => {
    const id = window.setInterval(() => void loadProposals(), 5000)
    return () => window.clearInterval(id)
  }, [loadProposals])

  const active = proposals.find((p) => p.id === activeId) ?? null

  function setQuantomoField(
    id: string,
    field: 'title' | 'content',
    value: string,
  ) {
    setDraftQuantomos((d) => ({
      ...d,
      [id]: { ...(d[id] ?? { title: '', content: '' }), [field]: value },
    }))
  }

  function setTaskField(
    id: string,
    field: 'task_text' | 'tag',
    value: string,
  ) {
    setDraftTasks((d) => ({
      ...d,
      [id]: { ...(d[id] ?? { task_text: '', tag: '' }), [field]: value },
    }))
  }

  function markItem(id: string, status: 'accepted' | 'rejected' | 'pending') {
    setItemStatus((s) => ({ ...s, [id]: status }))
  }

  async function approveAll() {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      if (draftTs[active.id]) {
        await api.updateTimestamp(
          active.id,
          fromDatetimeLocal(draftTs[active.id]!),
        )
      }

      const rejectQuantomoIds = active.quantomos
        .filter((q) => itemStatus[q.id] === 'rejected')
        .map((q) => q.id)
      const rejectTaskIds = active.tasks
        .filter((t) => itemStatus[t.id] === 'rejected')
        .map((t) => t.id)
      const entities = active.entities ?? []
      const rejectEntityIds = entities
        .filter((e) => itemStatus[e.id] === 'rejected')
        .map((e) => e.id)

      await api.approve(active.id, {
        title: draftTitles[active.id]?.trim() || active.title,
        rejectQuantomoIds,
        rejectTaskIds,
        rejectEntityIds,
        quantomos: active.quantomos
          .filter((q) => itemStatus[q.id] !== 'rejected')
          .map((q) => ({
            id: q.id,
            title: draftQuantomos[q.id]?.title ?? q.title,
            content: draftQuantomos[q.id]?.content ?? q.content ?? '',
          })),
        tasks: active.tasks
          .filter((t) => itemStatus[t.id] !== 'rejected')
          .map((t) => ({
            id: t.id,
            task_text: draftTasks[t.id]?.task_text ?? t.task_text,
            tag: draftTasks[t.id]?.tag ?? t.tag ?? '',
          })),
        entities: entities
          .filter((e) => itemStatus[e.id] !== 'rejected')
          .map((e) => ({
            id: e.id,
            name: draftEntities[e.id]?.name ?? e.name,
          })),
      })
      onChanged()
      await loadProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al aprobar')
    } finally {
      setBusy(false)
    }
  }

  async function rejectAll() {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      await api.reject(active.id)
      onChanged()
      await loadProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al descartar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel customs customs-active">
      <header className="customs-toolbar">
        <div className="customs-toolbar-left">
          <h2>Aduana</h2>
          <div className="criba-stage-tabs aduana-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'criba'}
              className={tab === 'criba' ? 'criba-stage-tab is-active' : 'criba-stage-tab'}
              onClick={() => setTab('criba')}
            >
              Criba {cribaCount > 0 ? `(${cribaCount})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'review'}
              className={tab === 'review' ? 'criba-stage-tab is-active' : 'criba-stage-tab'}
              onClick={() => setTab('review')}
            >
              Validación {proposals.length > 0 ? `(${proposals.length})` : ''}
            </button>
          </div>
          {tab === 'review' && proposals.length > 1 && (
            <nav className="aduana-rail" aria-label="Audios pendientes">
              {proposals.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    p.id === activeId
                      ? 'aduana-rail-item is-active'
                      : 'aduana-rail-item'
                  }
                  onClick={() => setActiveId(p.id)}
                >
                  <span className="truncate">
                    {draftTitles[p.id] ?? p.title}
                  </span>
                </button>
              ))}
            </nav>
          )}
        </div>
        {tab === 'review' && (
          <div className="customs-toolbar-right">
            <button
              type="button"
              className="btn btn-ghost danger"
              disabled={!active || busy}
              onClick={() => void rejectAll()}
            >
              Descartar
            </button>
            <button
              type="button"
              className="btn btn-primary btn-approve-sticky"
              disabled={!active || busy}
              onClick={() => void approveAll()}
            >
              Aprobar
            </button>
          </div>
        )}
      </header>

      {error && <p className="status-line err">{error}</p>}

      {tab === 'criba' ? (
        <AudioCribaPanel refreshKey={refreshKey} onChanged={onChanged} />
      ) : (
        <>
          {loading && !active && (
            <p className="muted empty">Cargando validación…</p>
          )}

          {!loading && !active && (
            <p className="muted empty mono">
              Sin pendientes de validación. Tras puntuar en Criba, acá aparecen
              quántomos y entidades para el corpus.
            </p>
          )}

          {active && (
            <div className="aduana-split">
              <aside className="aduana-transcript">
                <h3>Transcripción</h3>
                <label className="field">
                  <span className="field-label-row">
                    <span>Nombre</span>
                    {active.original_filename ? (
                      <span
                        className="og-filename"
                        title={active.original_filename}
                      >
                        (og: &quot;{active.original_filename}&quot;)
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="text"
                    className="title-input"
                    value={draftTitles[active.id] ?? active.title}
                    onChange={(e) =>
                      setDraftTitles((d) => ({
                        ...d,
                        [active.id]: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Fecha y hora</span>
                  <input
                    type="datetime-local"
                    value={draftTs[active.id] ?? ''}
                    onChange={(e) =>
                      setDraftTs((d) => ({ ...d, [active.id]: e.target.value }))
                    }
                  />
                </label>
                <pre className="transcript transcript-full">
                  {active.content_raw || '—'}
                </pre>
              </aside>

              <div className="aduana-processed">
                <div className="block">
                  <h4>Quántomos</h4>
                  {active.quantomos.length === 0 ? (
                    <p className="muted">Ninguno</p>
                  ) : (
                    <ul className="item-edit-list">
                      {active.quantomos.map((q) => {
                        const st = itemStatus[q.id] ?? 'pending'
                        const draft = draftQuantomos[q.id] ?? {
                          title: q.title,
                          content: q.content ?? '',
                        }
                        return (
                          <li
                            key={q.id}
                            className={`item-edit ${st !== 'pending' ? `is-${st}` : ''}`}
                          >
                            <input
                              className="item-title-input"
                              value={draft.title}
                              onChange={(e) =>
                                setQuantomoField(q.id, 'title', e.target.value)
                              }
                              disabled={st === 'rejected'}
                            />
                            <textarea
                              className="item-body-input"
                              value={draft.content}
                              rows={3}
                              onChange={(e) =>
                                setQuantomoField(q.id, 'content', e.target.value)
                              }
                              disabled={st === 'rejected'}
                            />
                            <div className="item-actions">
                              <span className="mono muted">
                                peso {q.hermetic_weight ?? '—'}
                                {q.universe ? ` · ${q.universe}` : ''}
                              </span>
                              <div className="item-actions-btns">
                                <button
                                  type="button"
                                  className="btn btn-tiny"
                                  disabled={st === 'accepted'}
                                  onClick={() => markItem(q.id, 'accepted')}
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-tiny danger-text"
                                  disabled={st === 'rejected'}
                                  onClick={() => markItem(q.id, 'rejected')}
                                >
                                  Descartar
                                </button>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="block">
                  <h4>Entidades</h4>
                  {(active.entities ?? []).length === 0 ? (
                    <p className="muted">Ninguna</p>
                  ) : (
                    <ul className="item-edit-list">
                      {(active.entities ?? []).map((e) => {
                        const st = itemStatus[e.id] ?? 'pending'
                        const draft = draftEntities[e.id] ?? { name: e.name }
                        return (
                          <li
                            key={e.id}
                            className={`item-edit ${st !== 'pending' ? `is-${st}` : ''}`}
                          >
                            <div className="task-edit-row">
                              <span className="badge">{entityTypeLabel(e.type)}</span>
                              <input
                                className="item-title-input"
                                value={draft.name}
                                onChange={(ev) =>
                                  setDraftEntities((d) => ({
                                    ...d,
                                    [e.id]: { name: ev.target.value },
                                  }))
                                }
                                disabled={st === 'rejected'}
                              />
                            </div>
                            <div className="item-actions">
                              <span />
                              <div className="item-actions-btns">
                                <button
                                  type="button"
                                  className="btn btn-tiny"
                                  disabled={st === 'accepted'}
                                  onClick={() => markItem(e.id, 'accepted')}
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-tiny danger-text"
                                  disabled={st === 'rejected'}
                                  onClick={() => markItem(e.id, 'rejected')}
                                >
                                  Descartar
                                </button>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="block">
                  <h4>Tareas sugeridas</h4>
                  {active.tasks.length === 0 ? (
                    <p className="muted">Ninguna</p>
                  ) : (
                    <ul className="item-edit-list">
                      {active.tasks.map((t) => {
                        const st = itemStatus[t.id] ?? 'pending'
                        const draft = draftTasks[t.id] ?? {
                          task_text: t.task_text,
                          tag: t.tag ?? '',
                        }
                        return (
                          <li
                            key={t.id}
                            className={`item-edit ${st !== 'pending' ? `is-${st}` : ''}`}
                          >
                            <div className="task-edit-row">
                              <input
                                className="item-tag-input"
                                value={draft.tag}
                                placeholder="tag"
                                onChange={(e) =>
                                  setTaskField(t.id, 'tag', e.target.value)
                                }
                                disabled={st === 'rejected'}
                              />
                              <input
                                className="item-title-input"
                                value={draft.task_text}
                                onChange={(e) =>
                                  setTaskField(t.id, 'task_text', e.target.value)
                                }
                                disabled={st === 'rejected'}
                              />
                            </div>
                            <div className="item-actions">
                              <span />
                              <div className="item-actions-btns">
                                <button
                                  type="button"
                                  className="btn btn-tiny"
                                  disabled={st === 'accepted'}
                                  onClick={() => markItem(t.id, 'accepted')}
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-tiny danger-text"
                                  disabled={st === 'rejected'}
                                  onClick={() => markItem(t.id, 'rejected')}
                                >
                                  Descartar
                                </button>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
