/**
 * Semilla del gazetteer administrativo (ids estables).
 * Geometría: ICV (comarcas CV) + Natural Earth (continentes / España).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

const GEO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/geo',
)

export type AdminType =
  | 'continente'
  | 'nacion'
  | 'comunidad_autonoma'
  | 'provincia'
  | 'comarca'

type SeedNode = {
  id: string
  name: string
  parent_id: string | null
  admin_type: AdminType
  admin_code: string | null
  capital_name: string | null
  iso_country: string | null
  kind: 'lugar' | 'region' | 'pais'
  aliases: string[]
  sort_order: number
  geomFile?: string
  geomId?: string
}

type GeoJSON = {
  type: string
  features?: Array<{
    id?: string
    properties?: { id?: string; name?: string }
    geometry: unknown
    bbox?: number[]
  }>
  geometry?: unknown
  bbox?: number[]
}

const COMARCAS: Array<{
  code: string
  name: string
  province: '12' | '46' | '03'
  capital: string
  aliases: string[]
}> = [
  { code: '01', name: 'Els Ports', province: '12', capital: 'Morella', aliases: ['els Ports', 'Los Puertos'] },
  { code: '02', name: "L'Alt Maestrat", province: '12', capital: 'Albocàsser', aliases: ["l'Alt Maestrat", 'Alto Maestrazgo', "Alt Maestrat"] },
  { code: '03', name: 'El Baix Maestrat', province: '12', capital: 'Vinaròs', aliases: ['el Baix Maestrat', 'Bajo Maestrazgo'] },
  { code: '04', name: "L'Alcalatén", province: '12', capital: "L'Alcora", aliases: ["l'Alcalatén", 'Alcalatén'] },
  { code: '05', name: 'La Plana Alta', province: '12', capital: 'Castelló de la Plana', aliases: ['la Plana Alta', 'Plana Alta', 'Castellón de la Plana'] },
  { code: '06', name: 'La Plana Baixa', province: '12', capital: 'Onda / Borriana', aliases: ['la Plana Baixa', 'Plana Baja', 'Burriana'] },
  { code: '07', name: 'El Alto Palancia', province: '12', capital: 'Segorbe', aliases: ['El Alto Palancia', 'Alt Palància'] },
  { code: '08', name: 'El Alto Mijares', province: '12', capital: 'Cirat', aliases: ['El Alto Mijares', 'Alt Millars'] },
  { code: '09', name: 'El Rincón de Ademuz', province: '46', capital: 'Ademuz', aliases: ['El Rincón de Ademuz', 'Racó d’Ademús', "Rincón de Ademuz"] },
  { code: '10', name: 'Los Serranos', province: '46', capital: 'Chelva', aliases: ['La Serranía', 'Els Serrans', 'Serranía'] },
  { code: '11', name: 'El Camp de Túria', province: '46', capital: 'Llíria', aliases: ['el Camp de Túria', 'Campo de Turia', 'Camp de Túria'] },
  { code: '12', name: 'El Camp de Morvedre', province: '46', capital: 'Sagunt', aliases: ['el Camp de Morvedre', 'Campo de Murviedro', 'Sagunto'] },
  { code: '13', name: "L'Horta Nord", province: '46', capital: 'Burjassot', aliases: ["l'Horta Nord", 'Huerta Norte'] },
  { code: '15', name: 'València', province: '46', capital: 'València', aliases: ['València', 'Valencia', 'Valencia ciudad'] },
  { code: '16', name: "L'Horta Sud", province: '46', capital: 'Torrent', aliases: ["l'Horta Sud", 'Huerta Sur'] },
  { code: '17', name: 'La Plana de Utiel-Requena', province: '46', capital: 'Requena', aliases: ['La Plana de Utiel-Requena', 'Utiel-Requena', 'Plana de Utiel'] },
  { code: '18', name: 'La Hoya de Buñol', province: '46', capital: 'Buñol', aliases: ['La Hoya de Buñol', 'Foia de Bunyol'] },
  { code: '19', name: 'El Valle de Cofrentes-Ayora', province: '46', capital: 'Ayora', aliases: ['El Valle de Cofrentes-Ayora', 'Valle de Ayora', 'Cofrentes-Ayora'] },
  { code: '20', name: 'La Ribera Alta', province: '46', capital: 'Alzira', aliases: ['la Ribera Alta', 'Ribera Alta', 'Alcira'] },
  { code: '21', name: 'La Ribera Baixa', province: '46', capital: 'Sueca', aliases: ['la Ribera Baixa', 'Ribera Baja'] },
  { code: '22', name: 'La Canal de Navarrés', province: '46', capital: 'Enguera', aliases: ['La Canal de Navarrés', 'Canal de Navarrés'] },
  { code: '23', name: 'La Costera', province: '46', capital: 'Xàtiva', aliases: ['la Costera', 'Costera', 'Játiva'] },
  { code: '24', name: "La Vall d'Albaida", province: '46', capital: 'Ontinyent', aliases: ["la Vall d'Albaida", "Vall d'Albaida", 'Valle de Albaida', 'Onteniente'] },
  { code: '25', name: 'La Safor', province: '46', capital: 'Gandia', aliases: ['la Safor', 'Safor', 'Gandía'] },
  { code: '26', name: 'El Comtat', province: '03', capital: 'Cocentaina', aliases: ['el Comtat', 'Comtat', 'Condado'] },
  { code: '27', name: "L'Alcoià", province: '03', capital: 'Alcoi', aliases: ["l'Alcoià", 'Alcoià', 'Hoya de Alcoy', 'Alcoy'] },
  { code: '28', name: "L'Alt Vinalopó", province: '03', capital: 'Villena', aliases: ["l’Alt Vinalopó/El Alto Vinalopó", 'Alto Vinalopó', "l'Alt Vinalopó"] },
  { code: '29', name: 'El Vinalopó Mitjà', province: '03', capital: 'Elda', aliases: ['el Vinalopó Mitjà/El Vinalopó Medio', 'Vinalopó Medio', 'Vinalopó Mitjà'] },
  { code: '30', name: 'La Marina Alta', province: '03', capital: 'Dénia', aliases: ['la Marina Alta', 'Marina Alta', 'Denia'] },
  { code: '31', name: 'La Marina Baixa', province: '03', capital: 'Villajoyosa', aliases: ['la Marina Baixa', 'Marina Baja', 'La Vila Joiosa'] },
  { code: '32', name: "L'Alacantí", province: '03', capital: 'Alacant', aliases: ["l'Alacantí", 'Alacantí', 'Alicante'] },
  { code: '33', name: 'El Baix Vinalopó', province: '03', capital: 'Elx', aliases: ['el Baix Vinalopó', 'Bajo Vinalopó', 'Elche'] },
  { code: '34', name: 'El Baix Segura / La Vega Baja', province: '03', capital: 'Orihuela', aliases: ['el Baix Segura/La Vega Baja', 'Baix Segura', 'Vega Baja', 'Bajo Segura'] },
]

function nodes(): SeedNode[] {
  const list: SeedNode[] = [
    { id: 'geo-africa', name: 'África', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: ['Africa'], sort_order: 10, geomFile: 'continentes.geojson', geomId: 'geo-africa' },
    { id: 'geo-america', name: 'América', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: ['America', 'América del Norte', 'América del Sur'], sort_order: 20, geomFile: 'continentes.geojson', geomId: 'geo-america' },
    { id: 'geo-asia', name: 'Asia', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: [], sort_order: 30, geomFile: 'continentes.geojson', geomId: 'geo-asia' },
    { id: 'geo-europa', name: 'Europa', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: ['Europe'], sort_order: 40, geomFile: 'europa.geojson', geomId: 'geo-europa' },
    { id: 'geo-oceania', name: 'Oceanía', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: ['Oceania', 'Australia'], sort_order: 50, geomFile: 'continentes.geojson', geomId: 'geo-oceania' },
    { id: 'geo-antartida', name: 'Antártida', parent_id: null, admin_type: 'continente', admin_code: null, capital_name: null, iso_country: null, kind: 'region', aliases: ['Antarctica', 'Antártica'], sort_order: 60, geomFile: 'continentes.geojson', geomId: 'geo-antartida' },
    { id: 'geo-es', name: 'España', parent_id: 'geo-europa', admin_type: 'nacion', admin_code: 'ES', capital_name: 'Madrid', iso_country: 'ES', kind: 'pais', aliases: ['Spain', 'Estado español', 'Reino de España'], sort_order: 1, geomFile: 'espana.geojson', geomId: 'geo-es' },
    { id: 'geo-es-vc', name: 'Comunitat Valenciana', parent_id: 'geo-es', admin_type: 'comunidad_autonoma', admin_code: 'VC', capital_name: 'València', iso_country: 'ES', kind: 'region', aliases: ['Comunidad Valenciana', 'País Valencià', 'C. Valenciana', 'CV'], sort_order: 10, geomFile: 'cv.geojson', geomId: 'geo-es-vc' },
    { id: 'geo-es-12', name: 'Castellón', parent_id: 'geo-es-vc', admin_type: 'provincia', admin_code: '12', capital_name: 'Castelló de la Plana', iso_country: 'ES', kind: 'region', aliases: ['Castelló', 'Provincia de Castellón', 'Castelló/Castellón'], sort_order: 12, geomFile: 'provincias-cv.geojson', geomId: 'geo-es-12' },
    { id: 'geo-es-46', name: 'Valencia', parent_id: 'geo-es-vc', admin_type: 'provincia', admin_code: '46', capital_name: 'València', iso_country: 'ES', kind: 'region', aliases: ['València', 'Provincia de Valencia', 'València/Valencia'], sort_order: 46, geomFile: 'provincias-cv.geojson', geomId: 'geo-es-46' },
    { id: 'geo-es-03', name: 'Alicante', parent_id: 'geo-es-vc', admin_type: 'provincia', admin_code: '03', capital_name: 'Alacant', iso_country: 'ES', kind: 'region', aliases: ['Alacant', 'Provincia de Alicante', 'Alacant/Alicante'], sort_order: 3, geomFile: 'provincias-cv.geojson', geomId: 'geo-es-03' },
  ]
  for (const c of COMARCAS) {
    list.push({
      id: `geo-es-vc-${c.code}`,
      name: c.name,
      parent_id: `geo-es-${c.province}`,
      admin_type: 'comarca',
      admin_code: c.code,
      capital_name: c.capital,
      iso_country: 'ES',
      kind: 'region',
      aliases: c.aliases,
      sort_order: Number(c.code),
      geomFile: 'comarcas-cv.geojson',
      geomId: `geo-es-vc-${c.code}`,
    })
  }
  return list
}

function loadCollection(file: string): GeoJSON {
  const p = path.join(GEO_DIR, file)
  return JSON.parse(fs.readFileSync(p, 'utf8')) as GeoJSON
}

function walkCoords(geom: unknown, fn: (lng: number, lat: number) => void): void {
  if (!geom || typeof geom !== 'object') return
  const g = geom as { type?: string; coordinates?: unknown }
  const walk = (c: unknown): void => {
    if (!Array.isArray(c) || c.length === 0) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      fn(c[0], c[1])
      return
    }
    for (const x of c) walk(x)
  }
  walk(g.coordinates)
}

function boundsOf(geom: unknown): {
  bbox: [number, number, number, number]
  lng: number
  lat: number
} | null {
  let minx = Infinity
  let miny = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  let n = 0
  let sx = 0
  let sy = 0
  walkCoords(geom, (lng, lat) => {
    minx = Math.min(minx, lng)
    miny = Math.min(miny, lat)
    maxx = Math.max(maxx, lng)
    maxy = Math.max(maxy, lat)
    sx += lng
    sy += lat
    n++
  })
  if (!n || !Number.isFinite(minx)) return null
  return { bbox: [minx, miny, maxx, maxy], lng: sx / n, lat: sy / n }
}

function mergeGeometries(geoms: unknown[]): unknown | null {
  const parts: unknown[] = []
  for (const geom of geoms) {
    if (!geom || typeof geom !== 'object') continue
    const g = geom as { type?: string; coordinates?: unknown }
    if (g.type === 'Polygon') parts.push(g.coordinates)
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      parts.push(...(g.coordinates as unknown[]))
    }
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return { type: 'Polygon', coordinates: parts[0] }
  return { type: 'MultiPolygon', coordinates: parts }
}

function featureGeom(col: GeoJSON, id: string): unknown | null {
  const f = (col.features ?? []).find(
    (x) => x.id === id || x.properties?.id === id,
  )
  return f?.geometry ?? null
}

export function seedGazetteer(database: DatabaseSync): void {
  if (!fs.existsSync(GEO_DIR)) {
    console.warn('[gazetteer] falta', GEO_DIR)
    return
  }
  const now = new Date().toISOString()
  const catalog = nodes()

  const files = new Map<string, GeoJSON>()
  const read = (file: string) => {
    let col = files.get(file)
    if (!col) {
      col = loadCollection(file)
      files.set(file, col)
    }
    return col
  }

  const americaN = featureGeom(read('continentes.geojson'), 'geo-america-norte')
  const americaS = featureGeom(read('continentes.geojson'), 'geo-america-sur')
  const america = mergeGeometries([americaN, americaS].filter(Boolean))

  const insert = database.prepare(
    `INSERT INTO geografia (
      id, name, kind, aliases, notes, status, source, merged_into,
      parent_id, admin_type, admin_code, capital_name, iso_country,
      human_weight, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 'active', 'official', NULL, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
  const update = database.prepare(
    `UPDATE geografia
     SET name = ?, kind = ?, parent_id = ?, admin_type = ?, admin_code = ?,
         capital_name = ?, iso_country = ?, sort_order = ?, source = 'official',
         status = 'active', merged_into = NULL, updated_at = ?
     WHERE id = ?`,
  )
  const upsertGeom = database.prepare(
    `INSERT INTO geografia_geom (
      geografia_id, geojson, bbox_west, bbox_south, bbox_east, bbox_north,
      centroid_lng, centroid_lat, geom_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(geografia_id) DO UPDATE SET
      geojson = excluded.geojson,
      bbox_west = excluded.bbox_west,
      bbox_south = excluded.bbox_south,
      bbox_east = excluded.bbox_east,
      bbox_north = excluded.bbox_north,
      centroid_lng = excluded.centroid_lng,
      centroid_lat = excluded.centroid_lat,
      geom_source = excluded.geom_source`,
  )
  const existing = database.prepare(`SELECT id FROM geografia WHERE id = ?`)

  let n = 0
  let g = 0
  for (const node of catalog) {
    const aliases = JSON.stringify(node.aliases)
    const row = existing.get(node.id) as { id: string } | undefined
    if (!row) {
      insert.run(
        node.id,
        node.name,
        node.kind,
        aliases,
        node.parent_id,
        node.admin_type,
        node.admin_code,
        node.capital_name,
        node.iso_country,
        node.sort_order,
        now,
        now,
      )
    } else {
      update.run(
        node.name,
        node.kind,
        node.parent_id,
        node.admin_type,
        node.admin_code,
        node.capital_name,
        node.iso_country,
        node.sort_order,
        now,
        node.id,
      )
    }
    n++

    let geom: unknown = null
    if (node.id === 'geo-america') geom = america
    else if (node.geomFile && node.geomId) {
      geom = featureGeom(read(node.geomFile), node.geomId)
    }
    if (!geom) continue
    const b = boundsOf(geom)
    if (!b) continue
    const source =
      node.admin_type === 'comarca' ||
      node.admin_type === 'provincia' ||
      node.admin_type === 'comunidad_autonoma'
        ? 'icv'
        : 'naturalearth'
    upsertGeom.run(
      node.id,
      JSON.stringify(geom),
      b.bbox[0],
      b.bbox[1],
      b.bbox[2],
      b.bbox[3],
      b.lng,
      b.lat,
      source,
    )
    g++
  }
  console.log(`[gazetteer] ${n} nodos, ${g} geometrías`)
}
