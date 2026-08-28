import type {
  Agrupacion,
  AgrupacionGeneratedMeta,
  AgrupacionMember,
  Dominio,
  Bookmark,
  BookmarkCounts,
  BookmarkManualTag,
  BookmarkProcessedRow,
  BookmarkQueueStatus,
  CalendarOccurrence,
  AmaList,
  AmaListHydrated,
  AmaListItem,
  AmaListKind,
  AmaMatrix,
  AmaMatrixHydrated,
  AmaCell,
  AmaPlace,
  AmaPlaceKind,
  AmaFlow,
  AmaLink,
  AmaLinkObjectType,
  AmaLinkTargetKind,
  AmaCycleSlot,
  AmaCycleState,
  AmaOverview,
  MapLayer,
  MapOccupancyItem,
  MapOverview,
  MapSystem,
  MapTag,
  ChatBlock,
  ChatBlockEntityView,
  ChatMessage,
  ChatPreview,
  ChatSession,
  ChatSpeakerMap,
  ChatTipo,
  Entry,
  AudioAnalysisPayload,
  EntityProposalView,
  LinkHarvest,
  Person,
  PersonKind,
  Project,
  ProjectStatus,
  ProposalBundle,
  EntityLink,
  PersonRelation,
  PersonProjectLink,
  PersonRelationType,
  PersonProjectRole,
  ProjectKind,
  Quantomo,
  GraphLinkSuggestion,
  GraphSnapshot,
  SandboxGraph,
  SandboxLink,
  SandboxLinkKind,
  SandboxNode,
  SandboxNodeKind,
  SandboxSnapshot,
  BlobNote,
  BlobTag,
  NotebookQueueStatus,
  NotebookSource,
  PendingTask,
  AppRun,
  DeproIdaItem,
  DeproIdaStage,
  DeproIdaKind,
  DeproIdaCard,
  DeproIdaCardDue,
  DeproIdaCardGrade,
  DeproIdaCardProposal,
  DeproIdaNeighbor,
  DeproPowerNote,
  DeproPowerStatus,
  DeproResearchFinding,
  DeproResearchPack,
  DialogoThread,
  DialogoMessage,
  DialogoEntityRef,
  DialogoEntityRefType,
  DashboardPin,
  SentinelAgent,
  SentinelMission,
  SentinelMessage,
  SentinelEvent,
  SentinelSkill,
} from '../types'
import { request } from './http'

export type BackupApplyResult = {
  ok: true
  mode: 'replace' | 'merge'
  tables: Record<string, number>
  inserted: Record<string, number>
  skipped: Record<string, number>
  remapped: { trinchera: { from: string; to: string } | null }
  media: {
    copied: number
    skipped: number
    conflicts?: number
    failed?: number
  }
  mediaStatus?: 'ok' | 'failed' | 'partial' | 'skipped'
  dbCommitted?: boolean
  profiles?: {
    persons_merged: number
    projects_merged: number
  }
}

export type ProviderSlot =
  | 'llm_main'
  | 'llm_fast'
  | 'llm_vision'
  | 'llm_sentinel'
  | 'embed'
  | 'rerank'
  | 'stt'
  | 'research'

