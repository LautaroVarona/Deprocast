import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import type { AmaPlace, MapOccupancyItem, MapTag } from '../../types'
import type { MapPick } from './MapaCanvas'

type OccupyKind = 'person' | 'project' | 'agrupacion' | 'entry'

type Props = {
  pick: MapPick | null
  occupancy: MapOccupancyItem[]
  zones: AmaPlace[]
  busy?: boolean
  onOccupy: (kind: OccupyKind, id: string) => void
  onUnoccupy: (item: MapOccupancyItem) => void
  onCreateTag: (label: string, notes: string) => void
  onDeleteTag: (id: string) => void
}

const KIND_LABEL: Record<string, string> = {
  person: 'Persona',
  project: 'Proyecto',
  agrupacion: 'Agrupación',
  entry: 'Ingesta',
  item: 'AmazonA',
  cell: 'Celda',
  tag: 'Tag',
}

export function MapaOccupancy({
  pick,
  occupancy,
  zones,
  busy,
  onOccupy,
  onUnoccupy,
  onCreateTag,
  onDeleteTag,
}: Props) {
  const [kind, setKind] = useState<OccupyKind>('person')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; label: string }>>([])
  const [tagLabel, setTagLabel] = useState('')
  const [tagNotes, setTagNotes] = useState('')

  const place: AmaPlace | null =
    pick?.type === 'place'
      ? pick.place
      : pick?.type === 'hex'
        ? pick.place
        : null
  const tag: MapTag | null = pick?.type === 'tag' ? pick.tag : null
  const empty = pick?.type === 'empty' ? pick : null

  useEffect(() => {
    setQuery('')
    setHits([])
    setTagLabel('')
    setTagNotes('')
  }, [pick])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setHits([])
      return
    }
    const ac = new AbortController()
    if (kind === 'entry') {
      void api
        .mapSearchEntries(q)
        .then((res) => {
          setHits(res.entries.map((e) => ({ id: e.id, label: e.title })))
        })
        .catch(() => {
          /* abort */
        })
      return () => ac.abort()
    }
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
        /* abort */
      })
    return () => ac.abort()
  }, [query, kind])

  if (!pick) {
    return (
      <section className="mapa-panel-block">
        <p className="mapa-kicker">Ocupación</p>
        <p className="muted">
          Clic en un nodo o hexágono para ver quién ocupa la zona. Clic en el
          mapa vacío para crear un tag.
        </p>
      </section>
    )
  }

  return (
    <section className="mapa-panel-block">
      <p className="mapa-kicker">
        {empty ? 'Nuevo tag' : tag ? 'Tag' : 'Ocupación'}
      </p>
      {place ? (
        <div className="mapa-place-head">
          <strong>{place.name}</strong>
          <span>
            {place.zone_code || place.role || place.kind}
            {place.h3_index ? ` · ${place.h3_index.slice(0, 8)}…` : ''}
          </span>
          {place.notes ? <p className="muted">{place.notes}</p> : null}
        </div>
      ) : null}
      {pick.type === 'hex' && !place ? (
        <p className="muted">Celda H3 {pick.hex}</p>
      ) : null}
      {tag ? (
        <div className="mapa-place-head">
          <strong>{tag.label}</strong>
          <span>
            {tag.place_name || 'sin zona'}
            {tag.h3_index ? ` · ${tag.h3_index.slice(0, 8)}…` : ''}
          </span>
          {tag.notes ? <p className="muted">{tag.notes}</p> : null}
          <button
            type="button"
            className="btn btn-tiny btn-ghost"
            disabled={busy}
            onClick={() => onDeleteTag(tag.id)}
          >
            Borrar tag
          </button>
        </div>
      ) : null}

      {empty ? (
        <form
          className="mapa-stack-form"
          onSubmit={(e) => {
            e.preventDefault()
            const label = tagLabel.trim()
            if (!label) return
            onCreateTag(label, tagNotes.trim())
            setTagLabel('')
            setTagNotes('')
          }}
        >
          <p className="muted">
            {empty.lat.toFixed(5)}, {empty.lng.toFixed(5)}
          </p>
          <input
            value={tagLabel}
            onChange={(e) => setTagLabel(e.target.value)}
            placeholder="Etiqueta"
            disabled={busy}
          />
          <textarea
            value={tagNotes}
            onChange={(e) => setTagNotes(e.target.value)}
            placeholder="Notas"
            rows={2}
            disabled={busy}
          />
          <button type="submit" className="btn btn-tiny" disabled={busy}>
            Fijar tag
          </button>
        </form>
      ) : null}

      {place ? (
        <>
          <ul className="mapa-occ-list">
            {occupancy.length === 0 ? (
              <li className="muted">Nadie ocupa esta zona aún.</li>
            ) : (
              occupancy.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <span>
                    <em>{KIND_LABEL[item.kind] ?? item.kind}</em> {item.label}
                    {item.subtitle ? (
                      <small className="muted"> {item.subtitle}</small>
                    ) : null}
                  </span>
                  {item.kind === 'person' ||
                  item.kind === 'project' ||
                  item.kind === 'agrupacion' ||
                  item.kind === 'entry' ? (
                    <button
                      type="button"
                      className="btn btn-tiny btn-ghost"
                      disabled={busy}
                      onClick={() => onUnoccupy(item)}
                    >
                      Quitar
                    </button>
                  ) : null}
                </li>
              ))
            )}
          </ul>
          <div className="ama-link-add">
            <select
              value={kind}
              disabled={busy}
              onChange={(e) => setKind(e.target.value as OccupyKind)}
            >
              <option value="person">Persona</option>
              <option value="project">Proyecto</option>
              <option value="agrupacion">Agrupación</option>
              <option value="entry">Ingesta</option>
            </select>
            <input
              type="text"
              value={query}
              placeholder="Anclar al corpus…"
              disabled={busy}
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
                    onClick={() => {
                      onOccupy(kind, hit.id)
                      setQuery('')
                      setHits([])
                    }}
                  >
                    {hit.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {!place && !empty && !tag && zones.length === 0 ? (
        <p className="muted">Sin zonas sembradas.</p>
      ) : null}
    </section>
  )
}
