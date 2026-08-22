import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import type { AmaCycleSlot, AmaFlow, AmaPlace, AmaPlaceKind } from '../../types'
import { AmazonaLinks } from './AmazonaLinks'
import { AmazonaMap } from './AmazonaMap'
import { CYCLE_LABEL, CYCLE_SLOTS, PLACE_KIND_LABEL } from './labels'

type Props = {
  refreshKey: number
  onChanged?: () => void
}

export function AmazonaGeo({ refreshKey, onChanged }: Props) {
  const [places, setPlaces] = useState<AmaPlace[]>([])
  const [flows, setFlows] = useState<AmaFlow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState<AmaPlaceKind>('enclave')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [tags, setTags] = useState('')

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [flowNotes, setFlowNotes] = useState('')
  const [flowSlot, setFlowSlot] = useState<AmaCycleSlot | ''>('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [p, f] = await Promise.all([
        api.amazonaListPlaces(),
        api.amazonaListFlows(),
      ])
      setPlaces(p.places)
      setFlows(f.flows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar geografía')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const selected = useMemo(
    () => places.find((p) => p.id === selectedId) ?? null,
    [places, selectedId],
  )

  useEffect(() => {
    if (!selected) return
    setName(selected.name)
    setNotes(selected.notes)
    setKind(selected.kind)
    setLat(selected.lat != null ? String(selected.lat) : '')
    setLng(selected.lng != null ? String(selected.lng) : '')
    setTags((selected.tags_list ?? []).join(', '))
  }, [selected])

  function resetForm() {
    setSelectedId(null)
    setName('')
    setNotes('')
    setKind('enclave')
    setLat('')
    setLng('')
    setTags('')
  }

  async function savePlace() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        notes,
        kind,
        tags,
        lat: lat === '' ? null : Number(lat),
        lng: lng === '' ? null : Number(lng),
      }
      if (selected) {
        await api.amazonaUpdatePlace(selected.id, body)
      } else {
        const data = await api.amazonaCreatePlace(body)
        setSelectedId(data.place.id)
      }
      onChanged?.()
      await load()
      setStatus('Lugar guardado')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  async function removePlace() {
    if (!selected) return
    if (!window.confirm(`¿Borrar “${selected.name}”?`)) return
    setBusy(true)
    try {
      await api.amazonaDeletePlace(selected.id)
      resetForm()
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusy(false)
    }
  }

  async function pingHere() {
    if (!navigator.geolocation) {
      setError('Geolocalización no disponible')
      return
    }
    setBusy(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await api.amazonaPingPlace({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
          setSelectedId(data.place.id)
          setStatus(
            data.snapped
              ? `Anclado a ${data.place.name} (${data.meters} m)`
              : `Nuevo punto ${data.place.name}`,
          )
          onChanged?.()
          await load()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo registrar')
        } finally {
          setBusy(false)
        }
      },
      () => {
        setBusy(false)
        setError('No se pudo leer la posición')
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  async function addFlow() {
    if (!fromId || !toId) return
    setBusy(true)
    setError(null)
    try {
      await api.amazonaCreateFlow({
        from_place_id: fromId,
        to_place_id: toId,
        notes: flowNotes,
        cycle_slot: flowSlot === '' ? null : flowSlot,
      })
      setFlowNotes('')
      onChanged?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el flujo')
    } finally {
      setBusy(false)
    }
  }

  async function removeFlow(id: string) {
    setBusy(true)
    try {
      await api.amazonaDeleteFlow(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el flujo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ama-geo">
      <div className="panel ama-map-panel">
        <header className="panel-head">
          <h2>Geografía</h2>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy}
            onClick={() => void pingHere()}
          >
            Registrar posición
          </button>
        </header>
        <p className="muted">
          Enclaves del área valenciana, rutas y flujos metro a metro. Clic en el
          mapa para cargar coordenadas.
        </p>
        <AmazonaMap
          places={places}
          flows={flows}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMapClick={(la, ln) => {
            setLat(la.toFixed(6))
            setLng(ln.toFixed(6))
          }}
        />
        {status ? <p className="muted">{status}</p> : null}
        {error ? <p className="muted">{error}</p> : null}
      </div>

      <div className="ama-geo-side">
        <div className="panel">
          <header className="panel-head">
            <h2>{selected ? 'Editar lugar' : 'Nuevo lugar'}</h2>
            {selected ? (
              <button type="button" className="btn btn-tiny btn-ghost" onClick={resetForm}>
                Nuevo
              </button>
            ) : null}
          </header>
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Tipo</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AmaPlaceKind)}
            >
              {(Object.keys(PLACE_KIND_LABEL) as AmaPlaceKind[]).map((k) => (
                <option key={k} value={k}>
                  {PLACE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="ama-inline-fields">
            <label className="field">
              <span>Lat</span>
              <input value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label className="field">
              <span>Lng</span>
              <input value={lng} onChange={(e) => setLng(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Notas</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="field">
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div className="ama-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              onClick={() => void savePlace()}
            >
              Guardar
            </button>
            {selected ? (
              <button
                type="button"
                className="btn btn-tiny btn-ghost"
                disabled={busy}
                onClick={() => void removePlace()}
              >
                Borrar
              </button>
            ) : null}
          </div>
          {selected ? (
            <AmazonaLinks objectType="place" objectId={selected.id} places={places} />
          ) : null}
        </div>

        <div className="panel">
          <header className="panel-head">
            <h2>Lugares</h2>
          </header>
          <ul className="ama-list-nav">
            {places.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={
                    p.id === selectedId ? 'ama-nav-item is-active' : 'ama-nav-item'
                  }
                  onClick={() => setSelectedId(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>{PLACE_KIND_LABEL[p.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <header className="panel-head">
            <h2>Flujos</h2>
          </header>
          <div className="ama-inline-fields">
            <label className="field">
              <span>Origen</span>
              <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">—</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Destino</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">—</option>
                {places.map((p) => (
                  <option key={`t-${p.id}`} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Ciclo</span>
            <select
              value={flowSlot}
              onChange={(e) => setFlowSlot(e.target.value as AmaCycleSlot | '')}
            >
              <option value="">—</option>
              {CYCLE_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {CYCLE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Notas</span>
            <textarea
              rows={2}
              value={flowNotes}
              onChange={(e) => setFlowNotes(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy || !fromId || !toId}
            onClick={() => void addFlow()}
          >
            Registrar flujo
          </button>
          <ul className="ama-flow-list">
            {flows.map((f) => (
              <li key={f.id}>
                <span>
                  {f.from_name} → {f.to_name}
                  {f.distance_m != null
                    ? ` · ${Math.round(f.distance_m)} m`
                    : ''}
                  {f.display_slot ? ` · ${CYCLE_LABEL[f.display_slot]}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-tiny btn-ghost"
                  onClick={() => void removeFlow(f.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
