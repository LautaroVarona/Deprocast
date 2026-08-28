export type EntryStatus =
  | 'queued'
  | 'processing'
  | 'pending_criba'
  | 'pending_extract'
  | 'pending_review'
  | 'split_parent'
  | 'approved'
  | 'rejected'

export type NotebookKind = 'fisico' | 'digital' | 'system'
export type NotebookIndexStatus = 'vacio' | 'parcial' | 'completo'

export type PagePosicionVisual =
  | 'Tapa'
  | 'Suelta'
  | 'Izquierda'
  | 'Derecha'
  | 'Contratapa'
  | 'ImpactoTapa' // legacy

export type PageStatus =
  | 'Vacia'
  | 'PendienteVision'
  | 'PendienteValidacion'
  | 'Validada'
  | 'Procesada'

export interface Notebook {
  id: string
  title: string
  created_at: string
  kind: NotebookKind
  cover_url: string | null
  total_sheets: number
  total_faces: number
  index_status: NotebookIndexStatus
  index_json: string
  updated_at: string
}

export interface NotebookIndexEntry {
  slot_index: number
  numero_logico: number
  posicion: PagePosicionVisual
  title: string | null
  explanation_excerpt: string | null
  status: PageStatus
}

export interface GraphicElement {
  type: 'table' | 'shape' | 'connector' | 'drawing' | 'line'
  bbox: [number, number, number, number]
  label?: string | null
  table?: { rows: string[][] } | null
  points?: Array<[number, number]> | null
}

export interface NotebookPageVisionMeta {
  layout: 'single' | 'spread' | 'cover' | 'unknown'
  notes?: string | null
  orientation_hint?: 0 | 90 | 180 | 270 | null
  page_bbox?: [number, number, number, number] | null
  spread?: {
    divider_x: number
    left_bbox: [number, number, number, number]
    right_bbox: [number, number, number, number]
    left_title?: string | null
    right_title?: string | null
    left_transcription?: string | null
    right_transcription?: string | null
  } | null
  error?: string | null
}

export type NotebookProcessLog = {
  ts: string
  level: 'info' | 'warn' | 'error'
  message: string
  notebook_id?: string
  slot_index?: number
}

export type NotebookQueueStatus = {
  running: boolean
  pending: number
  confirm_running: boolean
  confirm_pending: number
  confirm_jobs?: Array<{ notebook_id: string; slot_index: number }>
  current: {
    notebook_id: string
    slot_index: number
    phase: 'vision' | 'explain' | 'confirm'
  } | null
  logs: NotebookProcessLog[]
}

export type NotebookSourceKind =
  | 'pdf'
  | 'image'
  | 'audio'
  | 'note'
  | 'spreadsheet'
  | 'json'

export type NotebookSourceStatus = 'queued' | 'processing' | 'ready' | 'error'

export interface NotebookSource {
  id: string
  notebook_id: string
  kind: NotebookSourceKind
  vault_path: string | null
  original_name: string
  status: NotebookSourceStatus
  payload_json: string
  created_at: string
  updated_at: string
}

export interface NotebookPage {
  id: string
  notebook_id: string
  slot_index: number
  numero_logico: number
  posicion_visual: PagePosicionVisual
  status: PageStatus
  image_path: string | null
  title: string | null
  transcription_spatial: string | null
  graphic_elements: string
  vision_meta?: string | null
  is_blank: number
  entry_id: string | null
  quantomo_id: string | null
  explanation: string | null
  explanation_user?: string | null
  explanation_weight?: number | null
  mentioned_entities?: string | null
  created_at: string
  updated_at: string
}

export type SpeakerAssignment = {
  speaker: number
  person_id: string | null
  person_name: string | null
}

/** WhatsApp remitente → perfil Deprocast (hablador). */
export type ChatSpeakerMap = {
  remitente: string
  person_id: string | null
  person_name: string | null
  is_ai?: boolean
  role?: 'human' | 'assistant'
  model?: string | null
}

export type DiarizationUtterance = {
  speaker: number
  start: number
  end: number
  transcript: string
}

export type DiarizationPayload = {
  utterances: DiarizationUtterance[]
  speakers: number[]
}

