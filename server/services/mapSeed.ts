import type { DatabaseSync } from 'node:sqlite'
import type { AmaPlaceKind } from '../types.js'
import { haversineMeters } from './amazona.js'
import { cellAt } from './h3geo.js'

type ZoneRole = 'nucleo' | 'sector' | 'micro' | 'ruta'

type ZoneSpec = {
  id: string
  name: string
  notes: string
  lat: number
  lng: number
  kind: AmaPlaceKind
  role: ZoneRole
  zone_code: string
  parent_id: string | null
  tags: string[]
}

const PATERNA = { lat: 39.5026, lng: -0.4415 }

const DEFAULT_LAYERS: Array<{
  id: string
  kind: string
  title: string
  z: number
  opacity: number
}> = [
  {
    id: 'map-layer-pghqg-fisico',
    kind: 'fisico',
    title: 'Físico-Geográfico',
    z: 1,
    opacity: 1,
  },
  {
    id: 'map-layer-pghqg-h3',
    kind: 'h3',
    title: 'El Panal H3',
    z: 2,
    opacity: 0.72,
  },
  {
    id: 'map-layer-pghqg-occupancy',
    kind: 'occupancy',
    title: 'Jurisdiccional / Ocupación',
    z: 3,
    opacity: 0.85,
  },
  {
    id: 'map-layer-pghqg-amazona',
    kind: 'amazona',
    title: 'AmazonA',
    z: 4,
    opacity: 0.9,
  },
  {
    id: 'map-layer-pghqg-aristas',
    kind: 'aristas',
    title: 'Aristas conectoras',
    z: 5,
    opacity: 0.9,
  },
  {
    id: 'map-layer-pghqg-chronos',
    kind: 'chronos',
    title: 'Chronos Cósmico',
    z: 6,
    opacity: 0.7,
  },
  {
    id: 'map-layer-pghqg-tags',
    kind: 'tags',
    title: 'Tags',
    z: 7,
    opacity: 1,
  },
]

function exists(db: DatabaseSync, table: string, id: string): boolean {
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .get(id) as { id: string } | undefined
  return Boolean(row)
}

