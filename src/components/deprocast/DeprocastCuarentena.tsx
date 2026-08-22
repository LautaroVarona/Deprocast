import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type {
  DeproResearchFinding,
  DeproResearchFindingStatus,
  DeproResearchPack,
} from '../../types'
import { AGENT_BY_ID } from '../../lib/deprocast'

const SEARCHERS = [
  'explorador',
  'explorador-academico',
  'explorador-mercado',
] as const

type FindingFilter = 'pending' | 'all' | 'assimilated'

type Props = {
  onChanged: () => void
}

function statusLabel(s: DeproResearchFindingStatus): string {
  switch (s) {
    case 'assimilated':
      return 'asimilado'
    case 'fractalized':
      return 'fractalizado'
    case 'discarded':
      return 'descartado'
    default:
      return 'pendiente'
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function DeprocastCuarentena({ onChanged }: Props) {
  const [topic, setTopic] = useState('')
  const [agentId, setAgentId] = useState<string>('explorador')
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [payload, setPayload] = useState('')
  const [parentFindingId, setParentFindingId] = useState<string | null>(null)
  const [parentPackId, setParentPackId] = useState<string | null>(null)
  const [packs, setPacks] = useState<DeproResearchPack[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [findings, setFindings] = useState<DeproResearchFinding[]>([])
  const [selectedPack, setSelectedPack] = useState<DeproResearchPack | null>(
    null,
  )
  const [selectedFinding, setSelectedFinding] =
    useState<DeproResearchFinding | null>(null)
  const [filter, setFilter] = useState<FindingFilter>('pending')
  const [showDiscarded, setShowDiscarded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshPacks = useCallback(async () => {
    const res = await api.deprocastListResearchPacks()
    setPacks(res.packs ?? [])
  }, [])

  const loadPack = useCallback(async (id: string) => {
    const res = await api.deprocastGetResearchPack(id)
    setSelectedPack(res.pack)
    setFindings(res.findings ?? [])
    setSelectedId(res.pack.id)
    setSelectedFinding(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void refreshPacks().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Error al listar')
      }
    })
    return () => {
      cancelled = true
    }
  }, [refreshPacks])

  const hasMatrix = useMemo(
    () =>
      findings.some(
        (f) => f.axis_index != null && f.node_index != null,
      ),
    [findings],
  )

  const axes = useMemo(() => {
    const map = new Map<number, { title: string; nodes: DeproResearchFinding[] }>()
    for (const f of findings) {
      if (f.axis_index == null) continue
      const cur = map.get(f.axis_index) ?? {
        title: f.axis_title ?? `Eje ${f.axis_index + 1}`,
        nodes: [],
      }
      if (f.axis_title) cur.title = f.axis_title
      cur.nodes.push(f)
      map.set(f.axis_index, cur)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, value]) => ({ index, ...value }))
  }, [findings])

  const visibleFindings = useMemo(() => {
    return findings.filter((f) => {
      if (filter === 'pending') return f.status === 'pending'
      if (filter === 'assimilated') return f.status === 'assimilated'
      if (!showDiscarded && f.status === 'discarded') return false
      return true
    })
  }, [findings, filter, showDiscarded])

  const pendingCount = findings.filter((f) => f.status === 'pending').length

  function cellFor(axisIndex: number, nodeIndex: number) {
    return findings.find(
      (f) => f.axis_index === axisIndex && f.node_index === nodeIndex,
    )
  }

  async function onGeneratePrompt() {
    const t = topic.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.deprocastResearchPrompt(t)
      setGeneratedPrompt(res.prompt)
      setParentFindingId(null)
      setParentPackId(null)
      const ok = await copyText(res.prompt)
      setNotice(
        ok
          ? 'Prompt copiado. Pegalo en Perplexity y después volvé con el JSON.'
          : 'Prompt listo — copialo manualmente (clipboard no disponible).',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar')
    } finally {
      setBusy(false)
    }
  }

  async function onIngest() {
    if (!payload.trim() || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.deprocastResearchIngest({
        payload,
        agent_id: agentId,
        prompt_key: agentId,
        parent_finding_id: parentFindingId,
        parent_pack_id: parentPackId,
      })
      setPayload('')
      setParentFindingId(null)
      setParentPackId(null)
      await refreshPacks()
      await loadPack(res.pack.id)
      setNotice(
        `Pack listo: ${res.findings.length} nodos en cuarentena (${res.pack.origin}).`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar')
    } finally {
      setBusy(false)
    }
  }

  async function onAssimilate(id: string) {
    setBusy(true)
    setError(null)
    try {
      await api.deprocastAssimilateFinding(id)
      if (selectedId) await loadPack(selectedId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asimilar')
    } finally {
      setBusy(false)
    }
  }

  async function onDiscard(id: string) {
    setBusy(true)
    setError(null)
    try {
      await api.deprocastDiscardFinding(id)
      if (selectedId) await loadPack(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar')
    } finally {
      setBusy(false)
    }
  }

  async function onFractalize(id: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.deprocastFractalizeFinding(id)
      setTopic(res.topic)
      setGeneratedPrompt(res.prompt)
      setParentFindingId(res.parent_finding_id)
      setParentPackId(res.parent_pack_id)
      const ok = await copyText(res.prompt)
      setNotice(
        ok
          ? 'Fractal: prompt copiado. Pegalo en Perplexity y después inyectá el JSON.'
          : 'Fractal: prompt listo para copiar.',
      )
      if (selectedId) await loadPack(selectedId)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo fractalizar')
    } finally {
      setBusy(false)
    }
  }

  async function onAssimilatePending() {
    if (!selectedId || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deprocastAssimilatePending(selectedId)
      await loadPack(selectedId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asimilar el lote')
    } finally {
      setBusy(false)
    }
  }

  async function onDiscardPending() {
    if (!selectedId || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deprocastDiscardPending(selectedId)
      await loadPack(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo purgar')
    } finally {
      setBusy(false)
    }
  }

  async function onDeletePack(packId: string) {
    if (busy) return
    const ok = window.confirm(
      '¿Borrar esta exploración de la bandeja? Las fichas ya asimiladas en IDA se quedan.',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.deprocastDeleteResearchPack(packId)
      if (selectedId === packId) {
        setSelectedId(null)
        setSelectedPack(null)
        setFindings([])
        setSelectedFinding(null)
      }
      await refreshPacks()
      setNotice('Exploración borrada de la bandeja.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  function renderFindingActions(f: DeproResearchFinding) {
    if (f.status !== 'pending') return null
    return (
      <div className="depro-ida-card-actions">
        <button
          type="button"
          className="btn btn-tiny"
          disabled={busy}
          onClick={() => void onAssimilate(f.id)}
        >
          Asimilar
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={busy}
          onClick={() => void onDiscard(f.id)}
        >
          Descartar
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={busy}
          onClick={() => void onFractalize(f.id)}
        >
          Fractalizar
        </button>
      </div>
    )
  }

  return (
    <div className="depro-research">
      <section className="panel depro-research-invoke">
        <header className="panel-head">
          <h2>Puente manual</h2>
          <span className="muted mono">Perplexity Pro → pegar JSON</span>
        </header>
        <p className="muted depro-lead">
          Generá el prompt, investigá en Perplexity, pegá el JSON acá. La
          cuarentena y la asimilación son las mismas; la API queda para después.
        </p>
        <label className="depro-label">
          Tema
          <textarea
            className="depro-input"
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Qué querés investigar…"
          />
        </label>
        <label className="depro-label">
          Agente
          <select
            className="depro-input"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {SEARCHERS.map((id) => (
              <option key={id} value={id}>
                {AGENT_BY_ID[id]?.name ?? id}
              </option>
            ))}
          </select>
        </label>
        <div className="depro-inspect-actions">
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy || !topic.trim()}
            onClick={() => void onGeneratePrompt()}
          >
            Generar Prompt
          </button>
          {generatedPrompt ? (
            <button
              type="button"
              className="btn btn-tiny"
              disabled={busy}
              onClick={() =>
                void copyText(generatedPrompt).then((ok) =>
                  setNotice(ok ? 'Prompt copiado.' : 'No se pudo copiar'),
                )
              }
            >
              Copiar otra vez
            </button>
          ) : null}
        </div>
        {generatedPrompt ? (
          <label className="depro-label">
            Prompt para Perplexity
            <textarea
              className="depro-input depro-research-prompt"
              rows={8}
              readOnly
              value={generatedPrompt}
            />
          </label>
        ) : null}
        {parentPackId ? (
          <p className="muted mono">
            Fractal: el próximo ingest quedará ligado al pack padre.
          </p>
        ) : null}

        <label className="depro-label">
          Pegar Payload JSON
          <textarea
            className="depro-input depro-research-payload"
            rows={10}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder='Pegá el bloque JSON de Perplexity (con o sin ```json)…'
          />
        </label>
        <div className="depro-inspect-actions">
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy || !payload.trim()}
            onClick={() => void onIngest()}
          >
            Procesar
          </button>
        </div>
        {notice ? <p className="status-line">{notice}</p> : null}
        {error ? <p className="status-line err">{error}</p> : null}
      </section>

      <div className="depro-research-layout">
        <section className="panel depro-research-packs">
          <header className="panel-head">
            <h2>Bandeja</h2>
            <span className="muted mono">{packs.length}</span>
          </header>
          <ul className="depro-ida-list">
            {packs.map((p) => (
              <li key={p.id} className="depro-research-pack-row">
                <button
                  type="button"
                  className={
                    selectedId === p.id
                      ? 'depro-research-pack is-active'
                      : 'depro-research-pack'
                  }
                  onClick={() => void loadPack(p.id)}
                >
                  <strong>{p.topic.slice(0, 80)}</strong>
                  <span className="muted mono">
                    {AGENT_BY_ID[p.agent_id]?.name ?? p.agent_id}
                    {' · '}
                    {p.origin}
                    {' · '}
                    <span
                      className={
                        p.status === 'running'
                          ? 'depro-research-pack-status is-running'
                          : p.status === 'error'
                            ? 'depro-research-pack-status is-error'
                            : 'depro-research-pack-status'
                      }
                    >
                      {p.status}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-tiny depro-research-pack-delete"
                  disabled={busy}
                  title="Borrar de la bandeja"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDeletePack(p.id)
                  }}
                >
                  Borrar
                </button>
              </li>
            ))}
            {packs.length === 0 ? (
              <li className="muted">Sin investigaciones todavía.</li>
            ) : null}
          </ul>
        </section>

        <section className="panel depro-research-detail">
          {!selectedPack ? (
            <p className="muted">Elegí un pack de la bandeja.</p>
          ) : (
            <>
              <header className="panel-head depro-research-detail-head">
                <div>
                  <h2>{selectedPack.topic.slice(0, 120)}</h2>
                  <p className="muted mono">
                    {selectedPack.origin} · {selectedPack.status}
                    {selectedPack.parent_pack_id ? ' · fractal (hijo)' : ''}
                  </p>
                </div>
                <div className="depro-ida-card-actions">
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy || pendingCount === 0}
                    onClick={() => void onAssimilatePending()}
                  >
                    Asimilar pendientes ({pendingCount})
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy || pendingCount === 0}
                    onClick={() => void onDiscardPending()}
                  >
                    Purgar pendientes
                  </button>
                </div>
              </header>

              <div className="depro-filters">
                <button
                  type="button"
                  className={
                    filter === 'pending' ? 'filter-chip is-active' : 'filter-chip'
                  }
                  onClick={() => setFilter('pending')}
                >
                  Pendientes
                </button>
                <button
                  type="button"
                  className={
                    filter === 'all' ? 'filter-chip is-active' : 'filter-chip'
                  }
                  onClick={() => setFilter('all')}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={
                    filter === 'assimilated'
                      ? 'filter-chip is-active'
                      : 'filter-chip'
                  }
                  onClick={() => setFilter('assimilated')}
                >
                  Asimilados
                </button>
                {filter === 'all' ? (
                  <button
                    type="button"
                    className={
                      showDiscarded ? 'filter-chip is-active' : 'filter-chip'
                    }
                    onClick={() => setShowDiscarded((v) => !v)}
                  >
                    Mostrar descartados
                  </button>
                ) : null}
              </div>

              {hasMatrix ? (
                <div className="depro-research-matrix">
                  {axes.map((axis) => (
                    <div key={axis.index} className="depro-research-axis">
                      <h3 className="depro-research-axis-title">
                        <span className="muted mono">{axis.index + 1}.</span>{' '}
                        {axis.title}
                      </h3>
                      <div className="depro-research-axis-nodes">
                        {Array.from({ length: 6 }, (_, nodeIndex) => {
                          const f = cellFor(axis.index, nodeIndex)
                          if (!f) {
                            return (
                              <div
                                key={nodeIndex}
                                className="depro-research-finding depro-research-finding--empty"
                              />
                            )
                          }
                          if (
                            filter === 'pending' &&
                            f.status !== 'pending'
                          ) {
                            return (
                              <button
                                key={f.id}
                                type="button"
                                className={`depro-research-finding depro-research-finding--${f.status} is-dim`}
                                onClick={() => setSelectedFinding(f)}
                              >
                                <strong>{f.title}</strong>
                                <span className="muted mono">
                                  {statusLabel(f.status)}
                                </span>
                              </button>
                            )
                          }
                          if (
                            filter === 'assimilated' &&
                            f.status !== 'assimilated'
                          ) {
                            return (
                              <button
                                key={f.id}
                                type="button"
                                className={`depro-research-finding depro-research-finding--${f.status} is-dim`}
                                onClick={() => setSelectedFinding(f)}
                              >
                                <strong>{f.title}</strong>
                                <span className="muted mono">
                                  {statusLabel(f.status)}
                                </span>
                              </button>
                            )
                          }
                          if (
                            filter === 'all' &&
                            !showDiscarded &&
                            f.status === 'discarded'
                          ) {
                            return (
                              <div
                                key={f.id}
                                className="depro-research-finding depro-research-finding--empty"
                              />
                            )
                          }
                          return (
                            <button
                              key={f.id}
                              type="button"
                              className={
                                selectedFinding?.id === f.id
                                  ? `depro-research-finding depro-research-finding--${f.status} is-selected`
                                  : `depro-research-finding depro-research-finding--${f.status}`
                              }
                              onClick={() => setSelectedFinding(f)}
                            >
                              <strong>{f.title}</strong>
                              <span className="muted mono">
                                {statusLabel(f.status)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="depro-ida-list depro-research-findings">
                  {visibleFindings.map((f) => (
                    <li
                      key={f.id}
                      className={`depro-research-finding depro-research-finding--${f.status}`}
                    >
                      <div className="depro-research-finding-head">
                        <strong>{f.title}</strong>
                        <span className="muted mono">
                          {statusLabel(f.status)}
                        </span>
                      </div>
                      {f.body ? <p>{f.body}</p> : null}
                      {f.url ? (
                        <p className="muted mono">
                          <a href={f.url} target="_blank" rel="noreferrer">
                            {f.url}
                          </a>
                        </p>
                      ) : null}
                      {renderFindingActions(f)}
                    </li>
                  ))}
                </ul>
              )}

              {hasMatrix && selectedFinding ? (
                <div
                  className={`depro-research-inspect depro-research-finding--${selectedFinding.status}`}
                >
                  <div className="depro-research-finding-head">
                    <strong>{selectedFinding.title}</strong>
                    <span className="muted mono">
                      {statusLabel(selectedFinding.status)}
                      {selectedFinding.axis_title
                        ? ` · ${selectedFinding.axis_title}`
                        : ''}
                    </span>
                  </div>
                  {selectedFinding.body ? <p>{selectedFinding.body}</p> : null}
                  {selectedFinding.url ? (
                    <p className="muted mono">
                      <a
                        href={selectedFinding.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selectedFinding.url}
                      </a>
                    </p>
                  ) : null}
                  {selectedFinding.assimilated_ida_id ? (
                    <p className="muted mono">
                      ficha {selectedFinding.assimilated_ida_id.slice(0, 8)}…
                    </p>
                  ) : null}
                  {renderFindingActions(selectedFinding)}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