export type AudioTimeRegion = { start: number; end: number }

export type AudioAnalysisPayload = {
  silence_regions: AudioTimeRegion[]
  speech_regions: AudioTimeRegion[]
  duration_sec: number | null
  analyzed_at: string
  enhanced_available?: boolean
}

export interface Entry {
  id: string
  notebook_id: string | null
  source_type: string
  title: string
  content_raw: string | null
  vault_path: string | null
  timestamp_exact: string | null
  status: EntryStatus
  created_at: string
  title_manual?: number
  original_filename?: string | null
  batch_id?: string | null
  parent_entry_id?: string | null
  manual_tags?: string | null
  operator_note?: string | null
  human_weight?: number | null
  diarization_json?: string | null
  speaker_map?: string | null
  duration_sec?: number | null
  audio_analysis_json?: string | null
  place_id?: string | null
}

export interface Quantomo {
  id: string
  entry_id: string
  title: string
  content: string | null
  hermetic_weight: number | null
  human_weight?: number | null
  suggested_weight?: number | null
  universe: string | null
  recognized: number
  stage?: 'proto' | 'pre' | 'sealed'
  source_kind?: string | null
  source_id?: string | null
  generation?: number
  premium?: number | null
}

export type BookmarkStatus =
  | 'PENDIENTE_CRIBA'
  | 'CRIBADO'
  | 'PROCESADO_IA'
  | 'SLOP'

export type BookmarkSource = 'twitter' | 'instagram'

export type BookmarkCategory =
  | 'HERRAMIENTAS'
  | 'CONCEPTOS'
  | 'ENTIDADES'
  | 'NEGOCIOS'
  | 'ARTE'
  | 'ARCHIVO'

export interface Bookmark {
  id: string
  text: string
  author_name: string | null
  author_username: string | null
  created_at_source: string | null
  link: string | null
  media_urls: string
  weight: number | null
  status: BookmarkStatus
  category: string | null
  extracted_entities: string
  suggested_links: string
  quantomo: string | null
  entry_id: string | null
  quantomo_id: string | null
  imported_at: string
  source?: BookmarkSource
  shortcode?: string | null
  media_pk?: string | null
  likes?: number | null
  comments?: number | null
  local_media_path?: string | null
  transcript?: string | null
  ocr_json?: string
  enrichment_json?: string
  /** Nota libre del operador durante la criba. */
  operator_note?: string
  /** Tags @ persona|proyecto elegidos a mano en criba (JSON). */
  manual_tags?: string
}

export interface BookmarkManualTag {
  kind: 'person' | 'project' | 'dominio' | 'agrupacion' | 'geografia'
  entity_id: string
  entity_name: string
}

export type BlobTagKind = 'person' | 'project' | 'agrupacion' | 'dominio'

export interface BlobTag {
  kind: BlobTagKind
  entity_id: string
  entity_name: string
}

export interface BlobNote {
  id: string
  title: string
  content_raw: string
  timestamp_exact: string
  created_at: string
  quantomo_id: string | null
  quantomos?: Array<{ id: string; title: string; content: string | null }>
  tags: BlobTag[]
}

export interface BookmarkSuggestedLink {
  kind: 'person' | 'project'
  label: string
  entity_id: string
  entity_name: string
  score: number
  suggestion: string
}

export interface BookmarkCounts {
  total: number
  pendientes: number
  cribados: number
  procesados: number
  /** Alias de procesados (PROCESADO_IA). */
  procesados_ia?: number
  /** Solo status CRIBADO (validados, aún sin IA). */
  validados?: number
  high_value_ready: number
  awaiting_approval: number
  /** Alias de awaiting_approval. */
  sin_aprobar?: number
  /** PROCESADO_IA + recognized=1. */
  aprobados?: number
  slop?: number
  by_source?: {
    twitter: {
      total: number
      pendientes: number
      cribados: number
      validados?: number
    }
    instagram: {
      total: number
      pendientes: number
      cribados: number
      validados?: number
    }
  }
}

