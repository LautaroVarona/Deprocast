import { Router } from 'express'
import { getDb } from '../db.js'
import {
  buildOverview,
  createSystem,
  createTag,
  deleteSystem,
  deleteTag,
  getSystem,
  h3Radar,
  occupy,
  occupancyDetail,
  patchLayer,
  patchSystem,
  searchEntries,
  unoccupy,
} from '../services/map.js'

export const mapRouter = Router()

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

mapRouter.get('/overview', (req, res) => {
  const systemId = asString(req.query.system_id)
  const overview = buildOverview(getDb(), systemId || undefined)
  if ('error' in overview) {
    res.status(404).json({ error: overview.error })
    return
  }
  res.json({ ok: true, ...overview })
})

mapRouter.post('/systems', (req, res) => {
  const body = req.body as {
    name?: string
    notes?: string
    center_lat?: number
    center_lng?: number
    zoom?: number
    pitch?: number
    bearing?: number
    copy_from?: string | null
  }
  const name = asString(body.name)
  const lat = asNumber(body.center_lat)
  const lng = asNumber(body.center_lng)
  if (!name || lat == null || lng == null) {
    res.status(400).json({ error: 'Nombre y centro requeridos' })
    return
  }
  const system = createSystem(getDb(), {
    name,
    notes: asString(body.notes),
    center_lat: lat,
    center_lng: lng,
    zoom: asNumber(body.zoom) ?? undefined,
    pitch: asNumber(body.pitch) ?? undefined,
    bearing: asNumber(body.bearing) ?? undefined,
    copy_from: body.copy_from ? asString(body.copy_from) : null,
  })
  res.status(201).json({ ok: true, system })
})

mapRouter.patch('/systems/:id', (req, res) => {
  const body = req.body as {
    name?: string
    notes?: string
    center_lat?: number
    center_lng?: number
    zoom?: number
    pitch?: number
    bearing?: number
  }
  const system = patchSystem(getDb(), String(req.params.id), {
    name: body.name != null ? asString(body.name) : undefined,
    notes: body.notes != null ? asString(body.notes) : undefined,
    center_lat: asNumber(body.center_lat) ?? undefined,
    center_lng: asNumber(body.center_lng) ?? undefined,
    zoom: asNumber(body.zoom) ?? undefined,
    pitch: asNumber(body.pitch) ?? undefined,
    bearing: asNumber(body.bearing) ?? undefined,
  })
  if (!system) {
    res.status(404).json({ error: 'Sistema no encontrado' })
    return
  }
  res.json({ ok: true, system })
})

mapRouter.delete('/systems/:id', (req, res) => {
  const id = String(req.params.id)
  if (id === 'map-sys-pghqg') {
    res.status(400).json({ error: 'No se puede borrar el sistema PGHQG' })
    return
  }
  if (!getSystem(getDb(), id)) {
    res.status(404).json({ error: 'Sistema no encontrado' })
    return
  }
  deleteSystem(getDb(), id)
  res.json({ ok: true, id })
})

mapRouter.patch('/layers/:id', (req, res) => {
  const body = req.body as {
    visible?: number | boolean
    opacity?: number
    title?: string
  }
  const visible =
    body.visible == null
      ? undefined
      : body.visible === true || body.visible === 1
        ? 1
        : 0
  const layer = patchLayer(getDb(), String(req.params.id), {
    visible,
    opacity: asNumber(body.opacity) ?? undefined,
    title: body.title != null ? asString(body.title) : undefined,
  })
  if (!layer) {
    res.status(404).json({ error: 'Capa no encontrada' })
    return
  }
  res.json({ ok: true, layer })
})

