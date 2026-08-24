import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../services/api'
import type {
  SentinelAgent,
  SentinelEvent,
  SentinelMessage,
  SentinelMission,
  SentinelSkill,
} from '../../types'

type Tab = 'perfil' | 'chat' | 'skills' | 'log'

interface Props {
  refreshKey: number
}

export function SentinelSection({ refreshKey }: Props) {
  const [agents, setAgents] = useState<SentinelAgent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agent, setAgent] = useState<SentinelAgent | null>(null)
  const [missions, setMissions] = useState<SentinelMission[]>([])
  const [messages, setMessages] = useState<SentinelMessage[]>([])
  const [events, setEvents] = useState<SentinelEvent[]>([])
  const [skills, setSkills] = useState<SentinelSkill[]>([])
  const [tab, setTab] = useState<Tab>('perfil')
  const [draft, setDraft] = useState('')
  const [expected, setExpected] = useState('')
  const [instructionsEdit, setInstructionsEdit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skillWeight, setSkillWeight] = useState(7)
  const bottomRef = useRef<HTMLDivElement>(null)

  const currentMission = missions[0] ?? null

  const loadList = useCallback(async () => {
    try {
      const data = await api.listSentinelAgents()
      setAgents(data.agents)
      setSelectedId((prev) => prev ?? data.agents[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await api.getSentinelAgent(id)
      setAgent(data.agent)
      setMissions(data.missions)
      setMessages(data.messages)
      setEvents(data.events)
      setSkills(data.skills)
      const latest = data.missions[0]
      if (latest) setInstructionsEdit(latest.instructions)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList, refreshKey])

  useEffect(() => {
    if (!selectedId) {
      setAgent(null)
      setMissions([])
      setMessages([])
      setEvents([])
      setSkills([])
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const hot =
    agent?.status === 'inspecting' ||
    agent?.status === 'running' ||
    currentMission?.status === 'running' ||
    currentMission?.status === 'pending'

  useEffect(() => {
    if (!selectedId || !hot) return
    const t = window.setInterval(() => void loadDetail(selectedId), 1500)
    return () => window.clearInterval(t)
  }, [selectedId, hot, loadDetail])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, events.length])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { agent: created } = await api.createSentinelAgent()
      await loadList()
      setSelectedId(created.id)
      setTab('perfil')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const abort = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api.abortSentinelInspect(selectedId)
      await loadDetail(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!selectedId || !text || busy) return
    setBusy(true)
    setError(null)
    setDraft('')
    try {
      if (
        !currentMission ||
        currentMission.status === 'done' ||
        currentMission.status === 'error'
      ) {
        await api.createSentinelMission(selectedId, {
          instructions: text,
          expected_output: expected.trim() || undefined,
        })
      } else {
        await api.postSentinelMissionMessage(currentMission.id, text)
      }
      setTab('chat')
      await loadDetail(selectedId)
    } catch (err) {
      setDraft(text)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pause = async () => {
    if (!currentMission) return
    setBusy(true)
    try {
      await api.pauseSentinelMission(currentMission.id)
      await loadDetail(selectedId!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resume = async () => {
    if (!currentMission) return
    setBusy(true)
    try {
      await api.resumeSentinelMission(currentMission.id)
      await loadDetail(selectedId!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveInstructions = async () => {
    if (!currentMission) return
    setBusy(true)
    try {
      await api.patchSentinelMission(currentMission.id, {
        instructions: instructionsEdit,
        expected_output: expected,
      })
      await loadDetail(selectedId!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    [messages],
  )

  return (
    <div className="dialogo-stage sentinel-stage">
      <aside className="dialogo-rail">
        <div className="dialogo-rail-head">
          <h2>Sentinela</h2>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy}
            onClick={() => void create()}
          >
            + Nueva
          </button>
        </div>
        <ul className="dialogo-thread-list">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={
                  a.id === selectedId
                    ? 'dialogo-thread-item is-active'
                    : 'dialogo-thread-item'
                }
                onClick={() => setSelectedId(a.id)}
              >
                <span className="dialogo-thread-title">{a.code}</span>
                <span className="muted mono dialogo-thread-meta">
                  {a.status}
                </span>
              </button>
            </li>
          ))}
          {agents.length === 0 && (
            <li className="muted dialogo-empty">
              Todavía no hay instancias. Creá una para que inspeccione el
              organismo.
            </li>
          )}
        </ul>
      </aside>

      <section className="dialogo-main">
        {!agent ? (
          <div className="dialogo-placeholder">
            <p>Creá una sentinela. Al nacer inspecciona producto y código.</p>
            <p className="muted">
              Después le das comandos escritos. Podés pausar y cambiar
              instrucciones a mitad de misión.
            </p>
          </div>
        ) : (
          <>
            <header className="dialogo-main-head sentinel-head">
              <div className="sentinel-head-row">
                <h3>{agent.code}</h3>
                <span className={`sentinel-pill is-${agent.status}`}>
                  {agent.status}
                </span>
                {agent.status === 'inspecting' && (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void abort()}
                  >
                    Abortar
                  </button>
                )}
                {currentMission?.status === 'running' && (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void pause()}
                  >
                    Pausar
                  </button>
                )}
                {currentMission?.status === 'paused' && (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void resume()}
                  >
                    Reanudar
                  </button>
                )}
              </div>
              <div className="sentinel-tabs" role="tablist">
                {(['perfil', 'chat', 'skills', 'log'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    className={tab === t ? 'sentinel-tab is-active' : 'sentinel-tab'}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </header>

            {error && <p className="dialogo-error">{error}</p>}

            {tab === 'perfil' && (
              <div className="sentinel-panel">
                <pre className="sentinel-profile">
                  {agent.profile_md ||
                    (agent.status === 'inspecting'
                      ? 'Inspeccionando producto y código…'
                      : '(sin perfil)')}
                </pre>
              </div>
            )}

            {tab === 'chat' && (
              <>
                {currentMission?.status === 'paused' && (
                  <div className="sentinel-instructions">
                    <label className="muted">
                      Instrucciones (editables al pausar)
                      <textarea
                        rows={3}
                        value={instructionsEdit}
                        onChange={(e) => setInstructionsEdit(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={busy}
                      onClick={() => void saveInstructions()}
                    >
                      Guardar instrucciones
                    </button>
                  </div>
                )}
                <div className="dialogo-messages sentinel-log">
                  {visibleMessages.map((m) => (
                    <article
                      key={m.id}
                      className={
                        m.role === 'user'
                          ? 'dialogo-bubble is-user'
                          : 'dialogo-bubble is-assistant'
                      }
                    >
                      <span className="dialogo-bubble-role">
                        {m.role === 'user' ? 'vos' : agent.code}
                      </span>
                      <div className="dialogo-bubble-body">{m.content}</div>
                    </article>
                  ))}
                  {visibleMessages.length === 0 && (
                    <p className="muted">
                      Escribí un comando. La misión usa el perfil + RAG + tools
                      allowlist.
                    </p>
                  )}
                  <div ref={bottomRef} />
                </div>
              </>
            )}

            {tab === 'skills' && (
              <div className="sentinel-panel">
                {skills.length === 0 && (
                  <p className="muted">Todavía no propuso funciones propias.</p>
                )}
                <ul className="sentinel-skill-list">
                  {skills.map((s) => (
                    <li key={s.id} className="sentinel-skill">
                      <header>
                        <strong>{s.name}</strong>
                        <span className="muted mono">{s.status}</span>
                      </header>
                      <p className="muted">
                        in: {s.input || '—'}
                        <br />
                        proc: {s.processing || '—'}
                        <br />
                        out: {s.output || '—'}
                      </p>
                      {s.status === 'draft' && (
                        <div className="sentinel-skill-actions">
                          <label className="mono">
                            1–12
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={skillWeight}
                              onChange={(e) =>
                                setSkillWeight(
                                  Math.max(
                                    1,
                                    Math.min(12, Number(e.target.value) || 1),
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={busy}
                            onClick={() => {
                              void (async () => {
                                setBusy(true)
                                try {
                                  await api.acceptSentinelSkill(s.id, {
                                    weight: skillWeight,
                                    promote_ida: skillWeight >= 8,
                                  })
                                  await loadDetail(selectedId!)
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : String(err),
                                  )
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }}
                          >
                            Aceptar
                          </button>
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={busy}
                            onClick={() => {
                              void (async () => {
                                setBusy(true)
                                try {
                                  await api.rejectSentinelSkill(s.id)
                                  await loadDetail(selectedId!)
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : String(err),
                                  )
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }}
                          >
                            Rechazar
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'log' && (
              <div className="sentinel-panel sentinel-events">
                {events.map((e) => (
                  <article key={e.id} className="sentinel-event">
                    <span className="mono muted">
                      {e.kind} · {new Date(e.created_at).toLocaleTimeString('es-ES')}
                    </span>
                    <pre>{e.payload}</pre>
                  </article>
                ))}
                <div ref={bottomRef} />
              </div>
            )}

            <form
              className="dialogo-composer sentinel-composer"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <input
                type="text"
                className="sentinel-expected"
                placeholder="Output esperado (opcional)"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                disabled={busy || agent.status === 'inspecting'}
              />
              <textarea
                rows={3}
                placeholder={
                  agent.status === 'inspecting'
                    ? 'Esperá a que termine la inspección…'
                    : currentMission?.status === 'running'
                      ? 'Pausá para mandar otro comando…'
                      : 'Comando / misión…'
                }
                value={draft}
                disabled={
                  busy ||
                  agent.status === 'inspecting' ||
                  currentMission?.status === 'running'
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="submit"
                className="btn btn-tiny"
                disabled={
                  busy ||
                  !draft.trim() ||
                  agent.status === 'inspecting' ||
                  currentMission?.status === 'running'
                }
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