export type ProviderConfigResponse = {
  ok: boolean
  catalog: Array<{
    slot: ProviderSlot
    label: string
    providers: Array<{
      id: string
      label: string
      models: Array<{ id: string; label: string }>
    }>
  }>
  provider: Record<ProviderSlot, string>
  model: Record<ProviderSlot, string>
  keysPresent: Record<string, boolean>
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),

  getLiveToken: () =>
    request<{
      access_token: string
      expires_in: number
      model: string
      language: string
    }>('/api/live/token'),

  getLiveConfig: () =>
    request<{
      model: string
      language: string
      stream_path: string
    }>('/api/live/config'),

  ingestAudio: (
    files: File[],
    meta?: {
      batch_id?: string
      manual_tags?: BookmarkManualTag[]
      operator_note?: string
    },
  ) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (meta?.batch_id) form.append('batch_id', meta.batch_id)
    if (meta?.manual_tags) form.append('manual_tags', JSON.stringify(meta.manual_tags))
    if (meta?.operator_note) form.append('operator_note', meta.operator_note)
    return request<{
      ok: boolean
      entries: Array<{
        id: string
        title: string
        title_manual: number
        timestamp_exact: string
        origin_source: string
        status: string
      }>
    }>('/api/ingest/audio', { method: 'POST', body: form })
  },

  /** Sube un archivo a la vez (recomendado para m4a grandes). */
  ingestAudioOne: (
    file: File,
    meta?: {
      batch_id?: string
      manual_tags?: BookmarkManualTag[]
      operator_note?: string
    },
  ) => {
    const form = new FormData()
    form.append('files', file)
    if (meta?.batch_id) form.append('batch_id', meta.batch_id)
    if (meta?.manual_tags) form.append('manual_tags', JSON.stringify(meta.manual_tags))
    if (meta?.operator_note) form.append('operator_note', meta.operator_note)
    return request<{
      ok: boolean
      entries: Array<{
        id: string
        title: string
        title_manual: number
        timestamp_exact: string
        origin_source: string
        status: string
      }>
    }>('/api/ingest/audio', { method: 'POST', body: form })
  },

  ingestBlob: (body: {
    text: string
    timestamp_exact: string
    tags: BlobTag[]
  }) =>
    request<{ ok: boolean; blob: BlobNote }>('/api/ingest/blob', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listBlobs: (limit?: number) => {
    const qs = new URLSearchParams()
    if (limit != null) qs.set('limit', String(limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<{ blobs: BlobNote[] }>(`/api/entries/blobs${suffix}`)
  },

  getQueued: () => request<{ entries: Entry[] }>('/api/entries/queued'),

  getValidated: () =>
    request<{ entries: ProposalBundle[] }>('/api/entries/validated'),

  getCalendarActivity: (from: string, to: string) => {
    const qs = new URLSearchParams({ from, to })
    return request<{ occurrences: CalendarOccurrence[] }>(
      `/api/calendar/activity?${qs}`,
    )
  },

  patchCalendarTask: (taskId: string, done: boolean) =>
    request<{ ok: boolean; task: PendingTask }>(
      `/api/calendar/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify({ done }) },
    ),

  runPipeline: (entryIds?: string[]) =>
    request<{
      ok: boolean
      running: boolean
      paused?: boolean
      accepted: string[]
      message: string
    }>('/api/pipeline/run', {
      method: 'POST',
      body: JSON.stringify({ entryIds }),
    }),

  getPipelineStatus: () =>
    request<{
      running: boolean
      paused: boolean
      queued: number
      remaining: number
      currentEntryId: string | null
      currentTitle: string | null
      stage: string
      stageLabel: string
      transcript: string
      stub: boolean
      chunk: number | null
      totalChunks: number | null
    }>('/api/pipeline/status'),

  pausePipeline: () =>
    request<{
      ok: boolean
      paused: boolean
      cleared: number
      resetProcessing: number
      message: string
    }>('/api/pipeline/pause', { method: 'POST', body: JSON.stringify({}) }),

  resumePipeline: () =>
    request<{
      ok: boolean
      paused: boolean
      message: string
    }>('/api/pipeline/resume', { method: 'POST', body: JSON.stringify({}) }),

  clearQueuedEntries: () =>
    request<{ ok: boolean; deleted: number }>('/api/entries/queued', {
      method: 'DELETE',
    }),

  getCribaAudios: () =>
    request<{
      entries: Entry[]
      operator: { id: string; name: string } | null
    }>('/api/entries/criba'),

  getEntryAudioAnalysis: (entryId: string) =>
    request<{ analysis: AudioAnalysisPayload; entry_id: string }>(
      `/api/entries/${encodeURIComponent(entryId)}/analysis`,
    ),

  getPendingProposals: () =>
    request<{ proposals: ProposalBundle[] }>('/api/proposals/pending'),

  patchAudioCriba: (
    entryId: string,
    body: {
      content_raw?: string
      operator_note?: string
      manual_tags?: BookmarkManualTag[]
      speaker_map?: Array<{
        speaker: number
        person_id: string | null
        person_name: string | null
      }>
      title?: string
      timestamp_exact?: string
    },
  ) =>
    request<{ ok: boolean; entry: Entry }>(
      `/api/entries/${encodeURIComponent(entryId)}/criba`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  voteAudioCriba: (
    entryId: string,
    weight: number,
    body?: {
      content_raw?: string
      operator_note?: string
      manual_tags?: BookmarkManualTag[]
      speaker_map?: Array<{
        speaker: number
        person_id: string | null
        person_name: string | null
      }>
      title?: string
      timestamp_exact?: string
    },
  ) =>
    request<{ ok: boolean; entry: Entry }>(
      `/api/entries/${encodeURIComponent(entryId)}/weight`,
      {
        method: 'POST',
        body: JSON.stringify({ weight, ...body }),
      },
    ),

  approve: (
    entryId: string,
    opts?: {
      title?: string
      rejectQuantomoIds?: string[]
      rejectTaskIds?: string[]
      rejectEntityIds?: string[]
      quantomos?: Array<{ id: string; title: string; content: string }>
      tasks?: Array<{ id: string; task_text: string; tag: string }>
      entities?: Array<{ id: string; name: string }>
    },
  ) =>
    request<{ ok: boolean; entity_proposals?: number }>(
      '/api/proposals/approve',
      {
        method: 'POST',
        body: JSON.stringify({ entryId, ...opts }),
      },
    ),

  reject: (entryId: string) =>
    request<{ ok: boolean }>('/api/proposals/reject', {
      method: 'POST',
      body: JSON.stringify({ entryId }),
    }),

  updateTimestamp: (entryId: string, timestamp_exact: string) =>
    request<{ ok: boolean; entry: Entry }>('/api/entries/timestamp', {
      method: 'PATCH',
      body: JSON.stringify({ entryId, timestamp_exact }),
    }),

  updateTitle: (entryId: string, title: string) =>
    request<{ ok: boolean; entry: Entry }>('/api/entries/title', {
      method: 'PATCH',
      body: JSON.stringify({ entryId, title }),
    }),

  deleteEntry: (entryId: string) =>
    request<{ ok: boolean; entryId: string }>(`/api/entries/${entryId}`, {
      method: 'DELETE',
    }),

  // —— Personas ——
  listPersons: () =>
    request<{
      persons: Person[]
      profiles: Person[]
      waiting: Person[]
      waiting_count: number
      profile_count: number
      pending_proposals_count?: number
      operator_id: string | null
    }>('/api/persons'),

  getPerson: (id: string) =>
    request<{
      person: Person
      links: EntityLink[]
      relations: PersonRelation[]
      project_links: PersonProjectLink[]
      operator_id: string | null
    }>(`/api/persons/${id}`),

  exportPersons: () =>
    request<{
      exported_at: string
      source: string
      count: number
      profiles: unknown[]
    }>('/api/persons/export'),

  searchPersons: (q: string, opts?: { mode?: 'lexical' | 'semantic' | 'hybrid'; signal?: AbortSignal }) => {
    const qs = new URLSearchParams({ q })
    if (opts?.mode) qs.set('mode', opts.mode)
    return request<{
      query: string
      results: Array<{
        id: string
        name: string
        kind: PersonKind
        aliases_list: string[]
        is_operator?: boolean
        score: number
      }>
    }>(`/api/persons/search?${qs}`, { signal: opts?.signal })
  },

  typeaheadEntities: (
    q: string,
    opts?: {
      kinds?: Array<'person' | 'project' | 'quantomo' | 'agrupacion' | 'dominio' | 'geografia'>
      limit?: number
      scope?: 'masters' | 'all'
      signal?: AbortSignal
    },
  ) => {
    const qs = new URLSearchParams({ q })
    if (opts?.kinds?.length) qs.set('kinds', opts.kinds.join(','))
    if (opts?.limit != null) qs.set('limit', String(opts.limit))
    if (opts?.scope) qs.set('scope', opts.scope)
    return request<{
      query: string
      results: Array<{
        kind: 'person' | 'project' | 'quantomo' | 'agrupacion' | 'dominio' | 'geografia'
        id: string
        label: string
        subtitle: string
        aliases: string[]
        score: number
      }>
    }>(`/api/entities/typeahead?${qs}`, { signal: opts?.signal })
  },

  createPerson: (body: {
    name: string
    kind?: PersonKind
    aliases?: string[] | string
    notes?: string
  }) =>
    request<{ ok: boolean; person: Person }>('/api/persons', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePerson: (
    id: string,
    body: {
      name?: string
      kind?: PersonKind
      aliases?: string[] | string
      notes?: string
      status?: string
    },
  ) =>
    request<{ ok: boolean; person: Person }>(`/api/persons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deletePerson: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/persons/${id}`, {
      method: 'DELETE',
    }),

  setPersonOperator: (id: string, enable = true) =>
    request<{ ok: boolean; operator_id: string | null; person_id: string }>(
      `/api/persons/${id}/operator`,
      {
        method: 'POST',
        body: JSON.stringify({ enable }),
      },
    ),

  createPersonRelation: (
    fromId: string,
    body: {
      to_person_id?: string
      to_operator?: boolean
      relation_type?: PersonRelationType
      notes?: string
    },
  ) =>
    request<{ ok: boolean; relation: PersonRelation }>(
      `/api/persons/${fromId}/relations`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  deletePersonRelation: (relationId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/persons/relations/${relationId}`,
      { method: 'DELETE' },
    ),

  linkPersonToProject: (
    personId: string,
    body: { project_id: string; role?: PersonProjectRole },
  ) =>
    request<{ ok: boolean; link: PersonProjectLink }>(
      `/api/persons/${personId}/projects`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  unlinkPersonFromProject: (linkId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/persons/project-links/${linkId}`,
      { method: 'DELETE' },
    ),

  attachWaitingToProfile: (waitingId: string, masterId: string) =>
    request<{
      ok: boolean
      master_id: string
      waiting_id: string
      alias_added?: string
      aliases?: string[]
    }>(`/api/persons/${waitingId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ master_id: masterId }),
    }),

  listWaiting: () =>
    request<{
      items: Array<{
        id: string
        entity_type: 'person' | 'project' | 'geografia'
        name: string
        class_label: string
        notes: string | null
        created_at: string
        link_count?: number
        source_file?: string | null
        source_type?: string | null
        evidence_snippet?: string | null
        entry_excerpt?: string | null
        suggested_match: {
          id: string
          name: string
          score: number
          target_type: 'person' | 'project' | 'geografia'
        } | null
        cross_match: {
          id: string
          name: string
          score: number
          target_type: 'person' | 'project' | 'geografia'
        } | null
      }>
      count: number
      with_link_count?: number
      orphan_count?: number
      masters: {
        persons: Array<{ id: string; name: string; kind: string }>
        projects: Array<{ id: string; name: string; category: string }>
        geografia?: Array<{ id: string; name: string; kind: string }>
        agrupaciones?: Array<{ id: string; name: string; kind?: string }>
        dominios?: Array<{ id: string; name: string; kind?: string }>
      }
    }>('/api/waiting'),

  resolveWaiting: (
    id: string,
    body: {
      from_type: 'person' | 'project' | 'geografia'
      action: 'attach' | 'promote'
      to_type?: 'person' | 'project' | 'geografia' | 'agrupacion' | 'dominio'
      target_id?: string
      targets?: Array<{
        to_type: 'person' | 'project' | 'geografia' | 'agrupacion' | 'dominio'
        target_id: string
      }>
      kind?: PersonKind | string
      name?: string
      title?: string
      category?: string
      status?: string
      notes?: string
    },
  ) =>
    request<{
      ok: boolean
      result_type:
        | 'person'
        | 'project'
        | 'geografia'
        | 'agrupacion'
        | 'dominio'
      result_id: string
      alias_added?: string | null
      attached?: number
    }>(`/api/waiting/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  discardWaiting: (body: {
    items?: Array<{
      id: string
      from_type: 'person' | 'project' | 'geografia'
    }>
    all?: boolean
    only?: 'suggested' | 'orphan' | 'all'
  }) =>
    request<{
      ok: boolean
      discarded: number
      failed: number
      ruido_id: string
    }>('/api/waiting/discard', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  discardWaitingOne: (
    id: string,
    from_type: 'person' | 'project' | 'geografia',
  ) =>
    request<{ ok: true; ruido_id: string; name: string }>(
      `/api/waiting/${id}/discard`,
      {
        method: 'POST',
        body: JSON.stringify({ from_type }),
      },
    ),

  promoteToProfile: (
    id: string,
    body?: {
      name?: string
      kind?: PersonKind
      aliases?: string[] | string
      notes?: string
    },
  ) =>
    request<{ ok: boolean; person: Person }>(`/api/persons/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  getPendingPersons: () =>
    request<{ proposals: EntityProposalView[] }>('/api/persons/pending'),

  approvePersonProposal: (
    id: string,
    body?: {
      name?: string
      kind?: PersonKind
      aliases?: string[] | string
      notes?: string
      matched_entity_id?: string
      as?: 'create' | 'link'
    },
  ) =>
    request<{
      ok: boolean
      person_id?: string
      link_id?: string
      discarded?: boolean
      mode?: string
    }>(`/api/persons/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  rejectPersonProposal: (id: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/persons/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // —— Agrupaciones ——
  listAgrupaciones: () =>
    request<{ agrupaciones: Agrupacion[] }>('/api/agrupaciones'),

  getAgrupacion: (id: string) =>
    request<{ agrupacion: Agrupacion; members: AgrupacionMember[] }>(
      `/api/agrupaciones/${id}`,
    ),

  listAgrupacionesByPerson: (personId: string) =>
    request<{ agrupaciones: Agrupacion[] }>(
      `/api/agrupaciones/by-person/${personId}`,
    ),

  createAgrupacion: (body: { name: string; notes?: string }) =>
    request<{ ok: boolean; agrupacion: Agrupacion }>('/api/agrupaciones', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAgrupacion: (
    id: string,
    body: { name?: string; notes?: string },
  ) =>
    request<{ ok: boolean; agrupacion: Agrupacion }>(
      `/api/agrupaciones/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),

  deleteAgrupacion: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/agrupaciones/${id}`, {
      method: 'DELETE',
    }),

  addAgrupacionMember: (agrupacionId: string, personId: string) =>
    request<{ ok: boolean; member: AgrupacionMember }>(
      `/api/agrupaciones/${agrupacionId}/members`,
      {
        method: 'POST',
        body: JSON.stringify({ person_id: personId }),
      },
    ),

  removeAgrupacionMember: (agrupacionId: string, personId: string) =>
    request<{ ok: boolean; id: string; person_id: string }>(
      `/api/agrupaciones/${agrupacionId}/members/${personId}`,
      { method: 'DELETE' },
    ),

  processAgrupacionMeta: (id: string) =>
    request<{
      ok: boolean
      agrupacion: Agrupacion
      members: AgrupacionMember[]
      generated_meta: AgrupacionGeneratedMeta
    }>(`/api/agrupaciones/${id}/process`, { method: 'POST' }),

  // —— Dominios ——
  listDominios: () => request<{ dominios: Dominio[] }>('/api/dominios'),

  getDominio: (id: string) =>
    request<{ dominio: Dominio }>(`/api/dominios/${id}`),

  createDominio: (body: { name: string; notes?: string }) =>
    request<{ ok: boolean; dominio: Dominio }>('/api/dominios', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateDominio: (id: string, body: { name?: string; notes?: string }) =>
    request<{ ok: boolean; dominio: Dominio }>(`/api/dominios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteDominio: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/dominios/${id}`, {
      method: 'DELETE',
    }),

  // —— Geografía ——
  listGeografia: () =>
    request<{
      places: import('../types').Geografia[]
      masters: import('../types').Geografia[]
      waiting: import('../types').Geografia[]
      waiting_count: number
    }>('/api/geografia'),

  getGeografia: (id: string) =>
    request<{ place: import('../types').Geografia }>(`/api/geografia/${id}`),

  createGeografia: (body: {
    name: string
    kind?: import('../types').GeoKind | string
    aliases?: string[] | string
    notes?: string
    parent_id?: string | null
  }) =>
    request<{ ok: boolean; place: import('../types').Geografia }>(
      '/api/geografia',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  updateGeografia: (
    id: string,
    body: {
      name?: string
      kind?: import('../types').GeoKind | string
      aliases?: string[] | string
      notes?: string
      parent_id?: string | null
      human_weight?: number
      capital_name?: string | null
    },
  ) =>
    request<{ ok: boolean; place: import('../types').Geografia }>(
      `/api/geografia/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),

  promoteGeografia: (id: string) =>
    request<{ ok: boolean; place: import('../types').Geografia }>(
      `/api/geografia/${id}/promote`,
      { method: 'POST', body: '{}' },
    ),

  deleteGeografia: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/geografia/${id}`, {
      method: 'DELETE',
    }),

  listGeografiaTree: () =>
    request<{ tree: import('../types').GeografiaTreeNode[] }>(
      '/api/geografia/tree',
    ),

  getGeografiaMap: (id: string) =>
    request<import('../types').GeografiaMapPayload>(
      `/api/geografia/${id}/map`,
    ),

  // —— Proyectos ——
  listProjects: () =>
    request<{
      projects: Project[]
      profiles: Project[]
      waiting: Project[]
      waiting_count: number
      profile_count: number
      pending_proposals_count?: number
    }>('/api/projects'),

  getProject: (id: string) =>
    request<{
      project: Project
      links: EntityLink[]
      people: PersonProjectLink[]
    }>(`/api/projects/${id}`),

  exportProjects: () =>
    request<{
      exported_at: string
      source: string
      count: number
      projects: unknown[]
    }>('/api/projects/export'),

  searchProjects: (q: string, opts?: { mode?: 'lexical' | 'semantic' | 'hybrid'; signal?: AbortSignal }) => {
    const qs = new URLSearchParams({ q })
    if (opts?.mode) qs.set('mode', opts.mode)
    return request<{
      query: string
      results: Array<{
        id: string
        title: string
        category: ProjectKind
        aliases_list: string[]
        score: number
      }>
    }>(`/api/projects/search?${qs}`, { signal: opts?.signal })
  },

  createProject: (body: {
    title: string
    category?: ProjectKind | string
    status?: ProjectStatus
    tactical_focus?: string
    notes?: string
    aliases?: string[] | string
  }) =>
    request<{ ok: boolean; project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProject: (
    id: string,
    body: {
      title?: string
      category?: ProjectKind | string
      status?: ProjectStatus
      tactical_focus?: string
      notes?: string
      aliases?: string[] | string
    },
  ) =>
    request<{ ok: boolean; project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),

  attachWaitingToProject: (waitingId: string, masterId: string) =>
    request<{
      ok: boolean
      master_id: string
      waiting_id: string
      alias_added?: string
      aliases?: string[]
    }>(`/api/projects/${waitingId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ master_id: masterId }),
    }),

  promoteToProject: (
    id: string,
    body?: {
      title?: string
      category?: ProjectKind | string
      status?: ProjectStatus
      tactical_focus?: string
      aliases?: string[] | string
      notes?: string
    },
  ) =>
    request<{ ok: boolean; project: Project }>(`/api/projects/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  getPendingProjects: () =>
    request<{ proposals: EntityProposalView[] }>('/api/projects/pending'),

  approveProjectProposal: (
    id: string,
    body?: {
      title?: string
      category?: string
      status?: ProjectStatus
      tactical_focus?: string
      notes?: string
      matched_entity_id?: string
      as?: 'create' | 'link'
    },
  ) =>
    request<{
      ok: boolean
      project_id: string
      link_id: string
      mode?: string
    }>(`/api/projects/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  rejectProjectProposal: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // —— Grafo (co-ocurrencia HITL) ——
  getGraphSnapshot: (opts?: { suggestions?: boolean }) => {
    const qs = new URLSearchParams()
    if (opts?.suggestions === false) qs.set('suggestions', '0')
    const q = qs.toString()
    return request<GraphSnapshot>(`/api/graph${q ? `?${q}` : ''}`)
  },

  searchGraphNodes: (
    q: string,
    limit = 12,
    opts?: { mode?: 'lexical' | 'semantic' | 'hybrid'; signal?: AbortSignal },
  ) => {
    const qs = new URLSearchParams({
      q,
      limit: String(limit),
    })
    if (opts?.mode) qs.set('mode', opts.mode)
    return request<{
      query: string
      results: Array<{ id: string; type: string; label: string; score: number }>
      mode?: string
    }>(`/api/graph/search?${qs}`, { signal: opts?.signal })
  },

  discoverGraphLinks: (params?: {
    person_id?: string
    project_id?: string
    limit?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.person_id) qs.set('person_id', params.person_id)
    if (params?.project_id) qs.set('project_id', params.project_id)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return request<{
      suggestions: GraphLinkSuggestion[]
      count: number
    }>(`/api/graph/discover${q ? `?${q}` : ''}`)
  },

  approveGraphLinkHitl: (body: {
    person_id: string
    project_id: string
    role?: PersonProjectRole | string
    alias?: string
    alias_target?: 'person' | 'project'
  }) =>
    request<{
      ok: boolean
      link: PersonProjectLink
      alias_added?: string
      aliases?: string[]
    }>('/api/graph/link-hitl', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  dismissGraphLinkSuggestion: (body: {
    person_id: string
    project_id: string
  }) =>
    request<{
      ok: boolean
      person_id: string
      project_id: string
      created: boolean
    }>('/api/graph/dismiss', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // —— Sandboxes de grafo ——
  listSandboxGraphs: () =>
    request<{ graphs: SandboxGraph[] }>('/api/sandboxes'),

  createSandboxGraph: (body: { name: string; description?: string }) =>
    request<{ graph: SandboxGraph }>('/api/sandboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSandboxSnapshot: (id: string) =>
    request<SandboxSnapshot>(`/api/sandboxes/${id}`),

  updateSandboxGraph: (
    id: string,
    body: { name?: string; description?: string },
  ) =>
    request<{ graph: SandboxGraph }>(`/api/sandboxes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSandboxGraph: (id: string) =>
    request<{ ok: boolean }>(`/api/sandboxes/${id}`, { method: 'DELETE' }),

  addSandboxNode: (
    graphId: string,
    body: {
      kind: SandboxNodeKind
      label?: string
      ref_id?: string | null
      color?: string | null
      notes?: string
    },
  ) =>
    request<{ node: SandboxNode }>(`/api/sandboxes/${graphId}/nodes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSandboxNode: (graphId: string, nodeId: string) =>
    request<{ ok: boolean }>(`/api/sandboxes/${graphId}/nodes/${nodeId}`, {
      method: 'DELETE',
    }),

  addSandboxLink: (
    graphId: string,
    body: {
      source_node_id: string
      target_node_id: string
      kind?: SandboxLinkKind
      label?: string
      quantomo_id?: string | null
    },
  ) =>
    request<{ link: SandboxLink }>(`/api/sandboxes/${graphId}/links`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSandboxLink: (graphId: string, linkId: string) =>
    request<{ ok: boolean }>(`/api/sandboxes/${graphId}/links/${linkId}`, {
      method: 'DELETE',
    }),

  promoteSandboxLink: (graphId: string, linkId: string) =>
    request<{
      ok: boolean
      already: boolean
      person_project_link_id: string | null
      link: SandboxLink
    }>(`/api/sandboxes/${graphId}/links/${linkId}/promote`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // —— Quántomos ——
  listQuantomos: (stage?: 'proto' | 'pre' | 'sealed' | 'premium' | 'all') =>
    request<{
      count: number
      avg_weight: number | null
      universes: Array<{ name: string; count: number }>
      stage?: string
      quantomos: Array<
        Quantomo & {
          entry_title: string
          entry_status: string
          timestamp_exact: string | null
          original_filename: string | null
          entry_created_at: string
        }
      >
    }>(`/api/quantomos${stage ? `?stage=${stage}` : ''}`),

  getQuantomoChest: () =>
    request<{
      ok: boolean
      open_threads: Array<{
        id: string
        title: string
        updated_at: string
        status: string
        hermetic_weight: number | null
      }>
      proto: Quantomo[]
      pre: Quantomo[]
      sealed: number
      premium: number
    }>('/api/quantomos/chest'),

  promoteQuantomoPre: (
    id: string,
    body?: {
      universe?: string | null
      profile?: Record<string, unknown>
      calendar?: Record<string, unknown>
    },
  ) =>
    request<{ ok: boolean; quantomo: Quantomo }>(
      `/api/quantomos/${id}/promote-pre`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  sealQuantomo: (id: string) =>
    request<{ ok: boolean; quantomo: Quantomo }>(`/api/quantomos/${id}/seal`, {
      method: 'POST',
      body: '{}',
    }),

  getQuantomoLattice: (id: string) =>
    request<{
      ok: boolean
      quantomo: Quantomo
      packet: Record<string, unknown> | null
      canonical: number[] | null
      domain_energies: number[]
      seal_ok: boolean
    }>(`/api/quantomos/${id}/lattice`),

  resonateQuantomo: (id: string) =>
    request<{
      ok: boolean
      neighbors: Array<{ id: string; title: string; score: number; stage: string }>
    }>(`/api/quantomos/${id}/resonate`),

  getQuantomo: (id: string) =>
    request<{
      quantomo: Quantomo & {
        entry_title: string
        entry_status: string
        timestamp_exact: string | null
        original_filename: string | null
        entry_created_at: string
      }
      siblings: Array<
        Pick<Quantomo, 'id' | 'title' | 'hermetic_weight' | 'universe'>
      >
    }>(`/api/quantomos/${id}`),

  // —— Bookmarks / Criba ——
  getBookmarkStats: (source: 'all' | 'twitter' | 'instagram' = 'all') =>
    request<{ ok: boolean; counts: BookmarkCounts; source?: string }>(
      `/api/bookmarks/stats?source=${source}`,
    ),

  getPendingBookmarks: (
    limit = 20,
    order: 'asc' | 'desc' | 'random' = 'asc',
    source: 'all' | 'twitter' | 'instagram' = 'all',
  ) =>
    request<{
      ok: boolean
      pending: Bookmark[]
      order: 'asc' | 'desc' | 'random'
      counts: BookmarkCounts
      source?: string
    }>(
      `/api/bookmarks/pending?limit=${limit}&order=${order}&source=${source}`,
    ),

  getProcessedBookmarks: (
    limit = 200,
    opts?: {
      minWeight?: number
      maxWeight?: number
      source?: 'all' | 'twitter' | 'instagram'
      approval?: 'pending' | 'approved' | 'all'
    },
  ) => {
    const min = opts?.minWeight ?? 1
    const max = opts?.maxWeight ?? 12
    const source = opts?.source ?? 'all'
    const approval = opts?.approval ?? 'all'
    return request<{
      ok: boolean
      processed: BookmarkProcessedRow[]
      filter: {
        min_weight: number
        max_weight: number
        approval: string
      }
      source?: string
      counts: BookmarkCounts
    }>(
      `/api/bookmarks/processed?limit=${limit}&min=${min}&max=${max}&source=${source}&approval=${approval}`,
    )
  },

  getScoredBookmarks: (
    limit = 200,
    opts?: {
      minWeight?: number
      maxWeight?: number
      source?: 'all' | 'twitter' | 'instagram'
      /** `cribado` = solo validados aún sin IA */
      status?: 'cribado' | 'all'
    },
  ) => {
    const min = opts?.minWeight ?? 1
    const max = opts?.maxWeight ?? 12
    const source = opts?.source ?? 'all'
    const status = opts?.status ?? 'all'
    return request<{
      ok: boolean
      scored: Bookmark[]
      filter: { min_weight: number; max_weight: number; status?: string }
      counts: BookmarkCounts
    }>(
      `/api/bookmarks/scored?limit=${limit}&min=${min}&max=${max}&source=${source}&status=${status}`,
    )
  },

  exportBookmarks: (opts?: {
    minWeight?: number
    maxWeight?: number
    source?: 'all' | 'twitter' | 'instagram'
  }) => {
    const min = opts?.minWeight ?? 1
    const max = opts?.maxWeight ?? 12
    const source = opts?.source ?? 'all'
    return request<{
      exported_at: string
      source: string
      filter: { min_weight: number; max_weight: number }
      count: number
      bookmarks: Array<Record<string, unknown>>
    }>(`/api/bookmarks/export?min=${min}&max=${max}&source=${source}`)
  },

  importBookmarksFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{
      ok: boolean
      imported: number
      skipped: number
      updated: number
      detected_source?: 'twitter' | 'instagram' | 'mixed'
      counts: BookmarkCounts
    }>('/api/bookmarks/import', { method: 'POST', body: form })
  },

  setBookmarkWeight: (id: string, weight: number) =>
    request<{
      ok: boolean
      id: string
      weight: number
      status: string
      counts: BookmarkCounts
    }>(`/api/bookmarks/${encodeURIComponent(id)}/weight`, {
      method: 'POST',
      body: JSON.stringify({ weight }),
    }),

  updateBookmarkNote: (
    id: string,
    body: {
      operator_note?: string
      manual_tags?: BookmarkManualTag[]
    },
  ) =>
    request<{
      ok: boolean
      bookmark: Bookmark
      links_applied: number
    }>(`/api/bookmarks/${encodeURIComponent(id)}/note`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  ensureBookmarkMedia: async (id: string) => {
    const res = await fetch(
      `/api/bookmarks/${encodeURIComponent(id)}/ensure-media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      id?: string
      local_media_path?: string
      media_url?: string
      error?: string
      link?: string
    }
    if (!res.ok || data.ok === false) {
      return {
        ok: false as const,
        error: data.error || `HTTP ${res.status}`,
        link: data.link,
      }
    }
    return {
      ok: true as const,
      id: data.id ?? id,
      local_media_path: data.local_media_path,
      media_url: data.media_url,
    }
  },

  bookmarkMediaUrl: (id: string) =>
    `/api/bookmarks/${encodeURIComponent(id)}/media`,

  processHighValueBookmarks: (limit = 25) =>
    request<{
      ok: boolean
      processed: number
      skipped: number
      errors: Array<{ id: string; error: string }>
      ids: string[]
      items: Array<{
        id: string
        weight: number
        category: string
        quantomo: string
        quantomo_id: string
        entry_id: string
        title: string
      }>
      counts: BookmarkCounts
    }>('/api/bookmarks/process-high-value', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  startBookmarkProcess: (limit = 5000) =>
    request<
      BookmarkQueueStatus & {
        ok: boolean
        queued: number
        message: string
        counts: BookmarkCounts
      }
    >('/api/bookmarks/process/start', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  stopBookmarkProcess: () =>
    request<
      BookmarkQueueStatus & { ok: boolean; counts: BookmarkCounts }
    >('/api/bookmarks/process/stop', { method: 'POST', body: '{}' }),

  getBookmarkProcessStatus: () =>
    request<BookmarkQueueStatus & { ok: boolean; counts: BookmarkCounts }>(
      '/api/bookmarks/process/status',
    ),

  getPendingBookmarkQuantomos: (limit = 200) =>
    request<{
      ok: boolean
      pending: Array<{
        bookmark_id: string
        quantomo_id: string
        entry_id: string
        weight: number | null
        category: string | null
        title: string
        content: string | null
        hermetic_weight: number | null
        human_weight: number | null
        suggested_weight: number | null
        author_username: string | null
        link: string | null
        text: string
      }>
      counts: BookmarkCounts
    }>(`/api/bookmarks/pending-quantomos?limit=${limit}`),

  approveBookmarkQuantomos: (ids?: string[]) =>
    request<{
      ok: boolean
      approved: number
      entryIds: string[]
      counts: BookmarkCounts
    }>('/api/bookmarks/approve-quantomos', {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  getBookmarkMediaDeps: () =>
    request<{
      ok: boolean
      ffmpeg_ok: boolean
      ocr_pending: number
      counts: BookmarkCounts
    }>('/api/bookmarks/media-deps'),

  reprocessBookmarkOcr: (id: string) =>
    request<{
      ok: boolean
      item: {
        id: string
        ocr_frame_count: number
        video_meta: string | null
        audio_summary: string | null
        title: string
        quantomo: string
        category: string
      }
      ffmpeg_ok: boolean
      counts: BookmarkCounts
    }>(`/api/bookmarks/${encodeURIComponent(id)}/reprocess-ocr`, {
      method: 'POST',
      body: '{}',
    }),

  reprocessBookmarkOcrBatch: (opts?: { ids?: string[]; limit?: number }) =>
    request<{
      ok: boolean
      processed: number
      skipped: number
      errors: Array<{ id: string; error: string }>
      items: Array<{
        id: string
        ocr_frame_count: number
        title: string
        quantomo: string
      }>
      ffmpeg_ok: boolean
      ocr_pending: number
      counts: BookmarkCounts
    }>('/api/bookmarks/reprocess-ocr', {
      method: 'POST',
      body: JSON.stringify({
        ids: opts?.ids,
        limit: opts?.limit ?? 25,
      }),
    }),

  // —— Cuadernos ——
  listNotebooks: () =>
    request<{ notebooks: import('../types').Notebook[] }>('/api/notebooks'),

  createNotebook: (title: string, kind: 'fisico' | 'digital') =>
    request<{ notebook: import('../types').Notebook }>('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify({ title, kind }),
    }),

  getNotebook: (id: string) =>
    request<{
      notebook: import('../types').Notebook
      pages: import('../types').NotebookPage[]
      index: import('../types').NotebookIndexEntry[]
      sources?: import('../types').NotebookSource[]
      summary: {
        total: number
        vacias: number
        pendiente_vision: number
        pendiente_validacion: number
        validadas?: number
        procesadas: number
        with_image: number
        media_missing_count?: number
      }
      media_missing_count?: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}`),

  updateNotebook: (
    id: string,
    patch: { title?: string; cover_url?: string | null },
  ) =>
    request<{ notebook: import('../types').Notebook }>(
      `/api/notebooks/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  deleteNotebook: (id: string) =>
    request<{
      ok: boolean
      id: string
      deleted_pages: number
      deleted_entries: number
    }>(`/api/notebooks/${id}`, { method: 'DELETE' }),

  ingestNotebookPdf: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{
      ok: boolean
      notebook_id: string
      pages_imported: number
      pages_blank: number
      pages_truncated: number
      vision_queued: number
      pending_ocr?: number
      warning?: string
    }>(`/api/notebooks/${id}/ingest-pdf`, { method: 'POST', body: form })
  },

  ingestNotebookImages: (
    id: string,
    files: File[],
    opts?: { mode?: 'append' | 'from_slot'; startSlot?: number },
  ) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    form.append('mode', opts?.mode ?? 'append')
    if (opts?.startSlot != null) {
      form.append('start_slot', String(opts.startSlot))
    }
    return request<{
      ok: boolean
      notebook_id: string
      pages_imported: number
      pages_blank: number
      slots_assigned: number[]
      vision_queued: number
      pending_ocr?: number
      warning?: string
    }>(`/api/notebooks/${id}/ingest-images`, { method: 'POST', body: form })
  },

  repairNotebookMedia: (id: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    return request<{
      ok: boolean
      repaired?: boolean
      media_missing_count?: number
      pages_imported?: number
      slots_assigned?: number[]
      warning?: string
    }>(`/api/notebooks/${id}/repair-media`, { method: 'POST', body: form })
  },

  convertNotebookL72: (id: string) =>
    request<{
      ok: boolean
      notebook_id: string
      sealed: number
      replaced: number
      quantomo_ids: string[]
    }>(`/api/notebooks/${id}/convert-l72`, { method: 'POST' }),

  uploadNotebookSources: (id: string, files: File[], note?: string) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (note?.trim()) form.append('note', note.trim())
    return request<{ sources: NotebookSource[]; warning?: string }>(
      `/api/notebooks/${id}/sources`,
      { method: 'POST', body: form },
    )
  },

  addNotebookSourceNote: (id: string, text: string) =>
    request<{ source: NotebookSource }>(`/api/notebooks/${id}/sources/note`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  listNotebookSources: (id: string) =>
    request<{ sources: NotebookSource[] }>(`/api/notebooks/${id}/sources`),

  deleteNotebookSource: (id: string, sourceId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/notebooks/${id}/sources/${sourceId}`,
      { method: 'DELETE' },
    ),

  getNotebookPage: (id: string, slot: number) =>
    request<{
      page: import('../types').NotebookPage
      label: string
    }>(`/api/notebooks/${id}/pages/${slot}`),

  patchNotebookPage: (
    id: string,
    slot: number,
    patch: {
      title?: string
      transcription_spatial?: string
      graphic_elements?: import('../types').GraphicElement[] | string
      is_blank?: boolean
      status?: string
      numero_logico?: number
      posicion_visual?: string
      explanation?: string
      explanation_ai?: string
      explanation_weight?: number | null
      mentioned_entities?: import('../types').BlobTag[]
    },
  ) =>
    request<{ page: import('../types').NotebookPage }>(
      `/api/notebooks/${id}/pages/${slot}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  reprocessNotebookPageVision: (id: string, slot: number) =>
    request<{
      ok: boolean
      queued: boolean
      vision_queue: { running: boolean; pending: number }
    }>(`/api/notebooks/${id}/pages/${slot}/reprocess-vision`, {
      method: 'POST',
    }),

  replaceNotebookPageImage: (
    id: string,
    slot: number,
    image_base64: string,
    reprocess = true,
  ) =>
    request<{
      ok: boolean
      page: import('../types').NotebookPage
      vision_queued: boolean
      vision_queue: { running: boolean; pending: number }
    }>(`/api/notebooks/${id}/pages/${slot}/image`, {
      method: 'PUT',
      body: JSON.stringify({ image_base64, reprocess }),
    }),

  transformNotebookPageImage: (
    id: string,
    slot: number,
    body: {
      rotate?: 0 | 90 | 180 | 270
      crop?: [number, number, number, number] | null
      reprocess?: boolean
    },
  ) =>
    request<{
      ok: boolean
      page: import('../types').NotebookPage
      vision_queued: boolean
      vision_queue: { running: boolean; pending: number }
    }>(`/api/notebooks/${id}/pages/${slot}/transform`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  splitNotebookSpread: (id: string, slot: number) =>
    request<{
      ok: boolean
      left_slot: number
      right_slot: number
      left: import('../types').NotebookPage
      right: import('../types').NotebookPage
      vision_queue: { running: boolean; pending: number }
    }>(`/api/notebooks/${id}/pages/${slot}/split-spread`, {
      method: 'POST',
    }),

  confirmNotebookPage: (id: string, slot: number) =>
    request<{
      ok: boolean
      queued: boolean
      already: boolean
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/pages/${slot}/confirm`, { method: 'POST' }),

  validateNotebookExplanation: (
    id: string,
    slot: number,
    body: {
      weight: number
      explanation_ai?: string
      explanation?: string
    },
  ) =>
    request<{
      ok: boolean
      page: import('../types').NotebookPage
      queued?: boolean
      already?: boolean
      already_in_corpus?: boolean
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/pages/${slot}/validate-explanation`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  approveNotebookTranscription: (id: string, slot: number) =>
    request<{
      ok: boolean
      page: import('../types').NotebookPage
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/pages/${slot}/approve-transcription`, {
      method: 'POST',
    }),

  fullReadNotebook: (id: string) =>
    request<{
      ok: boolean
      vision_queued: number
      confirm_queued: number
      skipped: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/full-read`, { method: 'POST' }),

  processNotebookOcr: (id: string) =>
    request<{
      ok: boolean
      vision_queued: number
      confirm_queued: number
      skipped: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/process-ocr`, { method: 'POST' }),

  generateNotebookExplanations: (id: string) =>
    request<{
      ok: boolean
      queued: number
      skipped: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/generate-explanations`, { method: 'POST' }),

  sendNotebookToCorpus: (id: string) =>
    request<{
      ok: boolean
      queued: number
      skipped: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/send-to-corpus`, { method: 'POST' }),

  validateAllNotebookExplanations: (id: string, weight = 7) =>
    request<{
      ok: boolean
      queued: number
      skipped: number
      stamped: number
      vision_queue: NotebookQueueStatus
    }>(`/api/notebooks/${id}/validate-all-explanations`, {
      method: 'POST',
      body: JSON.stringify({ weight }),
    }),

  exportNotebook: async (id: string, titleHint?: string) => {
    const res = await fetch(`/api/notebooks/${id}/export`)
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        /* ignore */
      }
      throw new Error(message)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const match = /filename="([^"]+)"/.exec(cd)
    const day = new Date().toISOString().slice(0, 10)
    const fallback = `cuaderno-${(titleHint || 'export')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'export'}-${day}.zip`
    const filename = match?.[1] || fallback
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true as const, filename }
  },

  saveNotebookCanvas: (
    id: string,
    slot: number,
    body: {
      image_base64?: string
      title?: string
      transcription_spatial?: string
      graphic_elements?: import('../types').GraphicElement[]
      run_vision?: boolean
    },
  ) =>
    request<{
      page: import('../types').NotebookPage
      vision_queue: { running: boolean; pending: number }
    }>(`/api/notebooks/${id}/pages/${slot}/canvas`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  notebookPageImageUrl: (id: string, slot: number) =>
    `/api/notebooks/${id}/pages/${slot}/image`,

  previewChat: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ ok: boolean; preview: ChatPreview }>(
      '/api/chats/preview',
      { method: 'POST', body: form },
    )
  },

  importChat: (input: {
    file: File
    nombre_chat?: string
    tipo?: ChatTipo
    person_ids?: string[]
    project_ids?: string[]
    speaker_map?: ChatSpeakerMap[]
    primary_person_id?: string | null
    primary_project_id?: string | null
  }) => {
    const form = new FormData()
    form.append('file', input.file)
    if (input.nombre_chat) form.append('nombre_chat', input.nombre_chat)
    if (input.tipo) form.append('tipo', input.tipo)
    if (input.person_ids?.length) {
      form.append('person_ids', JSON.stringify(input.person_ids))
    }
    if (input.project_ids?.length) {
      form.append('project_ids', JSON.stringify(input.project_ids))
    }
    if (input.speaker_map?.length) {
      form.append('speaker_map', JSON.stringify(input.speaker_map))
    }
    if (input.primary_person_id) {
      form.append('primary_person_id', input.primary_person_id)
    }
    if (input.primary_project_id) {
      form.append('primary_project_id', input.primary_project_id)
    }
    return request<{
      ok: boolean
      session: ChatSession
      message_count: number
      block_count: number
      link_count: number
    }>('/api/chats/import', { method: 'POST', body: form })
  },

  listChats: () =>
    request<{ ok: boolean; sessions: ChatSession[] }>('/api/chats'),

  deleteChat: (id: string) =>
    request<{
      ok: boolean
      id: string
      deleted_blocks: number
      deleted_entries: number
    }>(`/api/chats/${id}`, { method: 'DELETE' }),

  getChat: (id: string) =>
    request<{
      ok: boolean
      session: ChatSession
      speakers: ChatSpeakerMap[]
      blocks: ChatBlock[]
      messages_sample: ChatMessage[]
      stats: {
        message_count: number
        system_count: number
        media_count: number
        link_count: number
        pending_blocks: number
      }
    }>(`/api/chats/${id}`),

  patchChat: (
    id: string,
    body: {
      nombre_chat?: string
      tipo?: ChatTipo
      speaker_map?: ChatSpeakerMap[]
      person_ids?: string[]
      project_ids?: string[]
      primary_person_id?: string | null
      primary_project_id?: string | null
      human_weight?: number | null
    },
  ) =>
    request<{ ok: boolean; session: ChatSession }>(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  processChat: (id: string, limit = 1, blockId?: string) =>
    request<{
      ok: boolean
      processed: number
      skipped: number
      remaining: number
      errors: Array<{ block_id: string; error: string }>
      items: Array<{
        block_id: string
        entry_id: string
        quantomo_id: string
        title: string
      }>
    }>(`/api/chats/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({ limit, block_id: blockId }),
    }),

  getChatBlock: (id: string, blockId: string) =>
    request<{
      ok: boolean
      session: ChatSession
      block: ChatBlock
      messages: ChatMessage[]
      speakers: ChatSpeakerMap[]
      entities: ChatBlockEntityView[]
    }>(`/api/chats/${id}/blocks/${blockId}`),

  patchChatBlock: (
    id: string,
    blockId: string,
    body: {
      person_ids?: string[]
      project_ids?: string[]
      entities?: Array<{ kind: string; id: string; name: string }>
      human_weight?: number | null
      notes?: string
      links?: string[]
    },
  ) =>
    request<{ ok: boolean; block: ChatBlock }>(
      `/api/chats/${id}/blocks/${blockId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  processChatBlock: (id: string, blockId: string) =>
    request<{
      ok: boolean
      processed: number
      remaining: number
      errors: Array<{ block_id: string; error: string }>
      items: Array<{
        block_id: string
        entry_id: string
        quantomo_id: string
        title: string
      }>
    }>(`/api/chats/${id}/blocks/${blockId}/process`, { method: 'POST' }),

  assignChatEntity: (
    id: string,
    blockId: string,
    body: {
      name: string
      type: 'person' | 'project'
      action: 'link' | 'create' | 'reject'
      entity_id?: string
      create_name?: string
    },
  ) =>
    request<{ ok: boolean; entity: ChatBlockEntityView }>(
      `/api/chats/${id}/blocks/${blockId}/entities`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listLinks: (opts?: {
    q?: string
    estado?: string
    source_type?: string
    limit?: number
  }) => {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.estado) params.set('estado', opts.estado)
    if (opts?.source_type) params.set('source_type', opts.source_type)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return request<{ ok: boolean; links: LinkHarvest[]; total: number }>(
      `/api/links${qs ? `?${qs}` : ''}`,
    )
  },

  backfillLinks: () =>
    request<{ ok: boolean; scanned: number; inserted: number }>(
      '/api/links/backfill',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getRun: () =>
    request<{ ok: boolean; run: AppRun | null }>('/api/run'),

  startRun: (name: string) =>
    request<{ ok: true; run: AppRun }>('/api/run/start', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  newUserRun: (opts: {
    confirmDestroy: string
    operatorName: string
    newName: string
  }) =>
    request<{
      ok: true
      filename: string
      backup_path: string
      dump: unknown
      run: AppRun
    }>('/api/run/new-user', {
      method: 'POST',
      body: JSON.stringify({
        confirm_destroy: opts.confirmDestroy,
        operator_name: opts.operatorName,
        new_name: opts.newName,
      }),
    }),

  backupSummary: () =>
    request<{
      ok: boolean
      exported_at: string
      include_media: false
      run: {
        id: string
        operator_name: string
        operator_id: string
        started_at: string
        ended_at: string | null
        day_count: number
      } | null
      tables: Record<string, number>
      vault_files: number
      vault_bytes: number
      feedback_files: number
      feedback_bytes: number
      groups: {
        transcripciones: number
        perfiles: number
        conexiones: number
        quantomos: number
        validaciones: number
        ida: number
        resto: number
      }
    }>('/api/backup/summary'),

  getProviderConfig: () =>
    request<ProviderConfigResponse>('/api/config/providers'),

  getLocalToken: () => request<{ ok: boolean; token: string }>('/api/config/local-token'),

  putProviderConfig: (body: {
    provider?: Partial<ProviderConfigResponse['provider']>
    model?: Partial<ProviderConfigResponse['model']>
  }) =>
    request<ProviderConfigResponse>('/api/config/providers', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  sendFeedback: (opts: {
    body: string
    viewId: string
    context: Record<string, unknown>
    logs: unknown[]
    images: File[]
  }) => {
    const form = new FormData()
    form.append('body', opts.body)
    form.append('view_id', opts.viewId)
    form.append('context_json', JSON.stringify(opts.context))
    form.append('logs_json', JSON.stringify(opts.logs))
    for (const img of opts.images) form.append('images', img)
    return request<{ ok: true; id: string; folder: string; images: number }>(
      '/api/feedback',
      { method: 'POST', body: form },
    )
  },

  restoreBackup: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<BackupApplyResult>('/api/backup/restore', {
      method: 'POST',
      body: form,
    })
  },

  mergeBackup: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<BackupApplyResult>('/api/backup/merge', {
      method: 'POST',
      body: form,
    })
  },

  amazonaOverview: () =>
    request<{ ok: boolean; overview: AmaOverview; cycle: AmaCycleState }>(
      '/api/amazona/overview',
    ),

  amazonaCycle: () =>
    request<{ ok: boolean; cycle: AmaCycleState }>('/api/amazona/cycle'),

  amazonaAdvanceCycle: () =>
    request<{ ok: boolean; cycle: AmaCycleState }>('/api/amazona/cycle/advance', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  amazonaListLists: (opts?: { kind?: AmaListKind; q?: string }) => {
    const qs = new URLSearchParams()
    if (opts?.kind) qs.set('kind', opts.kind)
    if (opts?.q) qs.set('q', opts.q)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<{ ok: boolean; lists: AmaList[] }>(`/api/amazona/lists${suffix}`)
  },

  amazonaGetList: (id: string) =>
    request<{ ok: boolean; list: AmaListHydrated; links: AmaLink[] }>(
      `/api/amazona/lists/${id}`,
    ),

  amazonaCreateList: (body: {
    title: string
    notes?: string
    kind: AmaListKind
    tags?: string[] | string
    tridente_a_id?: string
    tridente_b_id?: string
    items?: Array<{ label?: string; notes?: string }>
  }) =>
    request<{ ok: boolean; list: AmaListHydrated }>('/api/amazona/lists', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaUpdateList: (
    id: string,
    body: {
      title?: string
      notes?: string
      tags?: string[] | string
      tridente_a_id?: string
      tridente_b_id?: string
    },
  ) =>
    request<{ ok: boolean; list: AmaListHydrated }>(`/api/amazona/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  amazonaDeleteList: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/amazona/lists/${id}`, {
      method: 'DELETE',
    }),

  amazonaPutListItems: (
    id: string,
    items: Array<{
      id?: string
      label?: string
      notes?: string
      place_id?: string | null
    }>,
  ) =>
    request<{ ok: boolean; list: AmaListHydrated }>(
      `/api/amazona/lists/${id}/items`,
      { method: 'PUT', body: JSON.stringify({ items }) },
    ),

  amazonaUpdateItem: (
    id: string,
    body: {
      label?: string
      notes?: string
      place_id?: string | null
    },
  ) =>
    request<{ ok: boolean; item: AmaListItem }>(`/api/amazona/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  amazonaAddChildItem: (id: string, body: { label: string; notes?: string }) =>
    request<{ ok: boolean; item: AmaListItem }>(
      `/api/amazona/items/${id}/children`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  amazonaDeleteItem: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/amazona/items/${id}`, {
      method: 'DELETE',
    }),

  amazonaListMatrices: (order_n?: 3 | 6) => {
    const qs = order_n ? `?order_n=${order_n}` : ''
    return request<{ ok: boolean; matrices: AmaMatrix[] }>(
      `/api/amazona/matrices${qs}`,
    )
  },

  amazonaGetMatrix: (id: string) =>
    request<{
      ok: boolean
      matrix: AmaMatrixHydrated
      links: AmaLink[]
    }>(`/api/amazona/matrices/${id}`),

  amazonaCreateMatrix: (body: {
    title: string
    notes?: string
    order_n?: 3 | 6
    row_list_id: string
    col_list_id: string
    tags?: string[] | string
  }) =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated }>('/api/amazona/matrices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaCreateExampleMatrix: () =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated; reused?: boolean }>(
      '/api/amazona/matrices/example',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  amazonaUpdateMatrix: (
    id: string,
    body: { title?: string; notes?: string; tags?: string[] | string },
  ) =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated }>(
      `/api/amazona/matrices/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  amazonaDeleteMatrix: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/amazona/matrices/${id}`, {
      method: 'DELETE',
    }),

  amazonaSwapMatrix: (id: string) =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated }>(
      `/api/amazona/matrices/${id}/swap`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  amazonaSwapNeo: (id: string) =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated }>(
      `/api/amazona/matrices/${id}/neo/swap`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  amazonaPatchCell: (
    matrixId: string,
    body: {
      row_item_id: string
      col_item_id: string
      title?: string | null
      notes?: string
      cycle_slot?: AmaCycleSlot | null
      place_id?: string | null
    },
  ) =>
    request<{ ok: boolean; cell: AmaCell; matrix: AmaMatrixHydrated }>(
      `/api/amazona/matrices/${matrixId}/cells`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  amazonaPatchNeo: (
    matrixId: string,
    body: { title_index: number; cycle_slot: AmaCycleSlot; notes: string },
  ) =>
    request<{ ok: boolean; matrix: AmaMatrixHydrated }>(
      `/api/amazona/matrices/${matrixId}/neo`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  amazonaListPlaces: () =>
    request<{ ok: boolean; places: AmaPlace[] }>('/api/amazona/places'),

  amazonaCreatePlace: (body: {
    name: string
    notes?: string
    lat?: number | null
    lng?: number | null
    kind?: AmaPlaceKind
    tags?: string[] | string
  }) =>
    request<{ ok: boolean; place: AmaPlace }>('/api/amazona/places', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaPingPlace: (body: {
    lat: number
    lng: number
    name?: string
    notes?: string
    snap?: boolean
  }) =>
    request<{
      ok: boolean
      snapped: boolean
      meters: number | null
      place: AmaPlace
    }>('/api/amazona/places/ping', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaUpdatePlace: (
    id: string,
    body: {
      name?: string
      notes?: string
      lat?: number | null
      lng?: number | null
      kind?: AmaPlaceKind
      tags?: string[] | string
    },
  ) =>
    request<{ ok: boolean; place: AmaPlace }>(`/api/amazona/places/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  amazonaDeletePlace: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/amazona/places/${id}`, {
      method: 'DELETE',
    }),

  amazonaListFlows: () =>
    request<{ ok: boolean; flows: AmaFlow[] }>('/api/amazona/flows'),

  amazonaCreateFlow: (body: {
    from_place_id: string
    to_place_id: string
    recorded_at?: string
    notes?: string
    cycle_slot?: AmaCycleSlot | null
  }) =>
    request<{ ok: boolean; flow: AmaFlow }>('/api/amazona/flows', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaDeleteFlow: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/amazona/flows/${id}`, {
      method: 'DELETE',
    }),

  amazonaListLinks: (object_type: AmaLinkObjectType, object_id: string) => {
    const qs = new URLSearchParams({ object_type, object_id })
    return request<{ ok: boolean; links: AmaLink[] }>(
      `/api/amazona/links?${qs}`,
    )
  },

  amazonaCreateLink: (body: {
    object_type: AmaLinkObjectType
    object_id: string
    target_kind: AmaLinkTargetKind
    target_id: string
    role?: string
  }) =>
    request<{ ok: boolean; links: AmaLink[] }>('/api/amazona/links', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  amazonaDeleteLink: (id: string) =>
    request<{ ok: boolean; id: string; links: AmaLink[] }>(
      `/api/amazona/links/${id}`,
      { method: 'DELETE' },
    ),

  mapOverview: (systemId?: string) => {
    const qs = systemId
      ? `?${new URLSearchParams({ system_id: systemId })}`
      : ''
    return request<{ ok: boolean } & MapOverview>(`/api/map/overview${qs}`)
  },

  mapCreateSystem: (body: {
    name: string
    notes?: string
    center_lat: number
    center_lng: number
    zoom?: number
    pitch?: number
    bearing?: number
    copy_from?: string | null
  }) =>
    request<{ ok: boolean; system: MapSystem }>('/api/map/systems', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  mapPatchSystem: (
    id: string,
    body: {
      name?: string
      notes?: string
      center_lat?: number
      center_lng?: number
      zoom?: number
      pitch?: number
      bearing?: number
    },
  ) =>
    request<{ ok: boolean; system: MapSystem }>(`/api/map/systems/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  mapDeleteSystem: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/map/systems/${id}`, {
      method: 'DELETE',
    }),

  mapPatchLayer: (
    id: string,
    body: { visible?: number | boolean; opacity?: number; title?: string },
  ) =>
    request<{ ok: boolean; layer: MapLayer }>(`/api/map/layers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  mapCreateTag: (body: {
    system_id: string
    lat: number
    lng: number
    label: string
    notes?: string
    place_id?: string | null
    layer_id?: string | null
    target_kind?: string | null
    target_id?: string | null
  }) =>
    request<{ ok: boolean; tag: MapTag }>('/api/map/tags', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  mapDeleteTag: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/map/tags/${id}`, {
      method: 'DELETE',
    }),

  mapOccupancy: (placeId: string) => {
    const qs = new URLSearchParams({ place_id: placeId })
    return request<{
      ok: boolean
      place_id: string
      place_name: string
      items: MapOccupancyItem[]
    }>(`/api/map/occupancy?${qs}`)
  },

  mapOccupy: (body: {
    place_id: string
    kind: 'person' | 'project' | 'agrupacion' | 'entry'
    id: string
  }) =>
    request<{ ok: boolean }>('/api/map/occupy', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  mapUnoccupy: (body: {
    place_id: string
    kind: 'person' | 'project' | 'agrupacion' | 'entry'
    id: string
  }) =>
    request<{ ok: boolean }>('/api/map/occupy', {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),

  mapH3: (lat: number, lng: number, res?: number, k?: number) => {
    const qs = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    })
    if (res != null) qs.set('res', String(res))
    if (k != null) qs.set('k', String(k))
    return request<{
      ok: boolean
      cell: string
      disk: string[]
      resolution: number
    }>(`/api/map/h3?${qs}`)
  },

  mapSearchEntries: (q: string) => {
    const qs = new URLSearchParams({ q })
    return request<{
      ok: boolean
      entries: Array<{
        id: string
        title: string
        status: string
        source_type: string
        place_id: string | null
      }>
    }>(`/api/map/search-entries?${qs}`)
  },

  deprocastCatalog: () =>
    request<{
      ok: boolean
      power_notes: DeproPowerNote[]
      ida: DeproIdaItem[]
      ida_matrix: AmaMatrixHydrated | null
    }>('/api/deprocast/catalog'),

  deprocastPatchPower: (
    index: number,
    body: { notes?: string; status?: DeproPowerStatus | null },
  ) =>
    request<{ ok: boolean; note: DeproPowerNote }>(
      `/api/deprocast/powers/${index}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  deprocastListIda: (archived = false) => {
    const qs = archived ? '?archived=1' : ''
    return request<{ ok: boolean; items: DeproIdaItem[] }>(
      `/api/deprocast/ida${qs}`,
    )
  },

  deprocastCreateIda: (body: {
    title: string
    body?: string
    stage?: DeproIdaStage
    power_indexes?: number[]
    agent_ids?: string[]
    tags?: string[]
    matrix_id?: string | null
    row_item_id?: string | null
    col_item_id?: string | null
    weight?: number | null
    kind?: DeproIdaKind
    domain_ids?: string[]
  }) =>
    request<{ ok: boolean; item: DeproIdaItem }>('/api/deprocast/ida', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deprocastPatchIda: (
    id: string,
    body: {
      title?: string
      body?: string
      stage?: DeproIdaStage
      power_indexes?: number[]
      agent_ids?: string[]
      tags?: string[]
      archived?: boolean
      matrix_id?: string | null
      row_item_id?: string | null
      col_item_id?: string | null
      weight?: number | null
      kind?: DeproIdaKind
      domain_ids?: string[]
    },
  ) =>
    request<{ ok: boolean; item: DeproIdaItem }>(`/api/deprocast/ida/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deprocastDeleteIda: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/deprocast/ida/${id}`, {
      method: 'DELETE',
    }),

  deprocastIdaDue: () =>
    request<{ ok: boolean; cards: DeproIdaCardDue[] }>(
      '/api/deprocast/ida/due',
    ),

  deprocastIdaExport: () =>
    request<{ ok: boolean; markdown: string }>('/api/deprocast/ida/export'),

  deprocastIdaNeighbors: (id: string) =>
    request<{ ok: boolean; neighbors: DeproIdaNeighbor[] }>(
      `/api/deprocast/ida/${id}/neighbors`,
    ),

  deprocastProposeIdaCards: (id: string) =>
    request<{ ok: boolean; cards: DeproIdaCardProposal[] }>(
      `/api/deprocast/ida/${id}/propose-cards`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  deprocastListIdaCards: (id: string) =>
    request<{ ok: boolean; cards: DeproIdaCard[] }>(
      `/api/deprocast/ida/${id}/cards`,
    ),

  deprocastCreateIdaCard: (
    id: string,
    body: { question: string; answer?: string },
  ) =>
    request<{ ok: boolean; card: DeproIdaCard }>(
      `/api/deprocast/ida/${id}/cards`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  deprocastPatchIdaCard: (
    cardId: string,
    body: { question?: string; answer?: string; due_at?: string | null },
  ) =>
    request<{ ok: boolean; card: DeproIdaCard }>(
      `/api/deprocast/ida/cards/${cardId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  deprocastReviewIdaCard: (cardId: string, grade: DeproIdaCardGrade) =>
    request<{ ok: boolean; card: DeproIdaCard }>(
      `/api/deprocast/ida/cards/${cardId}/review`,
      { method: 'POST', body: JSON.stringify({ grade }) },
    ),

  deprocastDeleteIdaCard: (cardId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/deprocast/ida/cards/${cardId}`,
      { method: 'DELETE' },
    ),

  deprocastListResearchPacks: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<{ ok: boolean; packs: DeproResearchPack[] }>(
      `/api/deprocast/research/packs${qs}`,
    )
  },

  deprocastGetResearchPack: (id: string) =>
    request<{
      ok: boolean
      pack: DeproResearchPack
      findings: DeproResearchFinding[]
    }>(`/api/deprocast/research/packs/${id}`),

  deprocastResearchPrompt: (topic: string) =>
    request<{ ok: boolean; topic: string; prompt: string }>(
      '/api/deprocast/research/prompt',
      { method: 'POST', body: JSON.stringify({ topic }) },
    ),

  deprocastResearchIngest: (body: {
    payload: string
    agent_id?: string
    prompt_key?: string
    parent_finding_id?: string | null
    parent_pack_id?: string | null
  }) =>
    request<{
      ok: boolean
      pack: DeproResearchPack
      findings: DeproResearchFinding[]
    }>('/api/deprocast/research/ingest', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deprocastResearchRun: (body: {
    topic: string
    agent_id?: string
    prompt_key?: string
  }) =>
    request<{ ok: boolean; pack: DeproResearchPack }>(
      '/api/deprocast/research/run',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  deprocastAssimilateFinding: (
    id: string,
    body?: {
      row_item_id?: string | null
      col_item_id?: string | null
      matrix_id?: string | null
      domain_ids?: string[]
    },
  ) =>
    request<{
      ok: boolean
      finding: DeproResearchFinding
      item: DeproIdaItem
    }>(`/api/deprocast/research/findings/${id}/assimilate`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  deprocastDiscardFinding: (id: string) =>
    request<{ ok: boolean; finding: DeproResearchFinding }>(
      `/api/deprocast/research/findings/${id}/discard`,
      { method: 'POST', body: '{}' },
    ),

  deprocastFractalizeFinding: (id: string) =>
    request<{
      ok: boolean
      topic: string
      prompt: string
      parent_finding_id: string
      parent_pack_id: string
    }>(`/api/deprocast/research/findings/${id}/fractalize`, {
      method: 'POST',
      body: '{}',
    }),

  deprocastAssimilatePending: (
    packId: string,
    body?: {
      row_item_id?: string | null
      col_item_id?: string | null
      matrix_id?: string | null
      domain_ids?: string[]
    },
  ) =>
    request<{ ok: boolean; items: DeproIdaItem[]; count: number }>(
      `/api/deprocast/research/packs/${packId}/assimilate-pending`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  deprocastDiscardPending: (packId: string) =>
    request<{ ok: boolean; count: number }>(
      `/api/deprocast/research/packs/${packId}/discard-pending`,
      { method: 'POST', body: '{}' },
    ),

  deprocastDeleteResearchPack: (packId: string) =>
    request<{ ok: boolean; id: string }>(
      `/api/deprocast/research/packs/${packId}`,
      { method: 'DELETE' },
    ),

  listDialogoThreads: () =>
    request<{ ok: boolean; threads: DialogoThread[] }>('/api/dialogo/threads'),

  createDialogoThread: (body: {
    title?: string
    section_key?: string | null
    entity_refs?: DialogoEntityRef[]
  }) =>
    request<{ ok: boolean; thread: DialogoThread }>('/api/dialogo/threads', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getDialogoThread: (id: string) =>
    request<{
      ok: boolean
      thread: DialogoThread
      messages: DialogoMessage[]
    }>(`/api/dialogo/threads/${id}`),

  updateDialogoThread: (
    id: string,
    body: {
      title?: string
      section_key?: string | null
      entity_refs?: DialogoEntityRef[]
    },
  ) =>
    request<{ ok: boolean; thread: DialogoThread }>(
      `/api/dialogo/threads/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),

  postDialogoMessage: (id: string, content: string) =>
    request<{
      ok: boolean
      user: DialogoMessage
      assistant: DialogoMessage
      thread: DialogoThread
    }>(`/api/dialogo/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  closeDialogoThread: (id: string, hermeticWeight: number, title?: string) =>
    request<{
      ok: boolean
      thread_id: string
      entry_id: string
      weight: number
      proto: Array<{ id: string; title: string }>
    }>(`/api/dialogo/threads/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ hermetic_weight: hermeticWeight, title }),
    }),

  listDashboardPins: () =>
    request<{ ok: boolean; pins: DashboardPin[] }>('/api/dialogo/pins'),

  setDashboardPins: (
    pins: Array<{
      slot: number
      ref_type: DialogoEntityRefType
      ref_id: string
      label: string
    }>,
  ) =>
    request<{ ok: boolean; pins: DashboardPin[] }>('/api/dialogo/pins', {
      method: 'PUT',
      body: JSON.stringify({ pins }),
    }),

  listSentinelAgents: () =>
    request<{ ok: boolean; agents: SentinelAgent[] }>('/api/sentinela/agents'),

  createSentinelAgent: () =>
    request<{ ok: boolean; agent: SentinelAgent }>('/api/sentinela/agents', {
      method: 'POST',
      body: '{}',
    }),

  getSentinelAgent: (id: string) =>
    request<{
      ok: boolean
      agent: SentinelAgent
      missions: SentinelMission[]
      skills: SentinelSkill[]
      events: SentinelEvent[]
      messages: SentinelMessage[]
      brain?: { provider: string; model: string; label: string }
    }>(`/api/sentinela/agents/${id}`),

  abortSentinelInspect: (id: string) =>
    request<{ ok: boolean; agent: SentinelAgent }>(
      `/api/sentinela/agents/${id}/abort`,
      { method: 'POST', body: '{}' },
    ),

  renameSentinelAgent: (id: string, name: string) =>
    request<{ ok: boolean; agent: SentinelAgent }>(
      `/api/sentinela/agents/${id}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ),

  deleteSentinelAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/sentinela/agents/${id}`, {
      method: 'DELETE',
    }),

  createSentinelMission: (
    agentId: string,
    body: {
      instructions: string
      expected_output?: string
      resources?: string[]
    },
  ) =>
    request<{ ok: boolean; mission: SentinelMission }>(
      `/api/sentinela/agents/${agentId}/missions`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  postSentinelMissionMessage: (missionId: string, content: string) =>
    request<{ ok: boolean; mission: SentinelMission }>(
      `/api/sentinela/missions/${missionId}/messages`,
      { method: 'POST', body: JSON.stringify({ content }) },
    ),

  pauseSentinelMission: (missionId: string) =>
    request<{ ok: boolean; mission: SentinelMission }>(
      `/api/sentinela/missions/${missionId}/pause`,
      { method: 'POST', body: '{}' },
    ),

  resumeSentinelMission: (missionId: string) =>
    request<{ ok: boolean; mission: SentinelMission }>(
      `/api/sentinela/missions/${missionId}/resume`,
      { method: 'POST', body: '{}' },
    ),

  patchSentinelMission: (
    missionId: string,
    body: { instructions?: string; expected_output?: string },
  ) =>
    request<{ ok: boolean; mission: SentinelMission }>(
      `/api/sentinela/missions/${missionId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  acceptSentinelSkill: (
    skillId: string,
    body?: { weight?: number; promote_ida?: boolean },
  ) =>
    request<{ ok: boolean; skill: SentinelSkill }>(
      `/api/sentinela/skills/${skillId}/accept`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  rejectSentinelSkill: (skillId: string) =>
    request<{ ok: boolean; skill: SentinelSkill }>(
      `/api/sentinela/skills/${skillId}/reject`,
      { method: 'POST', body: '{}' },
    ),
}

export type { Entry, ProposalBundle, Person, Project, EntityProposalView }