export interface BookmarkProcessedRow {
  id: string
  text: string
  author_name: string | null
  author_username: string | null
  created_at_source: string | null
  link: string | null
  weight: number | null
  status: string
  category: string | null
  source?: string | null
  quantomo_id: string | null
  entry_id: string | null
  imported_at: string
  title: string | null
  quantomo_content: string | null
  recognized: number | null
  /** Frames Vision guardados (0 = falta OCR). */
  ocr_frame_count?: number
  /** IG w≥10 sin frames → candidato a Reprocesar OCR. */
  needs_ocr?: boolean
}

export interface BookmarkQueueStatus {
  running: boolean
  stop_requested: boolean
  target: number
  done: number
  remaining: number
  skipped: number
  current_id: string | null
  current_title: string | null
  last_item: {
    id: string
    weight: number
    category: string
    quantomo: string
    quantomo_id: string
    entry_id: string
    title: string
  } | null
  errors: Array<{ id: string; error: string }>
  started_at: string | null
  finished_at: string | null
}

export interface ChatQueueStatus {
  running: boolean
  stop_requested: boolean
  target: number
  done: number
  remaining: number
  skipped: number
  current_id: string | null
  current_title: string | null
  last_item: {
    block_id: string
    session_id: string
    entry_id: string
    quantomo_id: string
    title: string
  } | null
  errors: Array<{ id: string; error: string }>
  started_at: string | null
  finished_at: string | null
}

export interface PendingTask {
  id: string
  entry_id: string
  task_text: string
  tag: string | null
  status: string
}

/** Snapshot congelado al validar. */
export interface ValidatedFileMetadata {
  entry_id: string
  assigned_title: string
  timestamp_exact: string | null
  original_filename: string | null
  transcription: string | null
  stored_at: string
}

export type PersonKind =
  | 'fisica'
  | 'juridica'
  | 'ficticia'
  | 'ia'
  | 'abstracta'
  | 'ruido'
  | 'geografia'
  | 'agrupacion'

export type ProjectStatus = 'activo' | 'pausado' | 'cerrado' | 'emergente'
export type ProjectKind = 'proyecto' | 'tarea' | 'concepto'
export type PersonRelationType =
  | 'vinculo'
  | 'colabora'
  | 'familia'
  | 'conoce'
  | 'depende'
export type PersonProjectRole =
  | 'responsable'
  | 'miembro'
  | 'participante'
  | 'interesado'
  | 'co_mentioned'

export interface EntryEntityRaw {
  id: string
  entry_id: string
  name: string
  type: string
  payload: string
}

export interface ProposalBundle extends Entry {
  quantomos: Quantomo[]
  tasks: PendingTask[]
  entities?: EntryEntityRaw[]
  file_metadata?: ValidatedFileMetadata | null
}

export interface Person {
  id: string
  name: string
  kind: PersonKind
  aliases: string
  aliases_list?: string[]
  notes: string | null
  status: string
  created_at: string
  updated_at: string
  source: string
  merged_into?: string | null
  is_operator?: number
  link_count?: number
  suggested_match?: {
    id: string
    name: string
    score: number
  } | null
  source_file?: string | null
  evidence_snippet?: string | null
}

export interface Project {
  id: string
  title: string
  category: string | null
  status: ProjectStatus | string
  tactical_focus: string | null
  notes: string | null
  aliases?: string
  aliases_list?: string[]
  created_at: string
  updated_at: string
  source: string
  merged_into?: string | null
  link_count?: number
  person_count?: number
  suggested_match?: {
    id: string
    name: string
    score: number
  } | null
  source_file?: string | null
  evidence_snippet?: string | null
}

export interface PersonRelation {
  id: string
  from_person_id: string
  to_person_id: string
  relation_type: PersonRelationType | string
  notes: string | null
  created_at: string
  from_name?: string
  to_name?: string
  other_id?: string
  other_name?: string
  direction?: 'out' | 'in'
}

export interface PersonProjectLink {
  id: string
  person_id: string
  project_id: string
  role: PersonProjectRole | string
  created_at: string
  person_name?: string
  project_title?: string
  project_category?: string | null
}

export interface AgrupacionGeneratedMeta {
  summary: string
  tags: string[]
  themes: string[]
  related_person_names: string[]
  related_categories: string[]
  inferred_facts: string[]
}

