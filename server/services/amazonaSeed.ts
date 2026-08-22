import type { DatabaseSync } from 'node:sqlite'
import type { AmaListKind, AmaPlaceKind } from '../types.js'
import { KIND_SIZE } from './amazona.js'

type SeedChild = { id: string; label: string; notes?: string }

type SeedItem = {
  id: string
  label: string
  notes?: string
  place_id?: string | null
  children?: SeedChild[]
}

function exists(db: DatabaseSync, table: string, id: string): boolean {
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .get(id) as { id: string } | undefined
  return Boolean(row)
}

function insertPlace(
  db: DatabaseSync,
  spec: {
    id: string
    name: string
    notes: string
    lat: number
    lng: number
    kind: AmaPlaceKind
    tags: string[]
    now: string
  },
): void {
  if (exists(db, 'ama_places', spec.id)) return
  db.prepare(
    `INSERT INTO ama_places (id, name, notes, lat, lng, kind, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    spec.id,
    spec.name,
    spec.notes,
    spec.lat,
    spec.lng,
    spec.kind,
    JSON.stringify(spec.tags),
    spec.now,
    spec.now,
  )
}

function insertList(
  db: DatabaseSync,
  spec: {
    id: string
    title: string
    notes: string
    kind: AmaListKind
    tags: string[]
    items: SeedItem[]
    now: string
  },
): void {
  if (exists(db, 'ama_lists', spec.id)) return
  const size = KIND_SIZE[spec.kind]
  db.prepare(
    `INSERT INTO ama_lists (id, title, notes, size, kind, source, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'seed', ?, ?, ?)`,
  ).run(
    spec.id,
    spec.title,
    spec.notes,
    size,
    spec.kind,
    JSON.stringify(spec.tags),
    spec.now,
    spec.now,
  )
  spec.items.forEach((item, index) => {
    db.prepare(
      `INSERT INTO ama_list_items (
        id, list_id, position, label, notes, place_id, parent_item_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      item.id,
      spec.id,
      index,
      item.label,
      item.notes ?? '',
      item.place_id ?? null,
      spec.now,
      spec.now,
    )
    item.children?.forEach((child, cIndex) => {
      db.prepare(
        `INSERT INTO ama_list_items (
          id, list_id, position, label, notes, place_id, parent_item_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '', NULL, ?, ?, ?)`,
      ).run(child.id, spec.id, cIndex, child.label, item.id, spec.now, spec.now)
    })
  })
}

function insertComposedLista6(
  db: DatabaseSync,
  spec: {
    id: string
    title: string
    notes: string
    tags: string[]
    tridenteA: string
    tridenteB: string
    now: string
  },
): void {
  if (!exists(db, 'ama_lists', spec.id)) {
    db.prepare(
      `INSERT INTO ama_lists (id, title, notes, size, kind, source, tags, created_at, updated_at)
       VALUES (?, ?, ?, 6, 'lista6', 'composed', ?, ?, ?)`,
    ).run(
      spec.id,
      spec.title,
      spec.notes,
      JSON.stringify(spec.tags),
      spec.now,
      spec.now,
    )
  }
  const parts = db
    .prepare(`SELECT lista6_id FROM ama_lista6_parts WHERE lista6_id = ?`)
    .get(spec.id) as { lista6_id: string } | undefined
  if (!parts) {
    db.prepare(
      `INSERT INTO ama_lista6_parts (lista6_id, tridente_a_id, tridente_b_id)
       VALUES (?, ?, ?)`,
    ).run(spec.id, spec.tridenteA, spec.tridenteB)
  }
}

function insertMatrix(
  db: DatabaseSync,
  spec: {
    id: string
    title: string
    notes: string
    rowListId: string
    colListId: string
    tags: string[]
    now: string
  },
): void {
  if (exists(db, 'ama_matrices', spec.id)) return
  db.prepare(
    `INSERT INTO ama_matrices (
      id, title, notes, order_n, row_list_id, col_list_id, tags, neo_swapped, created_at, updated_at
    ) VALUES (?, ?, ?, 6, ?, ?, ?, 0, ?, ?)`,
  ).run(
    spec.id,
    spec.title,
    spec.notes,
    spec.rowListId,
    spec.colListId,
    JSON.stringify(spec.tags),
    spec.now,
    spec.now,
  )
}

function insertLink(
  db: DatabaseSync,
  spec: {
    id: string
    object_type: string
    object_id: string
    target_kind: string
    target_id: string
    now: string
  },
): void {
  if (exists(db, 'ama_links', spec.id)) return
  db.prepare(
    `INSERT INTO ama_links (
      id, object_type, object_id, target_kind, target_id, role, created_at
    ) VALUES (?, ?, ?, ?, ?, 'tag', ?)`,
  ).run(
    spec.id,
    spec.object_type,
    spec.object_id,
    spec.target_kind,
    spec.target_id,
    spec.now,
  )
}

