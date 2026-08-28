import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ProviderConfigResponse } from '../../services/api'
import type {
  SentinelAgent,
  SentinelEvent,
  SentinelMessage,
  SentinelMission,
  SentinelSkill,
} from '../../types'
import { SentinelMarkdown } from './SentinelMarkdown'

type Tab = 'perfil' | 'chat' | 'skills' | 'log'

const TABS: { id: Tab; label: string }[] = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'chat', label: 'Chat' },
  { id: 'skills', label: 'Skills' },
  { id: 'log', label: 'Log' },
]

function agentLabel(a: Pick<SentinelAgent, 'code' | 'name'>): string {
  return (a.name || '').trim() || a.code
}

function statusDotClass(status: string): string {
  if (status === 'error') return 'sentinel-dot is-error'
  if (status === 'ready') return 'sentinel-dot is-ready'
  if (status === 'paused') return 'sentinel-dot is-paused'
  if (status === 'inspecting' || status === 'running' || status === 'pending') {
    return 'sentinel-dot is-live animate-pulse'
  }
  return 'sentinel-dot'
}

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
  const [brainCfg, setBrainCfg] = useState<ProviderConfigResponse | null>(null)
  const [brainSaving, setBrainSaving] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
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

  const loadBrain = useCallback(async () => {
    try {
      const cfg = await api.getProviderConfig()
      setBrainCfg(cfg)
    } catch {
      /* Config puede fallar sin tumbar Sentinela */
    }
  }, [])

  useEffect(() => {
    void loadList()
    void loadBrain()
  }, [loadList, loadBrain, refreshKey])

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

  const sentinelCatalog = brainCfg?.catalog.find((c) => c.slot === 'llm_sentinel')
  const brainProvider = brainCfg?.provider.llm_sentinel ?? ''
  const brainModel = brainCfg?.model.llm_sentinel ?? ''
  const brainProv = sentinelCatalog?.providers.find((p) => p.id === brainProvider)
  const brainModels = brainProv?.models ?? []

  const saveBrain = async (patch: {
    provider?: string
    model?: string
  }) => {
    if (!brainCfg || brainSaving) return
    setBrainSaving(true)
    setError(null)
    try {
      const nextProvider = patch.provider ?? brainProvider
      const entry = brainCfg.catalog.find((c) => c.slot === 'llm_sentinel')
      const prov = entry?.providers.find((p) => p.id === nextProvider)
      const nextModel =
        patch.model ??
        (prov?.models.some((m) => m.id === brainModel)
          ? brainModel
          : prov?.models[0]?.id ?? brainModel)
      const res = await api.putProviderConfig({
        provider: { llm_sentinel: nextProvider },
        model: { llm_sentinel: nextModel },
      })
      setBrainCfg(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBrainSaving(false)
    }
  }

  useEffect(() => {
    if (!agent) {
      setNameDraft('')
      return
    }
    if (document.activeElement === nameInputRef.current) return
    setNameDraft(agentLabel(agent))
  }, [agent])

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

  const saveName = async () => {
    if (!selectedId || !agent) return
    const next = nameDraft.replace(/\s+/g, ' ').trim()
    if (!next || next === agentLabel(agent)) {
      setNameDraft(agentLabel(agent))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { agent: updated } = await api.renameSentinelAgent(selectedId, next)
      setAgent(updated)
      setNameDraft(agentLabel(updated))
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setNameDraft(agentLabel(agent))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, label: string) => {
    if (
      !window.confirm(
        `¿Borrar ${label}? Se van misiones, skills y logs de esta instancia.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.deleteSentinelAgent(id)
      const data = await api.listSentinelAgents()
      setAgents(data.agents)
      if (selectedId === id) {
        const nextId = data.agents[0]?.id ?? null
        setSelectedId(nextId)
        if (!nextId) setAgent(null)
      }
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
      <aside className="sentinel-rail">
        <div className="sentinel-rail-head">
          <div>
            <p className="sentinel-kicker">Módulo</p>
            <h2>Sentinela</h2>
          </div>
          <button
            type="button"
            className="sentinel-btn"
            disabled={busy}
            onClick={() => void create()}
          >
            + Nueva
          </button>
        </div>

        {sentinelCatalog && (
          <div className="sentinel-engine">
            <p className="sentinel-kicker">Motor de Inferencia</p>
            <label className="sentinel-select-wrap">
              <span>Proveedor</span>
              <select
                className="sentinel-select"
                value={brainProvider}
                disabled={brainSaving || busy}
                onChange={(e) => void saveBrain({ provider: e.target.value })}
                aria-label="Proveedor del motor de inferencia"
              >
                {sentinelCatalog.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sentinel-select-wrap">
              <span>Modelo</span>
              <select
                className="sentinel-select"
                value={brainModel}
                disabled={brainSaving || busy || brainModels.length === 0}
                onChange={(e) => void saveBrain({ model: e.target.value })}
                aria-label="Modelo del motor de inferencia"
              >
                {brainModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="sentinel-engine-live">
              En uso: {brainProv?.label || brainProvider || '—'} ·{' '}
              {brainModels.find((m) => m.id === brainModel)?.label ||
                brainModel ||
                '—'}
            </p>
            <p className="sentinel-engine-hint">
              Perfil y misiones van a este motor. Cohere queda para embeddings
              (si no hay créditos, Mnemosyne se pausa y el chat sigue).
            </p>
          </div>
        )}

        <ul className="sentinel-agent-list">
          {agents.map((a) => (
            <li key={a.id} className="sentinel-rail-item">
              <button
                type="button"
                className={
                  a.id === selectedId
                    ? 'sentinel-agent-card is-active'
                    : 'sentinel-agent-card'
                }
                onClick={() => setSelectedId(a.id)}
              >
                <span className="sentinel-agent-card-top">
                  <span
                    className={statusDotClass(a.status)}
                    aria-hidden
                  />
                  <span className="sentinel-agent-name">{agentLabel(a)}</span>
                </span>
                <span className="sentinel-agent-meta">
                  {a.status}
                  {agentLabel(a) !== a.code ? ` · ${a.code}` : ''}
                </span>
              </button>
              <button
                type="button"
                className="sentinel-rail-del"
                disabled={busy}
                aria-label={`Borrar ${agentLabel(a)}`}
                title="Borrar"
                onClick={() => void remove(a.id, agentLabel(a))}
              >
                ×
              </button>
            </li>
          ))}
          {agents.length === 0 && (
            <li className="sentinel-empty-rail">
              Todavía no hay instancias. Creá una para que inspeccione el
              organismo.
            </li>
          )}
        </ul>
      </aside>

      <section className="sentinel-main">
        {!agent ? (
          <div className="sentinel-placeholder">
            <p className="sentinel-kicker">Standby</p>
            <p>Creá una sentinela. Al nacer inspecciona producto y código.</p>
            <p className="sentinel-placeholder-muted">
              Después le das comandos escritos. Podés pausar y cambiar
              instrucciones a mitad de misión. El motor de inferencia se elige
              en el riel o en Configuración.
            </p>
          </div>
        ) : (
          <>
            <header className="sentinel-head">
              <div className="sentinel-head-row">
                <div className="sentinel-identity">
                  <p className="sentinel-kicker">Instancia</p>
                  <input
                    ref={nameInputRef}
                    className="sentinel-name-input"
                    value={nameDraft}
                    maxLength={80}
                    disabled={busy}
                    aria-label="Nombre de la sentinela"
                    title="Enter o clic afuera para guardar"
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => void saveName()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                      }
                      if (e.key === 'Escape') {
                        setNameDraft(agentLabel(agent))
                        e.currentTarget.blur()
                      }
                    }}
                  />
                  {agentLabel(agent) !== agent.code && (
                    <span className="sentinel-code-hint">{agent.code}</span>
                  )}
                </div>
                <div className="sentinel-head-actions">
                  <span
                    className={`sentinel-badge is-${agent.status}`}
                  >
                    <span
                      className={statusDotClass(agent.status)}
                      aria-hidden
                    />
                    {agent.status}
                  </span>
                  {currentMission && (
                    <span
                      className={`sentinel-badge is-${currentMission.status}`}
                    >
                      misión · {currentMission.status}
                    </span>
                  )}
                  {agent.status === 'inspecting' && (
                    <button
                      type="button"
                      className="sentinel-btn"
                      disabled={busy}
                      onClick={() => void abort()}
                    >
                      Abortar
                    </button>
                  )}
                  {currentMission?.status === 'running' && (
                    <button
                      type="button"
                      className="sentinel-btn"
                      disabled={busy}
                      onClick={() => void pause()}
                    >
                      Pausar
                    </button>
                  )}
                  {currentMission?.status === 'paused' && (
                    <button
                      type="button"
                      className="sentinel-btn"
                      disabled={busy}
                      onClick={() => void resume()}
                    >
                      Reanudar
                    </button>
                  )}
                  <button
                    type="button"
                    className="sentinel-btn is-danger"
                    disabled={busy}
                    onClick={() => void remove(agent.id, agentLabel(agent))}
                  >
                    Borrar
                  </button>
                </div>
              </div>
              <div className="sentinel-tabs" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={
                      tab === t.id ? 'sentinel-tab is-active' : 'sentinel-tab'
                    }
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </header>

            {error && <p className="sentinel-error">{error}</p>}

            {tab === 'perfil' && (
              <div className="sentinel-panel">
                <div className="sentinel-read mx-auto max-w-3xl">
                  {agent.profile_md ? (
                    <SentinelMarkdown>{agent.profile_md}</SentinelMarkdown>
                  ) : (
                    <p className="sentinel-idle">
                      {agent.status === 'inspecting'
                        ? 'Inspeccionando producto y código…'
                        : '(sin perfil)'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'chat' && (
              <>
                {currentMission?.status === 'paused' && (
                  <div className="sentinel-instructions">
                    <label>
                      Instrucciones (editables al pausar)
                      <textarea
                        rows={3}
                        value={instructionsEdit}
                        onChange={(e) => setInstructionsEdit(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="sentinel-btn"
                      disabled={busy}
                      onClick={() => void saveInstructions()}
                    >
                      Guardar instrucciones
                    </button>
                  </div>
                )}
                <div className="sentinel-log">
                  <div className="sentinel-read mx-auto max-w-3xl">
                    {visibleMessages.map((m) => (
                      <article
                        key={m.id}
                        className={
                          m.role === 'user'
                            ? 'sentinel-bubble is-user'
                            : 'sentinel-bubble is-assistant'
                        }
                      >
                        <span className="sentinel-bubble-role">
                          {m.role === 'user' ? 'operador' : agentLabel(agent)}
                        </span>
                        {m.role === 'assistant' ? (
                          <SentinelMarkdown>{m.content}</SentinelMarkdown>
                        ) : (
                          <p className="sentinel-bubble-plain">{m.content}</p>
                        )}
                      </article>
                    ))}
                    {visibleMessages.length === 0 && (
                      <p className="sentinel-idle">
                        Escribí un comando. La misión usa el perfil + RAG + tools
                        allowlist.
                      </p>
                    )}
                    <div ref={bottomRef} />
                  </div>
                </div>
              </>
            )}

            {tab === 'skills' && (
              <div className="sentinel-panel">
                <div className="sentinel-read mx-auto max-w-3xl">
                  {skills.length === 0 && (
                    <p className="sentinel-idle">
                      Todavía no propuso funciones propias.
                    </p>
                  )}
                  <ul className="sentinel-skill-list">
                    {skills.map((s) => (
                      <li key={s.id} className="sentinel-skill">
                        <header>
                          <strong>{s.name}</strong>
                          <span className={`sentinel-badge is-${s.status}`}>
                            {s.status}
                          </span>
                        </header>
                        <dl className="sentinel-ipo">
                          <div>
                            <dt>in</dt>
                            <dd>{s.input || '—'}</dd>
                          </div>
                          <div>
                            <dt>proc</dt>
                            <dd>{s.processing || '—'}</dd>
                          </div>
                          <div>
                            <dt>out</dt>
                            <dd>{s.output || '—'}</dd>
                          </div>
                        </dl>
                        {s.status === 'draft' && (
                          <div className="sentinel-skill-actions">
                            <label className="font-mono">
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
                              className="sentinel-btn"
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
                              className="sentinel-btn is-danger"
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
              </div>
            )}

            {tab === 'log' && (
              <div className="sentinel-panel sentinel-events">
                <div className="sentinel-read mx-auto max-w-3xl">
                  {events.map((e) => (
                    <article key={e.id} className="sentinel-event">
                      <span className="sentinel-event-meta">
                        {e.kind} ·{' '}
                        {new Date(e.created_at).toLocaleTimeString('es-ES')}
                      </span>
                      <pre>{e.payload}</pre>
                    </article>
                  ))}
                  {events.length === 0 && (
                    <p className="sentinel-idle">Sin eventos todavía.</p>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
            )}

            <form
              className="sentinel-composer"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <div className="sentinel-composer-inner mx-auto max-w-3xl">
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
                  className="sentinel-btn is-accent"
                  disabled={
                    busy ||
                    !draft.trim() ||
                    agent.status === 'inspecting' ||
                    currentMission?.status === 'running'
                  }
                >
                  Enviar
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
