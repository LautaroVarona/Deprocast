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
  | 'ImpactoTapa' // legacy; se normaliza a Tapa

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
  /** Rotación sugerida en grados (0, 90, 180, 270) para enderezar la hoja. */
  orientation_hint?: 0 | 90 | 180 | 270 | null
  /** Bbox de la hoja/cuaderno útil dentro de la foto [x,y,w,h] normalizado 0–1. */
  page_bbox?: [number, number, number, number] | null
  /** Si es foto a doble página (línea divisora en el medio). */
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
  vision_meta: string | null
  is_blank: number
  entry_id: string | null
  quantomo_id: string | null
  explanation: string | null
  explanation_user: string | null
  explanation_weight: number | null
  mentioned_entities: string
  created_at: string
  updated_at: string
}

export interface NotebookPageVisionResult {
  title: string
  transcription_spatial: string
  graphic_elements: GraphicElement[]
  is_blank: boolean
  meta: NotebookPageVisionMeta
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

export type SpeakerAssignment = {
  speaker: number
  person_id: string | null
  person_name: string | null
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
  title_manual: number
  original_filename: string | null
  batch_id?: string | null
  parent_entry_id?: string | null
  manual_tags?: string | null
  operator_note?: string | null
  human_weight?: number | null
  diarization_json?: string | null
  speaker_map?: string | null
  duration_sec?: number | null
  place_id?: string | null
}

/** Snapshot congelado al validar: nombre asignado, fecha, archivo original y transcripción. */
export interface ValidatedFileMetadata {
  entry_id: string
  assigned_title: string
  timestamp_exact: string | null
  original_filename: string | null
  transcription: string | null
  stored_at: string
}

export interface Quantomo {
  id: string
  entry_id: string
  title: string
  content: string | null
  hermetic_weight: number | null
  /** Peso asignado por el operador (criba HITL). */
  human_weight?: number | null
  /** Peso sugerido por Cohere / Aduana. */
  suggested_weight?: number | null
  universe: string | null
  recognized: number
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
  source: BookmarkSource
  shortcode: string | null
  media_pk: string | null
  likes: number | null
  comments: number | null
  local_media_path: string | null
  transcript: string | null
  ocr_json: string
  enrichment_json: string
  /** Nota libre del operador durante la criba. */
  operator_note: string
  /** Tags @ persona|proyecto elegidos a mano en criba (JSON). */
  manual_tags: string
}

export type BookmarkManualTag = {
  kind: 'person' | 'project' | 'dominio'
  entity_id: string
  entity_name: string
}

export interface BookmarkExtractedEntity {
  name: string
  type: string
  kind?: string
}

export interface BookmarkSuggestedLink {
  kind: 'person' | 'project'
  label: string
  entity_id: string
  entity_name: string
  score: number
  suggestion: string
}

export interface BookmarkExtraction {
  category: BookmarkCategory
  quantomo: string
  suggested_title: string
  suggested_weight: number | null
  entities: Array<{
    name: string
    type: 'person' | 'project'
    kind?: string
    category?: string
    status?: string
  }>
  /** Resumen breve del audio (bandas 7–12 IG). */
  audio_summary?: string | null
  /** Metadata agregada del video (banda 10–12 IG). */
  video_meta?: string | null
}

export interface OcrFrameResult {
  t_sec: number
  path: string
  explanation: string
}

export interface PendingTask {
  id: string
  entry_id: string
  task_text: string
  tag: string | null
  status: string
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

export interface CohereQuantomo {
  title: string
  content: string
  hermetic_weight: number
  universe: string
}

export interface CohereAction {
  task_text: string
  tag: string
}

export type EntityKind = 'person' | 'project' | 'geografia'
export type PersonKind =
  | 'fisica'
  | 'juridica'
  | 'ficticia'
  | 'abstracta'
  | 'ruido'
  | 'geografia'
  /** @deprecated migrado a ficticia */
  | 'agrupacion'
export type ProjectStatus = 'activo' | 'pausado' | 'cerrado' | 'emergente'
export type ProjectKind = 'proyecto' | 'tarea' | 'concepto'
export type ProposalType = 'create' | 'link'
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
export type ProposalStatus = 'pending' | 'approved' | 'rejected'
export type EmbeddingObjectType =
  | 'entry'
  | 'entry_chunk'
  | 'quantomo'
  | 'person'
  | 'project'
  | 'link_context'
  | 'ida_item'

export interface CohereEntity {
  name: string
  type: string
  kind?: string
  category?: string
  status?: string
  tactical_focus?: string
}

export interface CohereExtraction {
  suggested_title: string
  quantomos: CohereQuantomo[]
  actions: CohereAction[]
  entities: CohereEntity[]
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
  notes: string | null
  status: string
  created_at: string
  updated_at: string
  source: string
  merged_into?: string | null
  is_operator?: number
}

export interface Project {
  id: string
  title: string
  category: string | null
  status: ProjectStatus | string
  tactical_focus: string | null
  notes: string | null
  aliases?: string
  created_at: string
  updated_at: string
  source: string
  merged_into?: string | null
}

export interface PersonRelation {
  id: string
  from_person_id: string
  to_person_id: string
  relation_type: PersonRelationType | string
  notes: string | null
  created_at: string
}

export interface PersonProjectLink {
  id: string
  person_id: string
  project_id: string
  role: PersonProjectRole | string
  created_at: string
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

export interface Geografia {
  id: string
  name: string
  kind: GeoKind
  aliases: string
  aliases_list?: string[]
  notes: string | null
  status: string
  source: 'manual' | 'extractor' | string
  merged_into?: string | null
  created_at: string
  updated_at: string
}

export interface EntryEntityRaw {
  id: string
  entry_id: string
  name: string
  type: string
  payload: string
}

export interface EntityProposal {
  id: string
  entry_id: string
  kind: EntityKind
  proposal_type: ProposalType
  suggested_name: string
  suggested_meta: string
  matched_entity_id: string | null
  evidence: string | null
  status: ProposalStatus
  created_at: string
  resolved_at: string | null
}

export interface EntityLink {
  id: string
  entity_kind: EntityKind
  entity_id: string
  entry_id: string
  quantomo_id: string | null
  role: string
  created_at: string
}

export interface EmbeddingRow {
  id: string
  object_type: EmbeddingObjectType
  object_id: string
  model: string
  dims: number
  vector: string
  text_hash: string
  created_at: string
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
  vault_path: string | null
  status: ChatSessionStatus
  created_at: string
  updated_at: string
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
}

export interface ChatExtraction {
  title: string
  summary: string
  quantomo: string
  suggested_weight: number | null
  entities: Array<{
    name: string
    type: 'person' | 'project'
    kind?: string
    category?: string
    status?: string
  }>
  locations?: string[]
  milestones?: string[]
}

export type AmaListKind =
  | 'tridente'
  | 'lista6'
  | 'base12'
  | 'base22'
  | 'base72'

export type AmaCycleSlot = 'ayer' | 'hoy' | 'manana'

export type AmaPlaceKind = 'lugar' | 'enclave' | 'ruta' | 'region'

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
  backup_path: string | null
  created_at: string
  day_count: number
}

export type DeproPowerStatus = 'hueco' | 'bosquejo' | 'cargado'

export type DeproIdaStage = 'investigacion' | 'desarrollo' | 'aplicacion'

export type DeproIdaOrigin = 'seed' | 'ui'

export type DeproIdaKind = 'organismo' | 'aprendizaje'

export type DeproIdaCardGrade = 'again' | 'good'

export interface DeproPowerNote {
  power_index: number
  notes: string
  status: DeproPowerStatus | null
  updated_at: string
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
