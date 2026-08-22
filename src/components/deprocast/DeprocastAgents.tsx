import { useMemo, useState } from 'react'
import type { DeproAgent, DeproDomainId, DeproIdaItem, DeproPower, DeproTypology } from '../../types'
import {
  AGENT_CATALOG,
  CMA_LABEL,
  DEPRO_DOMAIN_IDS,
  DEPRO_DOMAIN_META,
  IPO_LABEL,
  MODULE_CATALOG,
  powerNumber,
  TYPOLOGIES,
  TYPOLOGY_LABEL,
} from '../../lib/deprocast'
import type { IdaDraft } from './idaDraft'

type Props = {
  powers: DeproPower[]
  ida: DeproIdaItem[]
  onOpenIda: (draft: IdaDraft) => void
}

export function DeprocastAgents({ powers, ida, onOpenIda }: Props) {
  const [typology, setTypology] = useState<DeproTypology | 'all'>('all')
  const [domain, setDomain] = useState<DeproDomainId | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string>(AGENT_CATALOG[0]?.id ?? '')

  const filtered = useMemo(() => {
    return AGENT_CATALOG.filter((a) => {
      if (typology !== 'all' && a.typology !== typology) return false
      if (domain !== 'all' && !a.domains.includes(domain)) return false
      return true
    })
  }, [typology, domain])

  const agent = AGENT_CATALOG.find((a) => a.id === selectedId) ?? filtered[0]
  const agentPowers = agent
    ? powers.filter((p) => agent.powerIndexes.includes(p.index))
    : []
  const agentIda = agent
    ? ida.filter((item) => item.agent_ids.includes(agent.id))
    : []

  return (
    <div className="depro-agents">
      <section className="panel">
        <header className="panel-head">
          <h2>Agentes</h2>
          <span className="muted mono">{AGENT_CATALOG.length} fichas</span>
        </header>
        <p className="muted depro-lead">
          Atelier, no orquestador. Cada ficha es un contrato Input |
          Procesamiento | Output. Se hardcodea acá y se mejora en IDA.
        </p>
        <div className="depro-filters">
          <button
            type="button"
            className={typology === 'all' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setTypology('all')}
          >
            Todas
          </button>
          {TYPOLOGIES.map((t) => (
            <button
              key={t}
              type="button"
              className={typology === t ? 'filter-chip is-active' : 'filter-chip'}
              onClick={() => setTypology(t)}
            >
              {TYPOLOGY_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="depro-filters">
          <button
            type="button"
            className={domain === 'all' ? 'filter-chip is-active' : 'filter-chip'}
            onClick={() => setDomain('all')}
          >
            Dominios
          </button>
          {DEPRO_DOMAIN_IDS.map((d) => (
            <button
              key={d}
              type="button"
              className={domain === d ? 'filter-chip is-active' : 'filter-chip'}
              onClick={() => setDomain(d)}
            >
              {DEPRO_DOMAIN_META[d].label}
            </button>
          ))}
        </div>
        <div className="depro-agent-grid">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className={
                a.id === agent?.id
                  ? `depro-agent-card is-${a.status} is-selected`
                  : `depro-agent-card is-${a.status}`
              }
              onClick={() => setSelectedId(a.id)}
            >
              <span className="depro-agent-kicker">
                {TYPOLOGY_LABEL[a.typology]} · {a.status}
              </span>
              <strong>{a.name}</strong>
              <span className="depro-ipo-row">
                <em>I</em>
                <em>P</em>
                <em>O</em>
              </span>
              <span className="muted">{a.module ?? 'sin módulo'}</span>
            </button>
          ))}
        </div>
      </section>

      {agent && (
        <AgentDetail
          agent={agent}
          powers={agentPowers}
          ida={agentIda}
          onOpenIda={onOpenIda}
        />
      )}

      <section className="panel depro-organism">
        <header className="panel-head">
          <h2>Mapa del organismo</h2>
          <span className="muted mono">{MODULE_CATALOG.length} módulos</span>
        </header>
        <p className="muted depro-lead">
          Metaanálisis de lo que Deprocast hace ahora. Cada módulo sugiere
          agentes. Crear ficha IDA es el primer bucle recursivo.
        </p>
        <ul className="depro-module-list">
          {MODULE_CATALOG.map((mod) => (
            <li key={mod.id}>
              <div>
                <strong>{mod.label}</strong>
                <p>{mod.does}</p>
                <p className="muted mono">{mod.files}</p>
                <p className="depro-mod-ipo">
                  <span>I {mod.ipo.input}</span>
                  <span>P {mod.ipo.processing}</span>
                  <span>O {mod.ipo.output}</span>
                </p>
              </div>
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() =>
                  onOpenIda({
                    title: `Mejorar ${mod.label}`,
                    body: `${mod.does}\n\nInput: ${mod.ipo.input}\nProcesamiento: ${mod.ipo.processing}\nOutput: ${mod.ipo.output}`,
                    agent_ids: mod.suggestedAgentIds,
                    tags: [mod.id, 'metanalisis'],
                  })
                }
              >
                Ficha IDA
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function AgentDetail({
  agent,
  powers,
  ida,
  onOpenIda,
}: {
  agent: DeproAgent
  powers: DeproPower[]
  ida: DeproIdaItem[]
  onOpenIda: (draft: IdaDraft) => void
}) {
  return (
    <aside className="panel depro-inspect">
      <header className="panel-head">
        <h2>{agent.name}</h2>
        <span className={`depro-pill is-${agent.status}`}>{agent.status}</span>
      </header>
      <p className="muted mono">
        {TYPOLOGY_LABEL[agent.typology]} · {agent.idaStage} ·{' '}
        {agent.module ?? 'sin módulo'}
      </p>
      <div className="depro-trident">
        <div>
          <span>Input</span>
          <p>{agent.contract.input}</p>
        </div>
        <div>
          <span>Procesamiento</span>
          <p>{agent.contract.processing}</p>
        </div>
        <div>
          <span>Output</span>
          <p>{agent.contract.output}</p>
        </div>
      </div>
      {agent.notes && <p className="depro-notes">{agent.notes}</p>}
      {agent.promptStub ? (
        <p className="mono depro-prompt">{agent.promptStub}</p>
      ) : null}
      <p className="muted">
        Dominios:{' '}
        {agent.domains.map((d) => DEPRO_DOMAIN_META[d].label).join(' · ')}
      </p>
      {powers.length > 0 && (
        <ul className="depro-power-chips">
          {powers.map((p) => (
            <li key={p.index}>
              <span className="mono">{powerNumber(p.index)}</span>{' '}
              {p.name}
              <span className="muted">
                {' '}
                {IPO_LABEL[p.ipo]} · {CMA_LABEL[p.cma]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ida.length > 0 && (
        <p className="muted">
          En IDA: {ida.map((item) => item.title).join(' · ')}
        </p>
      )}
      <button
        type="button"
        className="btn btn-tiny"
        onClick={() =>
          onOpenIda({
            title: `Agente ${agent.name}`,
            body: agent.notes || agent.contract.processing,
            agent_ids: [agent.id],
            power_indexes: agent.powerIndexes,
            tags: [agent.typology, agent.idaStage],
          })
        }
      >
        Abrir en IDA
      </button>
    </aside>
  )
}