mapRouter.post('/tags', (req, res) => {
  const body = req.body as {
    system_id?: string
    lat?: number
    lng?: number
    label?: string
    notes?: string
    place_id?: string | null
    layer_id?: string | null
    target_kind?: string | null
    target_id?: string | null
  }
  const systemId = asString(body.system_id)
  const lat = asNumber(body.lat)
  const lng = asNumber(body.lng)
  const label = asString(body.label)
  if (!systemId || lat == null || lng == null || !label) {
    res.status(400).json({ error: 'system_id, coordenadas y label requeridos' })
    return
  }
  if (!getSystem(getDb(), systemId)) {
    res.status(404).json({ error: 'Sistema no encontrado' })
    return
  }
  const tag = createTag(getDb(), {
    system_id: systemId,
    lat,
    lng,
    label,
    notes: asString(body.notes),
    place_id: body.place_id ? asString(body.place_id) : null,
    layer_id: body.layer_id ? asString(body.layer_id) : null,
    target_kind: body.target_kind ? asString(body.target_kind) : null,
    target_id: body.target_id ? asString(body.target_id) : null,
  })
  res.status(201).json({ ok: true, tag })
})

mapRouter.delete('/tags/:id', (req, res) => {
  if (!deleteTag(getDb(), String(req.params.id))) {
    res.status(404).json({ error: 'Tag no encontrado' })
    return
  }
  res.json({ ok: true, id: req.params.id })
})

mapRouter.get('/occupancy', (req, res) => {
  const placeId = asString(req.query.place_id)
  if (!placeId) {
    res.status(400).json({ error: 'place_id requerido' })
    return
  }
  const db = getDb()
  const place = db
    .prepare(`SELECT id, name FROM ama_places WHERE id = ?`)
    .get(placeId) as { id: string; name: string } | undefined
  if (!place) {
    res.status(404).json({ error: 'Zona no encontrada' })
    return
  }
  res.json({
    ok: true,
    place_id: place.id,
    place_name: place.name,
    items: occupancyDetail(db, place.id),
  })
})

mapRouter.post('/occupy', (req, res) => {
  const body = req.body as {
    place_id?: string
    kind?: 'person' | 'project' | 'agrupacion' | 'entry'
    id?: string
  }
  const placeId = asString(body.place_id)
  const kind = body.kind
  const id = asString(body.id)
  if (
    !placeId ||
    !id ||
    (kind !== 'person' &&
      kind !== 'project' &&
      kind !== 'agrupacion' &&
      kind !== 'entry')
  ) {
    res.status(400).json({ error: 'place_id, kind e id requeridos' })
    return
  }
  const result = occupy(getDb(), { place_id: placeId, kind, id })
  if ('error' in result) {
    res.status(result.status).json({ error: result.error })
    return
  }
  res.status(201).json({ ok: true })
})

mapRouter.delete('/occupy', (req, res) => {
  const body = req.body as {
    place_id?: string
    kind?: 'person' | 'project' | 'agrupacion' | 'entry'
    id?: string
  }
  const placeId = asString(body.place_id)
  const kind = body.kind
  const id = asString(body.id)
  if (
    !placeId ||
    !id ||
    (kind !== 'person' &&
      kind !== 'project' &&
      kind !== 'agrupacion' &&
      kind !== 'entry')
  ) {
    res.status(400).json({ error: 'place_id, kind e id requeridos' })
    return
  }
  unoccupy(getDb(), { place_id: placeId, kind, id })
  res.json({ ok: true })
})

mapRouter.get('/h3', (req, res) => {
  const lat = asNumber(req.query.lat)
  const lng = asNumber(req.query.lng)
  const resN = asNumber(req.query.res) ?? 8
  const k = asNumber(req.query.k) ?? 1
  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat y lng requeridos' })
    return
  }
  res.json({ ok: true, ...h3Radar(lat, lng, resN, k) })
})

mapRouter.get('/search-entries', (req, res) => {
  const q = asString(req.query.q)
  if (q.length < 1) {
    res.json({ ok: true, entries: [] })
    return
  }
  res.json({ ok: true, entries: searchEntries(getDb(), q) })
})
