import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import type {
  AmaLink,
  AmaLinkObjectType,
  AmaLinkTargetKind,
  AmaPlace,
} from '../../types'

type Props = {
  objectType: AmaLinkObjectType
  objectId: string
  places?: AmaPlace[]
}

const TARGET_LABEL: Record<AmaLinkTargetKind, string> = {
  person: 'Persona',
  project: 'Proyecto',
  agrupacion: 'Agrupación',
  place: 'Lugar',
}

export function AmazonaLinks({ objectType, objectId, places = [] }: Props) {
  const [links, setLinks] = useState<AmaLink[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<AmaLinkTargetKind>('person')
  const [hits, setHits] = useState<Array<{ id: string; label: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!objectId) return
    try {
      const data = await api.amazonaListLinks(objectType, objectId)
      setLinks(data.links)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar vínculos')
    }
  }, [objectType, objectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const q = query.trim()
    if (kind === 'place') {
      const needle = q.toLowerCase()
      setHits(
        places
          .filter((p) => !needle || p.name.toLowerCase().includes(needle))
          .slice(0, 8)
          .map((p) => ({ id: p.id, label: p.name })),
      )
      return
    }
    if (q.length < 1) {
      setHits([])
      return
    }
    const ac = new AbortController()
    const kinds =
      kind === 'agrupacion'
        ? (['agrupacion'] as const)
        : kind === 'project'
          ? (['project'] as const)
          : (['person'] as const)
    void api
      .typeaheadEntities(q, { kinds: [...kinds], limit: 8, signal: ac.signal })
      .then((res) => {
        setHits(res.results.map((r) => ({ id: r.id, label: r.label })))
      })
      .catch(() => {
        /* ignore abort */
      })
    return () => ac.abort()
  }, [query, kind, places])

  async function add(targetId: string) {
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaCreateLink({
        object_type: objectType,
        object_id: objectId,
        target_kind: kind,
        target_id: targetId,
      })
      setLinks(data.links)
      setQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo vincular')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const data = await api.amazonaDeleteLink(id)
      setLinks(data.links)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ama-links">
      <p className="ama-kicker">Vínculos</p>
      {error ? <p className="muted">{error}</p> : null}
      <ul className="ama-link-list">
        {links.length === 0 ? (
          <li className="muted">Sin vínculos.</li>
        ) : (
          links.map((link) => (
            <li key={link.id}>
              <span>
                <em>{TARGET_LABEL[link.target_kind]}</em>{' '}
                {link.target_label ?? link.target_id}
              </span>
              <button
                type="button"
                className="btn btn-tiny btn-ghost"
                disabled={busy}
                onClick={() => void remove(link.id)}
              >
                Quitar
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="ama-link-add">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AmaLinkTargetKind)}
        >
          <option value="person">Persona</option>
          <option value="project">Proyecto</option>
          <option value="agrupacion">Agrupación</option>
          <option value="place">Lugar</option>
        </select>
        <input
          type="text"
          value={query}
          placeholder="Buscar…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {hits.length > 0 ? (
        <ul className="ama-link-hits">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="btn btn-tiny"
                disabled={busy}
                onClick={() => void add(hit.id)}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