export function seedAmazona(db: DatabaseSync): void {
  const now = new Date().toISOString()

  if (!exists(db, 'ama_cycle_state', 'current')) {
    db.prepare(
      `INSERT INTO ama_cycle_state (id, offset, hoy_started_at) VALUES ('current', 0, ?)`,
    ).run(now)
  }

  insertPlace(db, {
    id: 'ama-place-paterna',
    name: 'Paterna',
    notes: 'Base de operaciones. Castillo del Tridente Táctico.',
    lat: 39.5026,
    lng: -0.4415,
    kind: 'enclave',
    tags: ['geografia', 'castillo'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-torrent',
    name: 'Torrent',
    notes: 'Enclave estratégico del área metropolitana.',
    lat: 39.4371,
    lng: -0.4653,
    kind: 'enclave',
    tags: ['geografia'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-horta-sud',
    name: 'Horta Sud',
    notes: 'Región H.S. — comarca al sur de Valencia.',
    lat: 39.448,
    lng: -0.42,
    kind: 'region',
    tags: ['geografia'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-sagunto-castillo',
    name: 'Sagunto Castillo',
    notes: 'Castillo de Sagunto.',
    lat: 39.6769,
    lng: -0.2778,
    kind: 'enclave',
    tags: ['geografia'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-puerto-sagunto',
    name: 'Puerto Sagunto',
    notes: 'Puerto de Sagunto.',
    lat: 39.6558,
    lng: -0.2189,
    kind: 'enclave',
    tags: ['geografia'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-valencia',
    name: 'Ciudad Valencia',
    notes: 'Trinchera: rodajes, eventos, ciudad.',
    lat: 39.4699,
    lng: -0.3763,
    kind: 'enclave',
    tags: ['geografia', 'trinchera'],
    now,
  })
  insertPlace(db, {
    id: 'ama-place-campamento',
    name: 'Campamento Paterna–Valencia',
    notes: 'Ruta entre Paterna (base) y Valencia ciudad.',
    lat: 39.4862,
    lng: -0.4089,
    kind: 'ruta',
    tags: ['geografia', 'campamento'],
    now,
  })

  insertList(db, {
    id: 'ama-tridente-dimensional',
    title: 'Tridente Dimensional',
    notes: 'Cara del hexágono operativo. Cuerpo | Mente | Alma.',
    kind: 'tridente',
    tags: ['hexagono'],
    now,
    items: [
      { id: 'ama-item-dimensional-cuerpo', label: 'Cuerpo' },
      { id: 'ama-item-dimensional-mente', label: 'Mente' },
      { id: 'ama-item-dimensional-alma', label: 'Alma' },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-tactico',
    title: 'Tridente Táctico',
    notes:
      'Se mapea al mapa físico: Castillo = Paterna, Campamento = rutas Paterna–Valencia, Trinchera = Valencia ciudad.',
    kind: 'tridente',
    tags: ['hexagono', 'geografia'],
    now,
    items: [
      {
        id: 'ama-item-tactico-castillo',
        label: 'Castillo',
        notes: 'Base de operaciones.',
        place_id: 'ama-place-paterna',
      },
      {
        id: 'ama-item-tactico-campamento',
        label: 'Campamento',
        notes: 'Rutas entre Paterna y Valencia.',
        place_id: 'ama-place-campamento',
      },
      {
        id: 'ama-item-tactico-trinchera',
        label: 'Trinchera',
        notes: 'Valencia ciudad: rodajes, eventos.',
        place_id: 'ama-place-valencia',
      },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-temporal',
    title: 'Tridente Temporal',
    notes: 'Pasado | Presente | Futuro. Se mapea al mapa estelar (no es el calendario operativo Ayer/Hoy/Mañana).',
    kind: 'tridente',
    tags: ['hexagono', 'estelar'],
    now,
    items: [
      { id: 'ama-item-temporal-pasado', label: 'Pasado' },
      { id: 'ama-item-temporal-presente', label: 'Presente' },
      { id: 'ama-item-temporal-futuro', label: 'Futuro' },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-procesamiento',
    title: 'Tridente de Procesamiento',
    notes: 'Entrada | Transformación | Salida.',
    kind: 'tridente',
    tags: ['hexagono'],
    now,
    items: [
      { id: 'ama-item-proceso-entrada', label: 'Entrada' },
      { id: 'ama-item-proceso-transformacion', label: 'Transformación' },
      { id: 'ama-item-proceso-salida', label: 'Salida' },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-escala',
    title: 'Tridente de Escala Territorial',
    notes: 'Nodo | Red | Territorio Global.',
    kind: 'tridente',
    tags: ['hexagono', 'geografia'],
    now,
    items: [
      { id: 'ama-item-escala-nodo', label: 'Nodo' },
      { id: 'ama-item-escala-red', label: 'Red' },
      { id: 'ama-item-escala-territorio', label: 'Territorio Global' },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-trinidad',
    title: 'Trinidad de Poder y Creación',
    notes: 'Brahman (Creador) | Vishnu (Conservador) | Shiva (Destructor).',
    kind: 'tridente',
    tags: ['hexagono'],
    now,
    items: [
      {
        id: 'ama-item-trinidad-brahman',
        label: 'Brahman',
        notes: 'Creador',
      },
      {
        id: 'ama-item-trinidad-vishnu',
        label: 'Vishnu',
        notes: 'Conservador',
      },
      {
        id: 'ama-item-trinidad-shiva',
        label: 'Shiva',
        notes: 'Destructor',
      },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-calendario',
    title: 'Calendario acelerado',
    notes:
      'Ayer | Hoy | Mañana. Tridente operativo del ciclo; no confundir con el Tridente Temporal (Pasado/Presente/Futuro).',
    kind: 'tridente',
    tags: ['ciclo'],
    now,
    items: [
      { id: 'ama-item-cal-ayer', label: 'Ayer' },
      { id: 'ama-item-cal-hoy', label: 'Hoy' },
      { id: 'ama-item-cal-manana', label: 'Mañana' },
    ],
  })

  insertList(db, {
    id: 'ama-lista6-nodos',
    title: 'Nodos Territoriales',
    notes: 'Seis enclaves estratégicos. Vinculados a Geografía.',
    kind: 'lista6',
    tags: ['geografia'],
    now,
    items: [
      {
        id: 'ama-item-nodo-paterna',
        label: 'Paterna',
        place_id: 'ama-place-paterna',
      },
      {
        id: 'ama-item-nodo-torrent',
        label: 'Torrent',
        place_id: 'ama-place-torrent',
      },
      {
        id: 'ama-item-nodo-horta',
        label: 'H.S. (Horta Sud)',
        place_id: 'ama-place-horta-sud',
      },
      {
        id: 'ama-item-nodo-sagunto-castillo',
        label: 'Sagunto Castillo',
        place_id: 'ama-place-sagunto-castillo',
      },
      {
        id: 'ama-item-nodo-puerto-sagunto',
        label: 'Puerto Sagunto',
        place_id: 'ama-place-puerto-sagunto',
      },
      {
        id: 'ama-item-nodo-valencia',
        label: 'Ciudad Valencia',
        place_id: 'ama-place-valencia',
      },
    ],
  })

  insertList(db, {
    id: 'ama-lista6-corruptopolis',
    title: 'Para Gobernar Hay que Ganar // Corruptópolis',
    notes: 'Seis campos de poder.',
    kind: 'lista6',
    tags: ['poder'],
    now,
    items: [
      { id: 'ama-item-poder-cultura', label: 'Cultura' },
      { id: 'ama-item-poder-militar', label: 'Militar' },
      { id: 'ama-item-poder-religion', label: 'Religión' },
      { id: 'ama-item-poder-economia', label: 'Economía' },
      { id: 'ama-item-poder-ciencia', label: 'Ciencia' },
      { id: 'ama-item-poder-politica', label: 'Política' },
    ],
  })

  insertList(db, {
    id: 'ama-lista6-agentes',
    title: 'Tipos de agentes',
    notes: 'Seis tipologías funcionales.',
    kind: 'lista6',
    tags: ['agentes'],
    now,
    items: [
      {
        id: 'ama-item-agente-vectorizadores',
        label: 'Vectorizadores',
        notes: 'Reciben información y tematizan datos.',
      },
      {
        id: 'ama-item-agente-clasificadores',
        label: 'Clasificadores',
        notes: 'Estructuran agrupaciones y clusters.',
      },
      {
        id: 'ama-item-agente-crawlers',
        label: 'Crawlers',
        notes: 'Buscadores internos (intraApp) y externos (extraApp).',
      },
      {
        id: 'ama-item-agente-generativos',
        label: 'Generativos',
        notes: 'Producen contenido multimodal (texto, imagen, audio).',
      },
      {
        id: 'ama-item-agente-ejecutivos',
        label: 'Ejecutivos',
        notes: 'Ejecutan tareas operativas.',
      },
      {
        id: 'ama-item-agente-omnivoros',
        label: 'Omnívoros',
        notes: 'Operan desde la Posición 1, conectados al protocolo Deprocast.',
      },
    ],
  })

  insertList(db, {
    id: 'ama-lista6-emociones',
    title: 'Estados emocionales',
    notes: 'Seis familias con subestados.',
    kind: 'lista6',
    tags: ['emociones'],
    now,
    items: [
      {
        id: 'ama-item-emo-triste',
        label: 'Triste (sad)',
        children: [
          { id: 'ama-item-emo-triste-deprimido', label: 'Deprimido' },
          { id: 'ama-item-emo-triste-aislado', label: 'Aislado' },
          { id: 'ama-item-emo-triste-apatia', label: 'Apatía' },
          { id: 'ama-item-emo-triste-remordimiento', label: 'Remordimiento' },
        ],
      },
      {
        id: 'ama-item-emo-enojado',
        label: 'Enojado (mad)',
        children: [
          { id: 'ama-item-emo-enojado-critico', label: 'Crítico' },
          { id: 'ama-item-emo-enojado-hostil', label: 'Hostil' },
          { id: 'ama-item-emo-enojado-frustrado', label: 'Frustrado' },
          { id: 'ama-item-emo-enojado-celoso', label: 'Celoso' },
          { id: 'ama-item-emo-enojado-egoista', label: 'Egoísta' },
        ],
      },
      {
        id: 'ama-item-emo-asustado',
        label: 'Asustado (scared)',
        children: [
          { id: 'ama-item-emo-asustado-inseguro', label: 'Inseguro' },
          { id: 'ama-item-emo-asustado-abrumado', label: 'Abrumado' },
          { id: 'ama-item-emo-asustado-submisivo', label: 'Submisivo' },
          { id: 'ama-item-emo-asustado-confundido', label: 'Confundido' },
          { id: 'ama-item-emo-asustado-desamparado', label: 'Desamparado' },
        ],
      },
      {
        id: 'ama-item-emo-alegre',
        label: 'Alegre (joyful)',
        children: [
          { id: 'ama-item-emo-alegre-optimista', label: 'Optimista' },
          { id: 'ama-item-emo-alegre-jugueton', label: 'Juguetón' },
          { id: 'ama-item-emo-alegre-emocionado', label: 'Emocionado' },
          { id: 'ama-item-emo-alegre-creativo', label: 'Creativo' },
          { id: 'ama-item-emo-alegre-esperanzado', label: 'Esperanzado' },
        ],
      },
      {
        id: 'ama-item-emo-poderoso',
        label: 'Poderoso (powerful)',
        children: [
          { id: 'ama-item-emo-poderoso-importante', label: 'Importante' },
          { id: 'ama-item-emo-poderoso-valiente', label: 'Valiente' },
          { id: 'ama-item-emo-poderoso-seguro', label: 'Seguro' },
          { id: 'ama-item-emo-poderoso-exitoso', label: 'Exitoso' },
          { id: 'ama-item-emo-poderoso-valioso', label: 'Valioso' },
        ],
      },
      {
        id: 'ama-item-emo-pacifico',
        label: 'Pacífico (peaceful)',
        children: [
          { id: 'ama-item-emo-pacifico-sereno', label: 'Sereno' },
          { id: 'ama-item-emo-pacifico-agradecido', label: 'Agradecido' },
          { id: 'ama-item-emo-pacifico-confiado', label: 'Confiado' },
          { id: 'ama-item-emo-pacifico-amoroso', label: 'Amoroso' },
          { id: 'ama-item-emo-pacifico-compasivo', label: 'Compasivo' },
          { id: 'ama-item-emo-pacifico-relajado', label: 'Relajado' },
        ],
      },
    ],
  })

  insertLink(db, {
    id: 'ama-link-castillo-paterna',
    object_type: 'item',
    object_id: 'ama-item-tactico-castillo',
    target_kind: 'place',
    target_id: 'ama-place-paterna',
    now,
  })
  insertLink(db, {
    id: 'ama-link-campamento-ruta',
    object_type: 'item',
    object_id: 'ama-item-tactico-campamento',
    target_kind: 'place',
    target_id: 'ama-place-campamento',
    now,
  })
  insertLink(db, {
    id: 'ama-link-trinchera-valencia',
    object_type: 'item',
    object_id: 'ama-item-tactico-trinchera',
    target_kind: 'place',
    target_id: 'ama-place-valencia',
    now,
  })
  insertLink(db, {
    id: 'ama-link-nodos-geo-list',
    object_type: 'list',
    object_id: 'ama-lista6-nodos',
    target_kind: 'place',
    target_id: 'ama-place-valencia',
    now,
  })

  seedIdaMatrix(db, now)
}

function seedIdaMatrix(db: DatabaseSync, now: string): void {
  insertList(db, {
    id: 'ama-tridente-ida-solve',
    title: 'Solve (IDA)',
    notes: 'Ingesta → Criba → Quántomo. El concepto entra, se pesa y se destila.',
    kind: 'tridente',
    tags: ['ida', 'solve'],
    now,
    items: [
      {
        id: 'ama-item-ida-ingesta',
        label: 'Ingesta',
        notes: 'Nota, audio o ficha entra al sistema.',
      },
      {
        id: 'ama-item-ida-criba',
        label: 'Criba',
        notes: 'Voto HITL peso 1–12. Sin peso no baja a Coagula.',
      },
      {
        id: 'ama-item-ida-quantomo',
        label: 'Quántomo',
        notes: 'Ficha destilada: el concepto ya cabe en una celda.',
      },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-ida-coagula',
    title: 'Coagula (IDA)',
    notes: 'Grafo → Entrenamiento → Obra. El concepto se enlaza, se retiene y se aplica.',
    kind: 'tridente',
    tags: ['ida', 'coagula'],
    now,
    items: [
      {
        id: 'ama-item-ida-grafo',
        label: 'Grafo',
        notes: 'Vecinos por embedding: corpus, no wiki suelta.',
      },
      {
        id: 'ama-item-ida-entrenamiento',
        label: 'Entrenamiento',
        notes: 'Flashcards + corpus. Recall del operador.',
      },
      {
        id: 'ama-item-ida-obra',
        label: 'Obra',
        notes: 'Tarea, ticket, aplicar. Constancia, no magia.',
      },
    ],
  })

  insertComposedLista6(db, {
    id: 'ama-lista6-ida-proceso',
    title: 'Proceso IDA (Solve | Coagula)',
    notes: 'Eje Y de la tabla de aprendizajes.',
    tags: ['ida', 'proceso'],
    tridenteA: 'ama-tridente-ida-solve',
    tridenteB: 'ama-tridente-ida-coagula',
    now,
  })

  insertList(db, {
    id: 'ama-tridente-ida-operador',
    title: 'Operador (IDA)',
    notes: 'Biológico, Sistémico, Hermético: el que opera el sistema.',
    kind: 'tridente',
    tags: ['ida', 'operador'],
    now,
    items: [
      {
        id: 'ama-item-ida-biologico',
        label: 'Biológico',
        notes: 'Soma, carga, cuerpo, sueño, comida.',
      },
      {
        id: 'ama-item-ida-sistemico',
        label: 'Sistémico',
        notes: 'Pipelines, agentes, software, bucle.',
      },
      {
        id: 'ama-item-ida-hermetico',
        label: 'Hermético',
        notes: 'Destilación, peso, sentido, quántomo.',
      },
    ],
  })

  insertList(db, {
    id: 'ama-tridente-ida-territorio',
    title: 'Territorio (IDA)',
    notes: 'Normativo, Narrativo, Comunitario: el afuera donde aterriza.',
    kind: 'tridente',
    tags: ['ida', 'territorio'],
    now,
    items: [
      {
        id: 'ama-item-ida-normativo',
        label: 'Normativo',
        notes: 'Derecho, reglas, plazos, fuero.',
      },
      {
        id: 'ama-item-ida-narrativo',
        label: 'Narrativo',
        notes: 'Relato, marco, comunicación.',
      },
      {
        id: 'ama-item-ida-comunitario',
        label: 'Comunitario',
        notes: 'Personas, agrupaciones, plaza.',
      },
    ],
  })

  insertComposedLista6(db, {
    id: 'ama-lista6-ida-dominio',
    title: 'Dominio IDA (Operador | Territorio)',
    notes: 'Eje X de la tabla de aprendizajes.',
    tags: ['ida', 'dominio'],
    tridenteA: 'ama-tridente-ida-operador',
    tridenteB: 'ama-tridente-ida-territorio',
    now,
  })

  insertMatrix(db, {
    id: 'ama-matrix-ida',
    title: 'Tabla IDA',
    notes:
      'Proceso (Solve | Coagula) × Dominio (Operador | Territorio). Las fichas de aprendizaje viven en las celdas; el kanban I/D/A es la proyección.',
    rowListId: 'ama-lista6-ida-proceso',
    colListId: 'ama-lista6-ida-dominio',
    tags: ['ida'],
    now,
  })
}
