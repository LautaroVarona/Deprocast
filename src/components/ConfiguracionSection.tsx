import { useCallback, useEffect, useState } from 'react'
import { api, type ProviderConfigResponse } from '../services/api'

type Slot = keyof ProviderConfigResponse['provider']

interface Props {
  refreshKey: number
}

export function ConfiguracionSection({ refreshKey }: Props) {
  const [data, setData] = useState<ProviderConfigResponse | null>(null)
  const [draftProvider, setDraftProvider] = useState<
    Partial<Record<Slot, string>>
  >({})
  const [draftModel, setDraftModel] = useState<Partial<Record<Slot, string>>>(
    {},
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [token, setToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getProviderConfig()
      setData(res)
      setDraftProvider({ ...res.provider })
      setDraftModel({ ...res.model })
      const tok = await api.getLocalToken()
      setToken(tok.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const providerOf = (slot: Slot) =>
    draftProvider[slot] ?? data?.provider[slot] ?? ''
  const modelOf = (slot: Slot) => draftModel[slot] ?? data?.model[slot] ?? ''

  const onProviderChange = (slot: Slot, providerId: string) => {
    setDraftProvider((prev) => ({ ...prev, [slot]: providerId }))
    const entry = data?.catalog.find((c) => c.slot === slot)
    const prov = entry?.providers.find((p) => p.id === providerId)
    const firstModel = prov?.models[0]?.id
    if (firstModel) {
      setDraftModel((prev) => ({ ...prev, [slot]: firstModel }))
    }
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const res = await api.putProviderConfig({
        provider: draftProvider as ProviderConfigResponse['provider'],
        model: draftModel as ProviderConfigResponse['model'],
      })
      setData(res)
      setDraftProvider({ ...res.provider })
      setDraftModel({ ...res.model })
      setStatus('Configuración guardada. Aplica en las próximas llamadas LLM.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const keyBadge = (providerId: string) => {
    if (providerId === 'ollama') {
      return <span className="config-key ok">local</span>
    }
    const ok = data?.keysPresent[providerId]
    if (ok == null) return null
    return (
      <span className={ok ? 'config-key ok' : 'config-key missing'}>
        {ok ? 'key OK' : 'falta key en .env'}
      </span>
    )
  }

  return (
    <section className="panel configuracion-section" id="configuracion">
      <header className="panel-head">
        <h2>Configuración</h2>
      </header>
      <p className="muted">
        Elegí proveedor y modelo por rol. Las API keys siguen en{' '}
        <code>.env</code>; el cambio de selector aplica en runtime sin
        reiniciar. Groq es el default de LLM rápido (ENR). Llama 3 ya no está
        en Groq: usamos GPT-OSS 120B (calidad) y 20B (velocidad).
      </p>
      {token && (
        <div className="config-block">
          <h3>Token local (El Cofre)</h3>
          <p className="muted">
            Copiá este token en el popup de la extensión. No lo subas a Git.
          </p>
          <code className="config-token">{token}</code>
        </div>
      )}

      {loading && <p className="muted">Cargando…</p>}
      {error && <p className="error">{error}</p>}
      {status && <p className="muted">{status}</p>}

      {data && (
        <>
          {data.catalog.map((entry) => {
            const slot = entry.slot as Slot
            const providerId = providerOf(slot)
            const prov = entry.providers.find((p) => p.id === providerId)
            const models = prov?.models ?? []
            const locked = entry.providers.length <= 1

            return (
              <div key={slot} className="config-block">
                <h3>{entry.label}</h3>
                <div className="config-row">
                  <label>
                    Proveedor
                    <select
                      value={providerId}
                      disabled={locked}
                      onChange={(e) =>
                        onProviderChange(slot, e.target.value)
                      }
                    >
                      {entry.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {keyBadge(providerId)}
                </div>
                <div className="config-row">
                  <label>
                    Modelo
                    <select
                      value={modelOf(slot)}
                      onChange={(e) =>
                        setDraftModel((prev) => ({
                          ...prev,
                          [slot]: e.target.value,
                        }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {locked && (
                  <p className="muted config-hint">
                    Por ahora solo este proveedor está cableado para este rol.
                  </p>
                )}
                {slot === 'llm_main' && (
                  <p className="muted config-hint">
                    Este es el cerebro de Diálogo y RAG. Groq primero. Cohere
                    puede quedar configurado para más adelante; si no hay
                    créditos, no lo uses acá.
                  </p>
                )}
                {slot === 'llm_fast' && providerId === 'groq' && (
                  <p className="muted config-hint">
                    Groq hace la ENR forense: quántomos, acciones y entidades
                    (Persona, Proyecto, Agrupacion, Artefacto, Ubicacion, Hito).
                    Distingue typos y apodos para vincularlos al léxico.
                  </p>
                )}
                {slot === 'llm_sentinel' && (
                  <p className="muted config-hint">
                    Motor de Sentinela (perfil + misiones). Independiente del
                    LLM rápido. GPT-OSS 120B on_demand tiene 8k TPM: si el
                    turno es grande, se recorta y se reintenta en 20B. Cohere
                    no entra en este chat.
                  </p>
                )}
                {slot === 'embed' && (
                  <p className="muted config-hint">
                    Mnemosyne usa Cohere Embed. Si el billing está en 402, los
                    embeds se pausan; Sentinela y Groq siguen. No hace falta
                    borrar la key.
                  </p>
                )}
              </div>
            )
          })}

          <div className="config-actions">
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="btn btn-tiny"
              disabled={loading || saving}
              onClick={() => void load()}
            >
              Recargar
            </button>
          </div>
        </>
      )}
    </section>
  )
}