export interface Agrupacion {
  id: string
  name: string
  notes: string | null
  generated_meta: string
  created_at: string
  updated_at: string
  member_count?: number
  generated_meta_parsed?: AgrupacionGeneratedMeta
}

export interface AgrupacionMember {
  id: string
  agrupacion_id: string
  person_id: string
  created_at: string
  person_name?: string
  person_kind?: PersonKind | string
  person_source?: string
}

/** Área de vida/conocimiento. Fijos: Salud, Finanzas, Derecho, Tecnología, Arte. */
export interface Dominio {
  id: string
  name: string
  notes: string | null
  is_fixed: number
  created_at: string
  updated_at: string
}

export type GeoKind =
  | 'lugar'
  | 'calle'
  | 'ciudad'
  | 'barrio'
  | 'region'
  | 'pais'
  | 'otro'

/** Lugar del corpus (categoría Geografía en Entidades). */
export interface Geografia {
  id: string
  name: string
  kind: GeoKind
  aliases: string
  aliases_list?: string[]
  notes: string | null
  status: string
  source: 'manual' | 'extractor' | 'official' | string
  merged_into?: string | null
  created_at: string
  updated_at: string
  parent_id?: string | null
  admin_type?: string | null
  admin_code?: string | null
  capital_name?: string | null
  iso_country?: string | null
  human_weight?: number
  sort_order?: number
  suggested_match?: {
    id: string
    name: string
    score: number
  } | null
}

export type GeografiaTreeNode = Geografia & { children: GeografiaTreeNode[] }

export type GeografiaMapPayload = {
  node: Geografia
  ancestors: Geografia[]
  children: Geografia[]
  features: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      id: string
      properties: {
        id: string
        name: string
        human_weight: number
        admin_type: string | null
        role: 'self' | 'child'
      }
      geometry: unknown
    }>
  }
  bbox: [number, number, number, number] | null
}

export interface EntityLink {
  id: string
  entity_kind: 'person' | 'project' | 'geografia'
  entity_id: string
  entry_id: string
  quantomo_id: string | null
  role: string
  created_at: string
  entry_title?: string
  original_filename?: string | null
  timestamp_exact?: string | null
}

export interface EntityProposalView {
  id: string
  entry_id: string
  kind: 'person' | 'project'
  proposal_type: 'create' | 'link'
  suggested_name: string
  matched_entity_id: string | null
  status: string
  created_at: string
  meta: Record<string, unknown> & {
    kind?: string
    category?: string
    status?: string
    tactical_focus?: string
  }
  evidence_parsed: {
    snippet?: string
    mention?: string
    entry_title?: string
    quantomo_id?: string | null
    /** Ventana ampliada del texto de origen (modo Validación). */
    context?: string
  }
  suggested_match: {
    id: string
    name: string
    score: number
  } | null
  entry_title?: string
  entry?: {
    id: string
    title: string
    status?: string
    source_type?: string
    original_filename?: string | null
  } | null
}

/** Sugerencia de vínculo por co-ocurrencia (mismo entry_id). */
export interface GraphLinkSuggestion {
  person_id: string
  person_name: string
  project_id: string
  project_title: string
  shared_entry_count: number
  weight: number
  shared_entry_ids: string[]
  suggested_role: 'co_mentioned' | string
}

export interface GraphLinkEvidence {
  entry_id: string
  title: string
  snippet: string
  at: string | null
}

export interface GraphVizNode {
  id: string
  type: 'person' | 'project' | 'quantomo' | 'orphan'
  label: string
  kind?: string | null
  valence: number
  mass: number
  fog: boolean
  source?: string
  first_seen: string | null
  last_seen: string | null
  hermetic_weight?: number | null
  content?: string | null
  universe?: string | null
  entry_id?: string | null
  is_operator?: boolean
  orphan?: boolean
  status?: string | null
  aliases?: string[]
  proposal_id?: string | null
}

export interface GraphVizLink {
  id: string
  source: string
  target: string
  kind: 'confirmed' | 'suggested' | 'semantic' | 'orbit'
  role?: string
  weight: number
  similarity?: number
  created_at?: string | null
  evidence?: GraphLinkEvidence[]
}

export interface GraphHeatBucket {
  day: string
  count: number
}