function upsertPlace(db: DatabaseSync, spec: ZoneSpec, now: string): void {
  const h3 = cellAt(spec.lat, spec.lng)
  const tags = JSON.stringify(spec.tags)
  if (!exists(db, 'ama_places', spec.id)) {
    db.prepare(
      `INSERT INTO ama_places (
        id, name, notes, lat, lng, kind, tags,
        parent_id, h3_index, zone_code, role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      spec.id,
      spec.name,
      spec.notes,
      spec.lat,
      spec.lng,
      spec.kind,
      tags,
      spec.parent_id,
      h3,
      spec.zone_code,
      spec.role,
      now,
      now,
    )
    return
  }
  db.prepare(
    `UPDATE ama_places
     SET parent_id = ?, h3_index = ?, zone_code = ?, role = ?, updated_at = ?
     WHERE id = ?`,
  ).run(spec.parent_id, h3, spec.zone_code, spec.role, now, spec.id)
  const current = db
    .prepare(`SELECT lat FROM ama_places WHERE id = ?`)
    .get(spec.id) as { lat: number | null } | undefined
  if (current?.lat == null) {
    db.prepare(
      `UPDATE ama_places SET lat = ?, lng = ?, updated_at = ? WHERE id = ?`,
    ).run(spec.lat, spec.lng, now, spec.id)
  }
}

function insertFlow(
  db: DatabaseSync,
  spec: {
    id: string
    from_id: string
    to_id: string
    notes: string
    now: string
  },
): void {
  if (exists(db, 'ama_flows', spec.id)) return
  const from = db
    .prepare(`SELECT lat, lng FROM ama_places WHERE id = ?`)
    .get(spec.from_id) as { lat: number | null; lng: number | null } | undefined
  const to = db
    .prepare(`SELECT lat, lng FROM ama_places WHERE id = ?`)
    .get(spec.to_id) as { lat: number | null; lng: number | null } | undefined
  const distance =
    from?.lat != null &&
    from.lng != null &&
    to?.lat != null &&
    to.lng != null
      ? haversineMeters(from.lat, from.lng, to.lat, to.lng)
      : null
  db.prepare(
    `INSERT INTO ama_flows (
      id, from_place_id, to_place_id, recorded_at, notes, distance_m, cycle_slot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    spec.id,
    spec.from_id,
    spec.to_id,
    spec.now,
    spec.notes,
    distance,
    spec.now,
  )
}

function insertLayer(
  db: DatabaseSync,
  spec: {
    id: string
    system_id: string
    kind: string
    title: string
    z: number
    opacity: number
    now: string
  },
): void {
  if (exists(db, 'map_layers', spec.id)) return
  db.prepare(
    `INSERT INTO map_layers (
      id, system_id, kind, title, visible, opacity, z_index, config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, '{}', ?, ?)`,
  ).run(
    spec.id,
    spec.system_id,
    spec.kind,
    spec.title,
    spec.opacity,
    spec.z,
    spec.now,
    spec.now,
  )
}

function zones(): ZoneSpec[] {
  const nucleo: ZoneSpec[] = [
    {
      id: 'ama-place-valencia',
      name: 'Ciudad Valencia',
      notes: 'Núcleo — El Procesador Central. Trinchera: rodajes, eventos, ciudad.',
      lat: 39.4699,
      lng: -0.3763,
      kind: 'enclave',
      role: 'nucleo',
      zone_code: 'VAL',
      parent_id: null,
      tags: ['geografia', 'trinchera', 'nucleo'],
    },
    {
      id: 'ama-place-ciutat-vella',
      name: 'Ciutat Vella',
      notes: 'Núcleo histórico y burocrático — origen geográfico y de poder.',
      lat: 39.4752,
      lng: -0.3757,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-CV',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
    {
      id: 'ama-place-eixample',
      name: "L'Eixample / Ruzafa",
      notes: 'Centro comercial, gastronómico, máxima densidad social.',
      lat: 39.4628,
      lng: -0.3734,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-EX',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
    {
      id: 'ama-place-cac',
      name: 'Ciudad de las Artes y las Ciencias',
      notes: 'Polo turístico, arquitectónico, visión futurista.',
      lat: 39.4542,
      lng: -0.3502,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-CAC',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
    {
      id: 'ama-place-universitaria',
      name: 'Zona Universitaria',
      notes: 'Benimaclet / Blasco Ibáñez — motor académico, flujo de estudiantes.',
      lat: 39.4814,
      lng: -0.3448,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-UNI',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
    {
      id: 'ama-place-cabanyal',
      name: 'El Cabañal / Poblados Marítimos',
      notes: 'Frontera histórica con el mar, barrio pesquero.',
      lat: 39.4672,
      lng: -0.3278,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-CAB',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
    {
      id: 'ama-place-campanar',
      name: 'Campanar',
      notes: 'Residencial de expansión moderna, transición hacia Paterna.',
      lat: 39.481,
      lng: -0.4012,
      kind: 'enclave',
      role: 'micro',
      zone_code: 'VAL-CAM',
      parent_id: 'ama-place-valencia',
      tags: ['geografia', 'nucleo'],
    },
  ]

  const sectors: ZoneSpec[] = [
    {
      id: 'ama-place-paterna',
      name: 'Paterna',
      notes: 'Estación táctica, cañón de movimiento. Castillo del Tridente Táctico.',
      lat: PATERNA.lat,
      lng: PATERNA.lng,
      kind: 'enclave',
      role: 'sector',
      zone_code: 'PAT',
      parent_id: null,
      tags: ['geografia', 'castillo', 'sector'],
    },
    {
      id: 'ama-place-torrent',
      name: 'Torrent',
      notes: 'Foco urbano del cinturón metropolitano.',
      lat: 39.4371,
      lng: -0.4653,
      kind: 'enclave',
      role: 'sector',
      zone_code: 'TOR',
      parent_id: null,
      tags: ['geografia', 'sector'],
    },
    {
      id: 'ama-place-horta-sud',
      name: 'Horta Sud',
      notes: 'Foco de comunidad y conectividad regional.',
      lat: 39.448,
      lng: -0.42,
      kind: 'region',
      role: 'sector',
      zone_code: 'HS',
      parent_id: null,
      tags: ['geografia', 'sector'],
    },
    {
      id: 'ama-place-sagunto-castillo',
      name: 'Sagunto Castillo',
      notes: 'Foco histórico y estratégico. Plaza de Armas / ciudadela.',
      lat: 39.6769,
      lng: -0.2778,
      kind: 'enclave',
      role: 'sector',
      zone_code: 'SGC',
      parent_id: null,
      tags: ['geografia', 'sector'],
    },
    {
      id: 'ama-place-puerto-sagunto',
      name: 'Puerto Sagunto',
      notes: 'Foco logístico e industrial.',
      lat: 39.6558,
      lng: -0.2189,
      kind: 'enclave',
      role: 'sector',
      zone_code: 'PUS',
      parent_id: null,
      tags: ['geografia', 'sector'],
    },
    {
      id: 'ama-place-puerto-valencia',
      name: 'Puerto de Valencia',
      notes: 'Foco marítimo y comercial. Mediterráneo.',
      lat: 39.4457,
      lng: -0.3223,
      kind: 'enclave',
      role: 'sector',
      zone_code: 'PUV',
      parent_id: null,
      tags: ['geografia', 'sector'],
    },
    {
      id: 'ama-place-campamento',
      name: 'Campamento Paterna–Valencia',
      notes: 'Arista Central: ruta entre Paterna (base) y Valencia ciudad.',
      lat: 39.4862,
      lng: -0.4089,
      kind: 'ruta',
      role: 'ruta',
      zone_code: 'CAM',
      parent_id: null,
      tags: ['geografia', 'campamento', 'ruta'],
    },
  ]

  const micros: ZoneSpec[] = [
    {
      id: 'ama-place-pus-terminal',
      name: 'Terminal de Contenedores y Muelles',
      notes: 'Entrada/salida de bienes internacionales.',
      lat: 39.6492,
      lng: -0.2064,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-1',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pus-ingruinsa',
      name: 'Polígono Industrial Ingruinsa',
      notes: 'Talleres pesados, forja, producción a gran escala.',
      lat: 39.6621,
      lng: -0.2304,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-2',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pus-zona-franca',
      name: 'Zona Franca y Aduanas',
      notes: 'Control de mercancías, retención estratégica.',
      lat: 39.6514,
      lng: -0.2152,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-3',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pus-barrio-obrero',
      name: 'Barrio Obrero / Altos Hornos',
      notes: 'Residencias históricas, memoria sindical.',
      lat: 39.6602,
      lng: -0.2201,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-4',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pus-paseo',
      name: 'Paseo Marítimo y Playa',
      notes: 'Borde recreativo frente al océano.',
      lat: 39.6453,
      lng: -0.2102,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-5',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pus-nudo',
      name: 'Nudo Ferroviario de Mercancías',
      notes: 'Arteria que conecta el puerto con el continente.',
      lat: 39.6584,
      lng: -0.2253,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUS-6',
      parent_id: 'ama-place-puerto-sagunto',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-plaza-armas',
      name: 'Plaza de Armas y Ciudadela',
      notes: 'Punto más alto, mando con visión 360°.',
      lat: 39.6775,
      lng: -0.2785,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-1',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-teatro',
      name: 'Teatro Romano',
      notes: 'Cultura, acústica, resonancia del pasado.',
      lat: 39.6763,
      lng: -0.277,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-2',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-juderia',
      name: 'Judería / Casco Antiguo',
      notes: 'Laberinto de calles estrechas.',
      lat: 39.6755,
      lng: -0.2765,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-3',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-murallas',
      name: 'Murallas Perimetrales',
      notes: 'Límite defensivo de la jurisdicción.',
      lat: 39.6782,
      lng: -0.279,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-4',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-foro',
      name: 'Foro / Ruinas Cívicas',
      notes: 'Antiguo centro de debate y mercado romano.',
      lat: 39.6768,
      lng: -0.2768,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-5',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-sgc-calvario',
      name: 'El Calvario / Laderas',
      notes: 'Vías de acceso escarpadas, rutas tácticas.',
      lat: 39.675,
      lng: -0.28,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'SGC-6',
      parent_id: 'ama-place-sagunto-castillo',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-marina',
      name: 'La Marina / Tinglados',
      notes: 'Innovación, startups, hub tecnológico (Lanzadera).',
      lat: 39.4621,
      lng: -0.3274,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-1',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-cruceros',
      name: 'Terminal de Cruceros',
      notes: 'Turismo masivo, capital flotante de corto plazo.',
      lat: 39.4442,
      lng: -0.3181,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-2',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-zal',
      name: 'ZAL (Zona de Actividades Logísticas)',
      notes: 'Almacenamiento masivo, distribución rápida.',
      lat: 39.4304,
      lng: -0.3302,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-3',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-veles',
      name: 'Veles e Vents / Club Náutico',
      notes: 'Círculos de alto nivel, negocios, networking.',
      lat: 39.4602,
      lng: -0.3241,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-4',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-astilleros',
      name: 'Astilleros / Diques Secos',
      notes: 'Reparación naval, ingeniería, fuerza mecánica.',
      lat: 39.4481,
      lng: -0.3224,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-5',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-puv-faro',
      name: 'El Faro y la Escollera',
      notes: 'Límite exterior, rompeolas, vigilancia marítima.',
      lat: 39.4421,
      lng: -0.3004,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PUV-6',
      parent_id: 'ama-place-puerto-valencia',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-valterna',
      name: 'Valterna / Terramelar',
      notes: 'Residencial segura, sede de incubación (Terreta Hub).',
      lat: 39.5082,
      lng: -0.4281,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-1',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-jarro',
      name: 'Polígono Fuente del Jarro',
      notes: 'Motor económico, fábricas, ruido industrial.',
      lat: 39.5164,
      lng: -0.4602,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-2',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-parque-tec',
      name: 'Parque Tecnológico',
      notes: 'I+D, servidores, clúster de datos.',
      lat: 39.5381,
      lng: -0.4624,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-3',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-deportiva',
      name: 'Ciudad Deportiva',
      notes: 'Entrenamiento, disciplina física, cantera.',
      lat: 39.5102,
      lng: -0.4351,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-4',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-casco',
      name: 'Casco Urbano / Ayuntamiento',
      notes: 'Centro burocrático y administrativo local.',
      lat: PATERNA.lat,
      lng: PATERNA.lng,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-5',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-pat-cuarteles',
      name: 'Cuarteles y Base Militar',
      notes: 'Fuerza bruta, defensa táctica del territorio.',
      lat: 39.5071,
      lng: -0.4522,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'PAT-6',
      parent_id: 'ama-place-paterna',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-vedat-av',
      name: 'Avenida al Vedat',
      notes: 'Arteria comercial/financiera, bancos, tiendas.',
      lat: 39.4342,
      lng: -0.4701,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-1',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-vedat',
      name: 'El Vedat / Zonas Altas',
      notes: 'Residencial aislado, bosque, estatus social.',
      lat: 39.4251,
      lng: -0.4902,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-2',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-casco',
      name: 'Casco Viejo / La Torre',
      notes: 'Centro histórico, orígenes medievales.',
      lat: 39.4371,
      lng: -0.4653,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-3',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-parc',
      name: 'Parc Central',
      notes: 'Nueva expansión urbana, espacios verdes.',
      lat: 39.4402,
      lng: -0.4581,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-4',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-jutge',
      name: 'Polígono Mas del Jutge',
      notes: 'Extensión industrial secundaria.',
      lat: 39.4304,
      lng: -0.4482,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-5',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-tor-metro',
      name: 'Nudos de Metro',
      notes: 'Control del flujo de transporte masivo hacia la capital.',
      lat: 39.4362,
      lng: -0.4621,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'TOR-6',
      parent_id: 'ama-place-torrent',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-catarroja',
      name: 'Catarroja',
      notes: 'Formación, cruce de caminos, puerto interior hacia la Albufera.',
      lat: 39.4032,
      lng: -0.4051,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-1',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-benetusser',
      name: 'Benetússer',
      notes: 'Red social de proximidad, densidad barrial.',
      lat: 39.4251,
      lng: -0.3972,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-2',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-alfafar',
      name: 'Alfafar / Zona Comercial MN4',
      notes: 'Consumismo masivo, alto tráfico de capital.',
      lat: 39.4202,
      lng: -0.3904,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-3',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-sedavi',
      name: 'Sedaví',
      notes: 'Transición logística, límite inmediato con la capital.',
      lat: 39.4281,
      lng: -0.3852,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-4',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-albal',
      name: 'Albal / Massanassa',
      notes: 'Extensión comercial/industrial (Pista de Silla).',
      lat: 39.4103,
      lng: -0.4002,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-5',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
    {
      id: 'ama-place-hs-albufera',
      name: 'Parque Natural de la Albufera',
      notes: 'Origen orgánico, arrozales, aislamiento natural.',
      lat: 39.3402,
      lng: -0.3551,
      kind: 'lugar',
      role: 'micro',
      zone_code: 'HS-6',
      parent_id: 'ama-place-horta-sud',
      tags: ['geografia', 'micro'],
    },
  ]

  return [...nucleo, ...sectors, ...micros]
}

export const DEFAULT_LAYER_SPECS = DEFAULT_LAYERS

export function seedMap(db: DatabaseSync): void {
  const now = new Date().toISOString()
  for (const zone of zones()) upsertPlace(db, zone, now)

  insertFlow(db, {
    id: 'ama-flow-arista-central',
    from_id: 'ama-place-valencia',
    to_id: 'ama-place-paterna',
    notes:
      'Arista Central: corredor táctico-tecnológico Valencia ↔ Paterna (Valterna / Parque Tecnológico).',
    now,
  })
  insertFlow(db, {
    id: 'ama-flow-arista-comercial',
    from_id: 'ama-place-valencia',
    to_id: 'ama-place-puerto-valencia',
    notes:
      'Arista Comercial: canal de inyección Valencia ↔ Puerto de Valencia (bienes y turismo).',
    now,
  })
  insertFlow(db, {
    id: 'ama-flow-arista-demografica',
    from_id: 'ama-place-valencia',
    to_id: 'ama-place-torrent',
    notes:
      'Arista Demográfica: cinturón del consumo Valencia ↔ Torrent ↔ Horta Sud.',
    now,
  })
  insertFlow(db, {
    id: 'ama-flow-arista-hierro',
    from_id: 'ama-place-puerto-sagunto',
    to_id: 'ama-place-sagunto-castillo',
    notes:
      'Arista del Hierro: eje de poder bruto Puerto de Sagunto ↔ Castillo de Sagunto.',
    now,
  })
  insertFlow(db, {
    id: 'ama-flow-arista-norte-sur',
    from_id: 'ama-place-sagunto-castillo',
    to_id: 'ama-place-valencia',
    notes: 'Arista Norte-Sur: vía romana / by-pass Sagunto ↔ Valencia.',
    now,
  })
  insertFlow(db, {
    id: 'ama-flow-arista-anillo',
    from_id: 'ama-place-valencia',
    to_id: 'ama-place-puerto-sagunto',
    notes:
      'Arista del Anillo: cierre costero Valencia ↔ Puerto de Sagunto (evita Castillo).',
    now,
  })

  if (!exists(db, 'map_systems', 'map-sys-pghqg')) {
    db.prepare(
      `INSERT INTO map_systems (
        id, name, notes, center_lat, center_lng, zoom, pitch, bearing, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 13, 45, 0, ?, ?)`,
    ).run(
      'map-sys-pghqg',
      'PGHQG Paterna',
      'Sistema por defecto: Valencia + 6 sectores, panal H3, aristas y Chronos. Cámara en Paterna.',
      PATERNA.lat,
      PATERNA.lng,
      now,
      now,
    )
  }

  for (const layer of DEFAULT_LAYERS) {
    insertLayer(db, {
      id: layer.id,
      system_id: 'map-sys-pghqg',
      kind: layer.kind,
      title: layer.title,
      z: layer.z,
      opacity: layer.opacity,
      now,
    })
  }
}