export interface GraphSnapshot {
  nodes: GraphVizNode[]
  links: GraphVizLink[]
  time_range: { min: string | null; max: string | null }
  heatmap: GraphHeatBucket[]
  operator_id: string | null
  stats: {
    persons: number
    projects: number
    quantomos: number
    orphans: number
    confirmed_links: number
    suggested_links: number
    semantic_links: number
  }
}

export type SandboxNodeKind = 'freeform' | 'person' | 'project' | 'quantomo'
export type SandboxLinkKind = 'manual' | 'quantomo_bridge'

export interface SandboxGraph {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export interface SandboxNode {
  id: string
  graph_id: string
  kind: SandboxNodeKind
  ref_id: string | null
  label: string
  color: string | null
  notes: string
  fx: number | null
  fy: number | null
  fz: number | null
  created_at: string
}

export interface SandboxLink {
  id: string
  graph_id: string
  source_node_id: string
  target_node_id: string
  kind: SandboxLinkKind
  label: string
  quantomo_id: string | null
  promoted_at: string | null
  created_at: string
}

export interface SandboxSnapshot {
  graph: SandboxGraph
  nodes: SandboxNode[]
  links: SandboxLink[]
}

export type ChatTipo = 'individual' | 'grupo'

export type ChatSessionStatus =
  | 'parsed'
  | 'processing'
  | 'processed'
  | 'error'

export type ChatMessageEstado = 'pendiente' | 'analizado'

export type ChatBlockEstado = 'pendiente' | 'analizado' | 'error'

export type LinkHarvestSourceType =
  | 'chat_message'
  | 'quantomo'
  | 'entry'
  | 'bookmark'

export type LinkCrawlerEstado = 'pendiente' | 'crawled' | 'error' | 'skipped'

export interface ChatSession {
  id: string
  origin_hash: string
  nombre_chat: string
  tipo: ChatTipo
  participantes_json: string
  linked_person_ids_json: string
  linked_project_ids_json?: string
  speaker_map_json?: string
  primary_person_id?: string | null
  primary_project_id?: string | null
  human_weight?: number | null
  vault_path: string | null
  status: ChatSessionStatus
  created_at: string
  updated_at: string
  message_count?: number
  block_count?: number
  link_count?: number
  pending_blocks?: number
}

export interface ChatMessage {
  id: string
  chat_session_id: string
  remitente: string | null
  texto_crudo: string
  timestamp_exact: string
  is_system: number
  is_media: number
  estado_procesamiento: ChatMessageEstado
  block_id: string | null
  sort_index: number
}

export interface ChatBlock {
  id: string
  chat_session_id: string
  started_at: string
  ended_at: string
  day_key: string
  message_count: number
  estado: ChatBlockEstado
  entry_id: string | null
  quantomo_id: string | null
  summary_json: string
  linked_person_ids_json?: string
  linked_project_ids_json?: string
  linked_entities_json?: string
  human_weight?: number | null
  notes?: string | null
  links_json?: string
  entities_reviewed?: number
  preview_messages?: ChatMessage[]
}

export interface LinkHarvest {
  id: string
  url_cruda: string
  url_norm: string
  source_type: LinkHarvestSourceType
  source_id: string
  remitente: string | null
  timestamp_captura: string | null
  chat_session_id: string | null
  estado_crawler: LinkCrawlerEstado
  created_at: string
  chat_nombre?: string | null
}

export interface ChatPreview {
  suggested_name: string
  tipo_auto: ChatTipo
  participantes: string[]
  message_count: number
  system_count: number
  media_count: number
  link_count: number
  first_ts: string | null
  last_ts: string | null
  origin_hash: string
}

export interface ChatBlockEntityView {
  name: string
  type: 'person' | 'project' | string
  kind?: string
  category?: string
  status?: string
  assigned_id?: string | null
  assigned_name?: string | null
  proposal_id?: string | null
  proposal_type?: string | null
  suggested_match_id?: string | null
  suggested_match_name?: string | null
  discarded?: boolean
}

export type CalendarPole = 'ingested' | 'native'

export interface CalendarTask {
  id: string
  entry_id: string
  task_text: string
  tag: string | null
  status: string
}

export interface CalendarOccurrence {
  id: string
  record_id: string
  pole: CalendarPole
  at: string
  source_type: string
  title: string
  status: string
  tasks: CalendarTask[]
  hermetic_weight: number | null
  human_weight: number | null
  other_at: string | null
}

export type AmaListKind =
  | 'tridente'
  | 'lista6'
  | 'base12'
  | 'base22'
  | 'base72'

export type AmaCycleSlot = 'ayer' | 'hoy' | 'manana'

export type AmaPlaceKind = 'lugar' | 'enclave' | 'ruta' | 'region'

export type AmaLinkObjectType =
  | 'list'
  | 'item'
  | 'matrix'
  | 'cell'
  | 'place'
  | 'flow'

export type AmaLinkTargetKind = 'person' | 'project' | 'place' | 'agrupacion'

export interface AmaList {
  id: string
  title: string
  notes: string
  size: number
  kind: AmaListKind
  source: 'seed' | 'manual' | 'composed'
  tags: string
  tags_list?: string[]
  created_at: string
  updated_at: string
  item_count?: number
}

export interface AmaListItem {
  id: string
  list_id: string
  position: number
  label: string
  notes: string
  place_id: string | null
  parent_item_id: string | null
  created_at: string
  updated_at: string
  place_name?: string | null
  children?: AmaListItem[]
}

export interface AmaLista6Parts {
  lista6_id: string
  tridente_a_id: string
  tridente_b_id: string
  tridente_a_title?: string
  tridente_b_title?: string
}

export interface AmaListHydrated extends AmaList {
  items: AmaListItem[]
  composition: AmaLista6Parts | null
}

export interface AmaMatrix {
  id: string
  title: string
  notes: string
  order_n: 3 | 6
  row_list_id: string
  col_list_id: string
  tags: string
  tags_list?: string[]
  neo_swapped: number
  created_at: string
  updated_at: string
  row_title?: string
  col_title?: string
  cell_notes_count?: number
}

export interface AmaCell {
  id: string
  matrix_id: string
  row_item_id: string
  col_item_id: string
  title: string | null
  notes: string
  cycle_slot: AmaCycleSlot | null
  display_slot?: AmaCycleSlot | null
  place_id: string | null
  created_at: string
  updated_at: string
  place_name?: string | null
}

export interface AmaNeoCell {
  id: string
  matrix_id: string
  title_index: number
  cycle_slot: AmaCycleSlot
  notes: string
  display_slot?: AmaCycleSlot
}

export interface AmaMatrixHydrated extends AmaMatrix {
  row_list: AmaListHydrated
  col_list: AmaListHydrated
  cells: AmaCell[]
  neo_cells: AmaNeoCell[]
}

export type MapZoneRole = 'nucleo' | 'sector' | 'micro' | 'ruta'

export type MapLayerKind =
  | 'basemap'
  | 'fisico'
  | 'h3'
  | 'occupancy'
  | 'amazona'
  | 'aristas'
  | 'chronos'
  | 'tags'
  | 'custom'

export interface AmaPlace {
  id: string
  name: string
  notes: string
  lat: number | null
  lng: number | null
  kind: AmaPlaceKind
  tags: string
  tags_list?: string[]
  parent_id?: string | null
  h3_index?: string | null
  zone_code?: string | null
  role?: MapZoneRole | string | null
  created_at: string
  updated_at: string
}

export interface MapSystem {
  id: string
  name: string
  notes: string
  center_lat: number
  center_lng: number
  zoom: number
  pitch: number
  bearing: number
  created_at: string
  updated_at: string
}

export interface MapLayer {
  id: string
  system_id: string
  kind: MapLayerKind
  title: string
  visible: number
  opacity: number
  z_index: number
  config_json: string
  created_at: string
  updated_at: string
}

export interface MapTag {
  id: string
  system_id: string
  layer_id: string | null
  lat: number
  lng: number
  h3_index: string | null
  place_id: string | null
  label: string
  notes: string
  target_kind: string | null
  target_id: string | null
  created_at: string
  updated_at: string
  place_name?: string | null
  target_label?: string | null
}

export interface MapOccupancyCounts {
  place_id: string
  persons: number
  projects: number
  agrupaciones: number
  entries: number
  amazona_items: number
  amazona_cells: number
  tags: number
  total: number
}

export type MapOccupancyKind =
  | 'person'
  | 'project'
  | 'agrupacion'
  | 'entry'
  | 'item'
  | 'cell'
  | 'tag'

export interface MapOccupancyItem {
  kind: MapOccupancyKind
  id: string
  label: string
  subtitle?: string
  link_id?: string
}

export interface MapMoonState {
  phase: number
  illumination: number
  label: string
}

export interface MapOverview {
  system: MapSystem
  systems: MapSystem[]
  layers: MapLayer[]
  zones: AmaPlace[]
  tags: MapTag[]
  occupancy: MapOccupancyCounts[]
  flows: AmaFlow[]
  moon: MapMoonState
}

export interface AmaFlow {
  id: string
  from_place_id: string
  to_place_id: string
  recorded_at: string
  notes: string
  distance_m: number | null
  cycle_slot: AmaCycleSlot | null
  display_slot?: AmaCycleSlot | null
  created_at: string
  from_name?: string
  to_name?: string
  from_lat?: number | null
  from_lng?: number | null
  to_lat?: number | null
  to_lng?: number | null
}

export interface AmaLink {
  id: string
  object_type: AmaLinkObjectType
  object_id: string
  target_kind: AmaLinkTargetKind
  target_id: string
  role: string
  created_at: string
  target_label?: string
}

export interface AmaCycleState {
  id: string
  offset: number
  hoy_started_at: string
  slots: Array<{
    id: AmaCycleSlot
    label: string
    operational: AmaCycleSlot
  }>
}

export interface AmaOverview {
  lists: number
  tridentes: number
  listas6: number
  matrices6: number
  matrices3: number
  places: number
  flows: number
}

export type AppRunStatus = 'current' | 'ended'

export interface AppRun {
  id: string
  operator_id: string
  operator_name: string
  started_at: string
  ended_at: string | null
  status: AppRunStatus
  backup_path?: string | null
  created_at?: string
  day_count: number
}

export type DeproDomainId =
  | 'captura'
  | 'criba'
  | 'biblioteca'
  | 'memoria'
  | 'territorio'
  | 'finanzas'
  | 'derecho'
  | 'vitalidad'

export type DeproIpo = 'input' | 'procesamiento' | 'output'

export type DeproCma = 'cuerpo' | 'mente' | 'alma'

export type DeproTypology =
  | 'vectorizador'
  | 'clasificador'
  | 'crawler'
  | 'generativo'
  | 'ejecutivo'
  | 'omnivoro'

export type DeproPowerStatus = 'hueco' | 'bosquejo' | 'cargado'

export type DeproAgentStatus = 'hueco' | 'bosquejo' | 'vivo'

export type DeproIdaStage = 'investigacion' | 'desarrollo' | 'aplicacion'

export type DeproIdaOrigin = 'seed' | 'ui'

export type DeproIdaKind = 'organismo' | 'aprendizaje'

export type DeproIdaCardGrade = 'again' | 'good'

export interface DeproContract {
  input: string
  processing: string
  output: string
}

export interface DeproAmazonaCoords {
  index: number
  face: 0 | 1
  cell: number
  row: number
  col: number
  x: number
  y: number
  z: number
  sum: number
  product: number
}

export interface DeproPowerGeometry {
  index: number
  domain: DeproDomainId
  domainIndex: number
  oficioIndex: number
  ipo: DeproIpo
  cma: DeproCma
  typology: DeproTypology
  amazona: DeproAmazonaCoords
}

export interface DeproPower extends DeproPowerGeometry {
  name: string
  status: DeproPowerStatus
  notes: string
  contract: DeproContract
  agentIds: string[]
  operator_notes: string
  status_override: DeproPowerStatus | null
}

export interface DeproPowerNote {
  power_index: number
  notes: string
  status: DeproPowerStatus | null
  updated_at: string
}

export interface DeproAgent {
  id: string
  name: string
  typology: DeproTypology
  contract: DeproContract
  domains: DeproDomainId[]
  powerIndexes: number[]
  module: string | null
  idaStage: DeproIdaStage
  status: DeproAgentStatus
  promptStub: string
  notes: string
}

export interface DeproModule {
  id: string
  label: string
  does: string
  files: string
  ipo: DeproContract
  suggestedAgentIds: string[]
}

export interface DeproIdaItem {
  id: string
  title: string
  body: string
  stage: DeproIdaStage
  power_indexes: number[]
  agent_ids: string[]
  tags: string[]
  origin: DeproIdaOrigin
  archived: number
  matrix_id: string | null
  row_item_id: string | null
  col_item_id: string | null
  weight: number | null
  kind: DeproIdaKind
  domain_ids: string[]
  created_at: string
  updated_at: string
}

export interface DeproIdaCard {
  id: string
  ida_id: string
  question: string
  answer: string
  due_at: string | null
  ease: number
  created_at: string
  updated_at: string
}

export interface DeproIdaCardDue extends DeproIdaCard {
  ida_title: string
}

export interface DeproIdaNeighbor {
  object_type: 'ida_item' | 'quantomo'
  object_id: string
  score: number
  title: string
  body?: string
  kind?: DeproIdaKind
}

export interface DeproIdaCardProposal {
  question: string
  answer: string
}

export type DeproResearchPackStatus =
  | 'running'
  | 'ready'
  | 'error'
  | 'closed'

export type DeproResearchOrigin = 'manual' | 'api'

export type DeproResearchFindingStatus =
  | 'pending'
  | 'assimilated'
  | 'discarded'
  | 'fractalized'

export interface DeproResearchPack {
  id: string
  topic: string
  agent_id: string
  prompt_key: string
  status: DeproResearchPackStatus
  origin: DeproResearchOrigin
  parent_finding_id: string | null
  parent_pack_id: string | null
  raw_content: string
  raw_citations: unknown[]
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface DeproResearchFinding {
  id: string
  pack_id: string
  sort_index: number
  axis_index: number | null
  node_index: number | null
  axis_title: string | null
  title: string
  body: string
  url: string | null
  status: DeproResearchFindingStatus
  assimilated_ida_id: string | null
  created_at: string
  updated_at: string
}

export type DialogoEntityRefType =
  | 'person'
  | 'project'
  | 'agrupacion'
  | 'quantomo'
  | 'dominio'

export interface DialogoEntityRef {
  type: DialogoEntityRefType
  id: string
}

export interface DialogoThread {
  id: string
  title: string
  section_key: string | null
  entity_refs: DialogoEntityRef[]
  created_at: string
  updated_at: string
  status?: 'open' | 'closed'
  closed_at?: string | null
  hermetic_weight?: number | null
  entry_id?: string | null
}

export interface DialogoMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  citations?: Array<{
    type: 'person' | 'project' | 'quantomo'
    id: string
    label: string
  }>
}

export interface DashboardPin {
  slot: number
  ref_type: DialogoEntityRefType
  ref_id: string
  label: string
  updated_at: string
}

export type SentinelStatus =
  | 'inspecting'
  | 'ready'
  | 'running'
  | 'paused'
  | 'error'

export type SentinelMissionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'

export type SentinelSkillStatus = 'draft' | 'accepted' | 'rejected'

export interface SentinelAgent {
  id: string
  code: string
  name: string
  status: SentinelStatus
  profile_md: string
  created_at: string
  updated_at: string
}

export interface SentinelMission {
  id: string
  agent_id: string
  intro: string
  instructions: string
  resources: string[]
  expected_output: string
  status: SentinelMissionStatus
  paused_at: string | null
  created_at: string
  updated_at: string
}

export interface SentinelMessage {
  id: string
  mission_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
}

export interface SentinelEvent {
  id: string
  agent_id: string
  mission_id: string | null
  kind: 'note' | 'observation' | 'timing' | 'suggestion' | 'error' | 'tool'
  payload: string
  created_at: string
}

export interface SentinelSkill {
  id: string
  agent_id: string
  name: string
  input: string
  processing: string
  output: string
  kind: string
  body: unknown
  status: SentinelSkillStatus
  weight: number | null
  ida_item_id: string | null
  created_at: string
  updated_at: string
}
