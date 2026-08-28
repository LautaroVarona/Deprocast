import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { api } from '../services/api'
import { downloadJson } from '../utils/downloadJson'
import {
  ChatJornadaCard,
  monthKeyFromDay,
  monthLabelFromKey,
} from './chats/ChatJornadaCard'
import { ChatVirtualList } from './chats/ChatVirtualList'
import {
  CHAT_ENTITY_KINDS,
  EntityChipPicker,
  isChipKind,
  type ChipKind,
  type EntityChip,
} from './chats/EntityChipPicker'
import type {
  ChatBlock,
  ChatBlockEntityView,
  ChatMessage,
  ChatPreview,
  ChatQueueStatus,
  ChatSession,
  ChatSpeakerMap,
  ChatTipo,
  Person,
  PersonKind,
  Project,
} from '../types'
import {
  matchPerson,
  normalizeConversationSpeakers,
  patchSpeaker,
  speakerIsAi,
  speakerMapsDiverge,
  speakersFromParticipants,
} from '../lib/chatSpeakersMap'
import {
  composeChatLinks,
  linksToTextarea,
} from '../../shared/chatUrls'

interface Props {
  refreshKey: number
  onChanged: () => void
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso.replace('T', ' ').slice(0, 16)
  }
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw) as unknown
    if (Array.isArray(p)) return p.map(String).filter(Boolean)
  } catch {
    /* ignore */
  }
  return []
}

function allSpeakersMapped(speakers: ChatSpeakerMap[]): boolean {
  return speakers.length > 0 && speakers.every((s) => Boolean(s.person_id))
}

function speakersHaveAi(speakers: ChatSpeakerMap[]): boolean {
  return speakers.some((s) => Boolean(s.is_ai))
}

const AI_MODELS = ['gpt-4o', 'gemini-1.5-pro', 'perplexity', 'claude'] as const

function chipsFromIds(
  ids: string[],
  kind: 'person' | 'project',
  persons: Person[],
  projects: Project[],
): EntityChip[] {
  if (kind === 'person') {
    return ids
      .map((id) => {
        const p = persons.find((x) => x.id === id)
        return p ? { id: p.id, name: p.name, kind: 'person' as const } : null
      })
      .filter((x): x is { id: string; name: string; kind: 'person' } =>
        Boolean(x),
      )
  }
  return ids
    .map((id) => {
      const p = projects.find((x) => x.id === id)
      return p
        ? { id: p.id, name: p.title, kind: 'project' as const }
        : null
    })
    .filter((x): x is { id: string; name: string; kind: 'project' } =>
      Boolean(x),
    )
}

function parseExtraEntityChips(raw: string | null | undefined): EntityChip[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: EntityChip[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const kind = String(o.kind ?? '')
      const id = String(o.id ?? o.entity_id ?? '').trim()
      const name = String(o.name ?? o.entity_name ?? '').trim()
      if (!id || !isChipKind(kind) || kind === 'person' || kind === 'project') {
        continue
      }
      const key = `${kind}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id, name: name || id, kind })
    }
    return out
  } catch {
    return []
  }
}

function mergeEntityChips(chips: EntityChip[]): EntityChip[] {
  const seen = new Set<string>()
  const out: EntityChip[] = []
  for (const chip of chips) {
    const key = `${chip.kind}:${chip.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(chip)
  }
  return out
}

function chipsFromBlock(
  block: ChatBlock,
  persons: Person[],
  projects: Project[],
): EntityChip[] {
  return mergeEntityChips([
    ...chipsFromIds(
      parseIds(block.linked_person_ids_json),
      'person',
      persons,
      projects,
    ),
    ...chipsFromIds(
      parseIds(block.linked_project_ids_json),
      'project',
      persons,
      projects,
    ),
    ...parseExtraEntityChips(block.linked_entities_json),
  ])
}

function splitBlockChips(chips: EntityChip[]): {
  person_ids: string[]
  project_ids: string[]
  entities: Array<{ kind: ChipKind; id: string; name: string }>
} {
  return {
    person_ids: chips.filter((c) => c.kind === 'person').map((c) => c.id),
    project_ids: chips.filter((c) => c.kind === 'project').map((c) => c.id),
    entities: chips
      .filter((c) => c.kind !== 'person' && c.kind !== 'project')
      .map((c) => ({ kind: c.kind, id: c.id, name: c.name })),
  }
}

function parseSummary(raw: string): {
  title?: string
  summary?: string
  quantomo?: string
} {
  try {
    return JSON.parse(raw || '{}') as {
      title?: string
      summary?: string
      quantomo?: string
    }
  } catch {
    return {}
  }
}

function WeightButtons({
  value,
  disabled,
  onPick,
  label,
}: {
  value: number | null
  disabled?: boolean
  onPick: (w: number) => void
  label: string
}) {
  return (
    <div className="chat-criba-vote">
      <span className="audio-criba-vote-label">{label}</span>
      <div className="audio-criba-weights" role="group" aria-label={label}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
          <button
            key={w}
            type="button"
            className={`btn btn-tiny audio-w${w <= 3 ? ' is-slop' : ''}${
              value === w ? ' is-on' : ''
            }`}
            disabled={disabled}
            onClick={() => onPick(w)}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChatsSection({ refreshKey, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [persons, setPersons] = useState<Person[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ChatPreview | null>(null)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<ChatTipo>('individual')
  const [previewSpeakers, setPreviewSpeakers] = useState<ChatSpeakerMap[]>([])
  const [previewPeople, setPreviewPeople] = useState<EntityChip[]>([])
  const [previewProjects, setPreviewProjects] = useState<EntityChip[]>([])
  const [previewPrimaryPerson, setPreviewPrimaryPerson] = useState<
    string | null
  >(null)
  const [previewPrimaryProject, setPreviewPrimaryProject] = useState<
    string | null
  >(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<ChatBlock[]>([])
  const [speakers, setSpeakers] = useState<ChatSpeakerMap[]>([])
  const [sessionPeople, setSessionPeople] = useState<EntityChip[]>([])
  const [sessionProjects, setSessionProjects] = useState<EntityChip[]>([])
  const [primaryPerson, setPrimaryPerson] = useState<string | null>(null)
  const [primaryProject, setPrimaryProject] = useState<string | null>(null)
  const [sessionWeight, setSessionWeight] = useState<number | null>(null)

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [blockMessages, setBlockMessages] = useState<ChatMessage[]>([])
  const [blockEntities, setBlockEntities] = useState<ChatBlockEntityView[]>([])
  const [blockChips, setBlockChips] = useState<EntityChip[]>([])
  const [blockWeight, setBlockWeight] = useState<number | null>(null)
  const [blockNotes, setBlockNotes] = useState('')
  const [blockLinks, setBlockLinks] = useState('')
  const [sessionQuery, setSessionQuery] = useState('')
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const [showNav, setShowNav] = useState(true)
  const [showMeta, setShowMeta] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [cribaOpen, setCribaOpen] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('')
  const [queueStatus, setQueueStatus] = useState<ChatQueueStatus | null>(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speakerQuery, setSpeakerQuery] = useState<Record<string, string>>({})

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.listChats()
      setSessions(data.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al listar chats')
    }
  }, [])

  const loadRoster = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([
        api.listPersons(),
        api.listProjects(),
      ])
      setPersons(p.persons ?? p.profiles ?? [])
      setProjects(pr.projects ?? pr.profiles ?? [])
    } catch {
      /* roster optional at boot */
    }
  }, [])

  useEffect(() => {
    void loadSessions()
    void loadRoster()
  }, [loadSessions, loadRoster, refreshKey])

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const data = await api.getChat(id)
        setSelectedId(id)
        setBlocks(data.blocks)
        setSessionTitle(data.session.nombre_chat)
        setCribaOpen(false)
        const raw = data.speakers?.length
          ? data.speakers
          : speakersFromParticipants(
              parseIds(data.session.participantes_json),
              persons,
            )
        const s = normalizeConversationSpeakers(raw, persons)
        setSpeakers(s)
        if (persons.length > 0 && speakerMapsDiverge(raw, s)) {
          void api.patchChat(id, { speaker_map: s })
        }
        const speakerIds = s.map((x) => x.person_id).filter(Boolean) as string[]
        const extraPeople = parseIds(data.session.linked_person_ids_json).filter(
          (pid) => !speakerIds.includes(pid),
        )
        setSessionPeople(chipsFromIds(extraPeople, 'person', persons, projects))
        setSessionProjects(
          chipsFromIds(
            parseIds(data.session.linked_project_ids_json).filter(
              (pid) => pid !== (data.session.primary_project_id ?? ''),
            ),
            'project',
            persons,
            projects,
          ),
        )
        setPrimaryPerson(data.session.primary_person_id ?? null)
        setPrimaryProject(data.session.primary_project_id ?? null)
        setSessionWeight(
          data.session.human_weight ?? (speakersHaveAi(s) ? 4 : null),
        )
        const pick =
          data.blocks.find((b) => b.estado === 'pendiente') ??
          data.blocks[0] ??
          null
        if (!pick) {
          setSelectedBlockId(null)
          setBlockMessages([])
          setBlockEntities([])
          setBlockChips([])
          return
        }
        const blockData = await api.getChatBlock(id, pick.id)
        setSelectedBlockId(pick.id)
        setBlockMessages(blockData.messages)
        setBlockEntities(blockData.entities)
        setBlockChips(
          chipsFromBlock(blockData.block, persons, projects),
        )
        setBlockWeight(
          blockData.block.human_weight ?? (speakersHaveAi(s) ? 4 : null),
        )
        setBlockNotes(blockData.block.notes ?? '')
        setBlockLinks(
          linksToTextarea(
            composeChatLinks(
              blockData.messages,
              parseIds(blockData.block.links_json),
            ),
          ),
        )
        setSpeakersOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar chat')
      }
    },
    [persons, projects],
  )

  const loadBlock = useCallback(
    async (sessionId: string, blockId: string) => {
      try {
        const data = await api.getChatBlock(sessionId, blockId)
        setSelectedBlockId(blockId)
        setBlockMessages(data.messages)
        setBlockEntities(data.entities)
        setBlockChips(chipsFromBlock(data.block, persons, projects))
        setBlockWeight(
          data.block.human_weight ?? (speakersHaveAi(speakers) ? 4 : null),
        )
        setBlockNotes(data.block.notes ?? '')
        setBlockLinks(
          linksToTextarea(
            composeChatLinks(
              data.messages,
              parseIds(data.block.links_json),
            ),
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar día')
      }
    },
    [persons, projects, speakers],
  )

  const refreshQueue = useCallback(async () => {
    try {
      const st = await api.getChatProcessStatus()
      setQueueStatus(st)
      return st
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue, refreshKey])

  useEffect(() => {
    if (!queueStatus?.running) return
    const t = window.setInterval(() => {
      void (async () => {
        const st = await refreshQueue()
        if (st && !st.running) {
          await loadSessions()
          if (selectedId) await loadDetail(selectedId)
          setStatus(
            st.skipped > 0
              ? `Destilado: ${st.done} al corpus, ${st.skipped} omitidos`
              : `Listo: ${st.done} chat(s) en el corpus`,
          )
          onChanged()
        }
      })()
    }, 1500)
    return () => window.clearInterval(t)
  }, [
    queueStatus?.running,
    refreshQueue,
    selectedId,
    loadSessions,
    loadDetail,
    onChanged,
  ])

  function resetImportDraft() {
    setFile(null)
    setPreview(null)
    setPreviewSpeakers([])
    setPreviewPeople([])
    setPreviewProjects([])
    setPreviewPrimaryPerson(null)
    setPreviewPrimaryProject(null)
    setNombre('')
    setTipo('individual')
    setDropActive(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function closeNewChat() {
    setNewChatOpen(false)
    resetImportDraft()
  }

  async function onPick(files: FileList | null) {
    if (!files?.[0]) return
    const f = files[0]
    setNewChatOpen(true)
    setFile(f)
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const data = await api.previewChat(f)
      setPreview(data.preview)
      setNombre(data.preview.suggested_name)
      setTipo(data.preview.tipo_auto)
      const mapped = speakersFromParticipants(
        data.preview.participantes,
        persons,
      )
      setPreviewSpeakers(mapped)
      const primary =
        mapped.find((s) => {
          const p = persons.find((x) => x.id === s.person_id)
          return p && !p.is_operator
        })?.person_id ??
        mapped.find((s) => s.person_id)?.person_id ??
        null
      setPreviewPrimaryPerson(primary)
      setPreviewPeople([])
      setPreviewProjects([])
      setPreviewPrimaryProject(null)
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Error en preview')
    } finally {
      setBusy(false)
    }
  }

  function onDragOverDrop(e: DragEvent) {
    e.preventDefault()
    setDropActive(true)
  }

  function onDragLeaveDrop(e: DragEvent) {
    e.preventDefault()
    setDropActive(false)
  }

  function onDropFile(e: DragEvent) {
    e.preventDefault()
    setDropActive(false)
    void onPick(e.dataTransfer.files)
  }

  useEffect(() => {
    if (!preview || persons.length === 0) return
    setPreviewSpeakers((prev) => {
      if (prev.some((s) => s.person_id)) return prev
      return speakersFromParticipants(preview.participantes, persons, prev)
    })
  }, [preview, persons])

  async function persistSessionSpeakers(next: ChatSpeakerMap[]) {
    if (!selectedId) return
    setSpeakers(next)
    try {
      await api.patchChat(selectedId, {
        speaker_map: next,
        primary_person_id: primaryPerson,
        primary_project_id: primaryProject,
        person_ids: sessionPeople.map((c) => c.id),
        project_ids: [
          ...(primaryProject ? [primaryProject] : []),
          ...sessionProjects.map((c) => c.id),
        ],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar habladores')
    }
  }

  async function handleImport() {
    if (!file) return
    if (!allSpeakersMapped(previewSpeakers)) {
      setError('Asigná todos los habladores a un perfil antes de importar.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.importChat({
        file,
        nombre_chat: nombre.trim() || undefined,
        tipo,
        speaker_map: previewSpeakers,
        person_ids: previewPeople.map((c) => c.id),
        project_ids: previewProjects.map((c) => c.id),
        primary_person_id: previewPrimaryPerson,
        primary_project_id: previewPrimaryProject,
      })
      setStatus(
        `Importado «${result.session.nombre_chat}»: ${result.message_count} msgs · ${result.block_count} jornadas · ${result.link_count} links`,
      )
      setNewChatOpen(false)
      resetImportDraft()
      setSpeakerQuery({})
      await loadSessions()
      await loadDetail(result.session.id)
      setShowNav(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar')
    } finally {
      setBusy(false)
    }
  }

  async function persistConversation(weight?: number | null) {
    if (!selectedId) return
    const w = weight === undefined ? sessionWeight : weight
    await api.patchChat(selectedId, {
      speaker_map: speakers,
      primary_person_id: primaryPerson,
      primary_project_id: primaryProject,
      person_ids: sessionPeople.map((c) => c.id),
      project_ids: [
        ...(primaryProject ? [primaryProject] : []),
        ...sessionProjects.map((c) => c.id),
      ],
      human_weight: w,
    })
    if (weight !== undefined) setSessionWeight(weight)
  }

  async function startDestill(blockId?: string) {
    if (!selectedId) return
    if (!allSpeakersMapped(speakers)) {
      setSpeakersOpen(true)
      setError(
        'Asigná los hablantes de la conversación. Van a todos los quántomos.',
      )
      return
    }
    await persistConversation()
    const result = await api.startChatProcess(selectedId, blockId)
    setQueueStatus({ ...result, running: result.queued > 0 || result.running })
    setStatus(result.message)
    if (result.queued === 0 && !result.running) {
      setError(result.message)
    } else {
      setError(null)
    }
    onChanged()
  }

  async function handleExport(scope: 'one' | 'all') {
    setBusy(true)
    setError(null)
    try {
      if (scope === 'one' && !selectedId) {
        setError('Elegí una conversación para exportar.')
        return
      }
      const payload = await api.exportChats(
        scope === 'one' ? selectedId! : undefined,
      )
      const day = new Date().toISOString().slice(0, 10)
      const nombre =
        sessions.find((s) => s.id === selectedId)?.nombre_chat || 'conversacion'
      const slug =
        scope === 'one'
          ? nombre
              .toLowerCase()
              .replace(/[^a-z0-9]+/gi, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 40)
          : 'todas'
      downloadJson(`deprocast-chats-${slug}-${day}.json`, payload)
      setStatus(
        `Exportadas ${payload.count} conversación${payload.count === 1 ? '' : 'es'}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al exportar')
    } finally {
      setBusy(false)
    }
  }

  async function voteConversation(weight: number) {
    if (!selectedId || busy) return
    setBusy(true)
    setError(null)
    try {
      await persistConversation(weight)
      const result = await api.startChatProcess(selectedId)
      setQueueStatus({ ...result, running: result.queued > 0 || result.running })
      setStatus(
        result.queued
          ? `Conversación votada ${weight} · ${result.message}`
          : `Conversación votada ${weight}. Cribá cada chat o destilá cuando haya votos.`,
      )
      await loadSessions()
      onChanged()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al votar la conversación',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleProcessDay(sessionId: string, blockId: string) {
    if (!allSpeakersMapped(speakers)) {
      setSpeakersOpen(true)
      setError(
        'Asigná los hablantes de la conversación. Van a todos los quántomos.',
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      await persistConversation()
      await api.patchChatBlock(sessionId, blockId, {
        ...splitBlockChips(blockChips),
        human_weight: blockWeight,
        notes: blockNotes,
        links: blockLinks
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      const result = await api.startChatProcess(sessionId, blockId)
      setQueueStatus({ ...result, running: result.queued > 0 || result.running })
      setStatus(result.message)
      if (result.errors?.length) {
        setError(result.errors.map((e) => e.error).join(' · '))
      }
      await loadSessions()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreatePerson(
    name: string,
    kind: PersonKind = 'fisica',
  ): Promise<Person | null> {
    try {
      const res = await api.createPerson({ name, kind })
      await loadRoster()
      return res.person
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear persona')
      return null
    }
  }

  async function handleCreateProject(name: string): Promise<Project | null> {
    try {
      const res = await api.createProject({ title: name, category: 'proyecto' })
      await loadRoster()
      return res.project
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear proyecto')
      return null
    }
  }

  async function assignSpeaker(
    remitente: string,
    person: Person | null,
    target: 'preview' | 'session',
  ) {
    const nextMap = (prev: ChatSpeakerMap[]) =>
      patchSpeaker(prev, remitente, person)
    if (person?.kind === 'ia') {
      if (target === 'session' && sessionWeight == null) setSessionWeight(4)
      if (blockWeight == null) setBlockWeight(4)
    }
    if (target === 'preview') {
      setPreviewSpeakers(nextMap)
      return
    }
    const next = nextMap(speakers)
    await persistSessionSpeakers(next)
  }

  async function assignSpeakerAsAi(
    remitente: string,
    target: 'preview' | 'session',
    nameOverride?: string,
  ) {
    const q = (nameOverride ?? speakerQuery[remitente] ?? '').trim()
    const name = q || remitente
    const existing = persons.find(
      (p) =>
        p.kind === 'ia' &&
        (p.name ?? '').toLowerCase() === name.toLowerCase() &&
        (p.source === 'manual' || !p.merged_into),
    )
    const person = existing ?? (await handleCreatePerson(name, 'ia'))
    if (!person) return
    await assignSpeaker(remitente, person, target)
    setSpeakerQuery((prev) => ({ ...prev, [remitente]: '' }))
  }

  async function saveSessionMeta() {
    if (!selectedId) return
    setBusy(true)
    try {
      await api.patchChat(selectedId, {
        speaker_map: speakers,
        primary_person_id: primaryPerson,
        primary_project_id: primaryProject,
        person_ids: sessionPeople.map((c) => c.id),
        project_ids: [
          ...(primaryProject ? [primaryProject] : []),
          ...sessionProjects.map((c) => c.id),
        ],
        human_weight: sessionWeight,
      })
      setStatus('Conversación guardada')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  function clearConversationView() {
    setSelectedId(null)
    setBlocks([])
    setSpeakers([])
    setSessionPeople([])
    setSessionProjects([])
    setPrimaryPerson(null)
    setPrimaryProject(null)
    setSessionWeight(null)
    setSelectedBlockId(null)
    setBlockMessages([])
    setBlockEntities([])
    setBlockChips([])
    setBlockWeight(null)
    setBlockNotes('')
    setBlockLinks('')
    setSpeakersOpen(false)
    setCribaOpen(false)
    setSessionTitle('')
    setShowMeta(false)
    setShowNav(true)
  }

  async function handleDeleteConversation(session: ChatSession) {
    const ok = window.confirm(
      `¿Borrar «${session.nombre_chat}»?\nSe elimina la importación, el export del vault y los quántomos destilados de esta conversación.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.deleteChat(session.id)
      if (selectedId === session.id) clearConversationView()
      await loadSessions()
      setStatus(
        `Borrada «${session.nombre_chat}» · ${result.deleted_blocks} chat(s) · ${result.deleted_entries} destilado(s)`,
      )
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al borrar')
    } finally {
      setBusy(false)
    }
  }

  async function saveBlockMeta() {
    if (!selectedId || !selectedBlockId) return
    setBusy(true)
    try {
      await api.patchChatBlock(selectedId, selectedBlockId, {
        ...splitBlockChips(blockChips),
        human_weight: blockWeight,
        notes: blockNotes,
        links: blockLinks
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setStatus('Chat guardado')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el día')
    } finally {
      setBusy(false)
    }
  }

  async function saveSessionTitle() {
    if (!selectedId) return
    const next = sessionTitle.trim()
    if (!next || next === selected?.nombre_chat) {
      setSessionTitle(selected?.nombre_chat ?? sessionTitle)
      return
    }
    try {
      await api.patchChat(selectedId, { nombre_chat: next })
      setSessions((prev) =>
        prev.map((s) =>
          s.id === selectedId ? { ...s, nombre_chat: next } : s,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al renombrar')
    }
  }

  async function openCriba() {
    if (!selectedId) return
    const pending = blocks.filter((b) => b.estado === 'pendiente')
    const start =
      pending.find((b) => b.id === selectedBlockId) ??
      pending.find((b) => b.human_weight == null) ??
      pending[0] ??
      selectedBlock
    if (!start) {
      setError('No hay chats pendientes para cribar.')
      return
    }
    if (start.id !== selectedBlockId) await loadBlock(selectedId, start.id)
    setCribaOpen(true)
  }

  async function voteCriba(weight: number) {
    if (!selectedId || !selectedBlockId || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.patchChatBlock(selectedId, selectedBlockId, {
        ...splitBlockChips(blockChips),
        human_weight: weight,
        notes: blockNotes,
        links: blockLinks
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setBlockWeight(weight)
      const after = blocks.map((b) =>
        b.id === selectedBlockId ? { ...b, human_weight: weight } : b,
      )
      setBlocks(after)
      const idx = after.findIndex((b) => b.id === selectedBlockId)
      const rest = [...after.slice(idx + 1), ...after.slice(0, idx)]
      const next =
        rest.find((b) => b.estado === 'pendiente' && b.human_weight == null) ??
        rest.find((b) => b.estado === 'pendiente') ??
        null
      if (!next) {
        setCribaOpen(false)
        await persistConversation()
        const destil = await api.startChatProcess(selectedId)
        setQueueStatus({
          ...destil,
          running: destil.queued > 0 || destil.running,
        })
        setStatus(
          destil.queued
            ? `Criba completa · ${destil.message}`
            : 'Criba completa',
        )
        await loadSessions()
        onChanged()
        return
      }
      await loadBlock(selectedId, next.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al votar')
    } finally {
      setBusy(false)
    }
  }

  async function handleEntityAction(
    entity: ChatBlockEntityView,
    action: 'link' | 'create' | 'reject',
    entityId?: string,
  ) {
    if (!selectedId || !selectedBlockId) return
    const type = entity.type === 'project' ? 'project' : 'person'
    setBusy(true)
    try {
      await api.assignChatEntity(selectedId, selectedBlockId, {
        name: entity.name,
        type,
        action,
        entity_id: entityId,
        create_name: action === 'create' ? entity.name : undefined,
      })
      await loadRoster()
      await loadBlock(selectedId, selectedBlockId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al asignar entidad')
    } finally {
      setBusy(false)
    }
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? null
  const selectedBlock =
    blocks.find((b) => b.id === selectedBlockId) ?? null
  const previewMapped = allSpeakersMapped(previewSpeakers)
  const previewUnmapped = previewSpeakers.filter((s) => !s.person_id).length
  const sessionMapped = allSpeakersMapped(speakers)
  const sessionHasAi = speakersHaveAi(speakers)
  const cribaPending = blocks.filter(
    (b) =>
      (b.estado === 'pendiente' || b.estado === 'error') && !b.entry_id,
  )
  const cribaDone = cribaPending.filter((b) => b.human_weight != null).length
  const blockLinkRows = useMemo(
    () =>
      blockLinks
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [blockLinks],
  )
  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => s.nombre_chat.toLowerCase().includes(q))
  }, [sessions, sessionQuery])
  const jornadaGroups = useMemo(() => {
    const groups: { key: string; label: string; items: ChatBlock[] }[] = []
    let current: { key: string; label: string; items: ChatBlock[] } | null =
      null
    for (const b of blocks) {
      const key = monthKeyFromDay(b.day_key)
      if (!current || current.key !== key) {
        current = { key, label: monthLabelFromKey(key), items: [] }
        groups.push(current)
      }
      current.items.push(b)
    }
    return groups
  }, [blocks])

  const speakerSearchHits = useMemo(() => {
    const q = Object.values(speakerQuery)[0]
    void q
    return persons.filter((p) => p.source === 'manual' || !p.merged_into)
  }, [persons, speakerQuery])

  function renderHabladores(
    list: ChatSpeakerMap[],
    target: 'preview' | 'session',
  ) {
    return (
      <div className="chat-speakers">
        <p className="mono">Quiénes hablan</p>
        {list.length === 0 ? (
          <p className="muted">Sin remitentes.</p>
        ) : (
          <ul className="chat-speaker-list">
            {list.map((s) => {
              const q = speakerQuery[s.remitente] ?? ''
              const hits = q.trim()
                ? speakerSearchHits
                    .filter((p) => {
                      const name = (p.name ?? '').toLowerCase()
                      if (!name.includes(q.trim().toLowerCase())) return false
                      return s.is_ai ? p.kind === 'ia' : p.kind !== 'ia'
                    })
                    .slice(0, 8)
                : []
              return (
                <li
                  key={s.remitente}
                  className={`chat-speaker-row${s.person_id ? '' : ' is-pending'}`}
                >
                  <div className="chat-speaker-who">
                    <strong>{s.remitente}</strong>
                    <span
                      className={`muted${s.person_id ? '' : ' chat-warn'}`}
                    >
                      {s.person_name
                        ? s.is_ai
                          ? `IA · ${s.person_name}`
                          : s.person_name
                        : 'sin perfil'}
                    </span>
                  </div>
                  <div className="chat-speaker-assign">
                    <input
                      placeholder="Buscar perfil…"
                      value={q}
                      disabled={busy}
                      onChange={(e) =>
                        setSpeakerQuery((prev) => ({
                          ...prev,
                          [s.remitente]: e.target.value,
                        }))
                      }
                    />
                    <label className="chat-ia-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(s.is_ai)}
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.checked) {
                            void assignSpeakerAsAi(s.remitente, target)
                            return
                          }
                          const person = persons.find(
                            (p) => p.id === s.person_id,
                          )
                          if (person && person.kind !== 'ia') {
                            void assignSpeaker(s.remitente, person, target)
                            return
                          }
                          void assignSpeaker(
                            s.remitente,
                            matchPerson(s.remitente, persons) ?? null,
                            target,
                          )
                        }}
                      />
                      IA
                    </label>
                    <div className="chat-speaker-hits">
                      {hits.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={
                            s.person_id === p.id
                              ? 'filter-chip is-active'
                              : 'filter-chip'
                          }
                          disabled={busy}
                          onClick={() => {
                            void assignSpeaker(s.remitente, p, target)
                            setSpeakerQuery((prev) => ({
                              ...prev,
                              [s.remitente]: '',
                            }))
                          }}
                        >
                          {p.name}
                          {p.kind === 'ia' ? ' · IA' : ''}
                          {p.is_operator ? ' · yo' : ''}
                        </button>
                      ))}
                      {s.is_ai &&
                        AI_MODELS.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={
                              s.model === m || s.person_name === m
                                ? 'filter-chip is-active'
                                : 'filter-chip'
                            }
                            disabled={busy}
                            onClick={() => {
                              void assignSpeakerAsAi(s.remitente, target, m)
                            }}
                          >
                            {m}
                          </button>
                        ))}
                      {q.trim() &&
                        !persons.some(
                          (p) =>
                            (p.name ?? '').toLowerCase() ===
                            q.trim().toLowerCase(),
                        ) && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={busy}
                            onClick={() => {
                              void handleCreatePerson(q.trim()).then((p) => {
                                if (p)
                                  void assignSpeaker(s.remitente, p, target)
                                setSpeakerQuery((prev) => ({
                                  ...prev,
                                  [s.remitente]: '',
                                }))
                              })
                            }}
                          >
                            Crear «{q.trim()}»
                          </button>
                        )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="entity-stage quantomos-stage chat-stage-wrap">
      <section className="panel entity-panel chat-panel">
        <div className="panel-head entity-head">
          <div>
            <h2>Chats</h2>
            <p className="muted mono">
              Conversación (hablantes) → chats (voto, entidades, notas) → corpus
            </p>
          </div>
          <div className="entity-head-actions">
            <button
              type="button"
              className={newChatOpen ? 'btn is-on' : 'btn btn-primary'}
              aria-pressed={newChatOpen}
              disabled={busy}
              onClick={() => {
                if (newChatOpen && !preview) {
                  closeNewChat()
                  return
                }
                setError(null)
                setNewChatOpen(true)
              }}
            >
              Nuevo chat
            </button>
            <button
              type="button"
              className={`btn btn-tiny${showNav ? ' is-on' : ''}`}
              aria-pressed={showNav}
              onClick={() => setShowNav((v) => !v)}
            >
              {showNav ? 'Ocultar conversaciones' : 'Conversaciones'}
            </button>
            <button
              type="button"
              className={`btn btn-tiny${showMeta ? ' is-on' : ''}`}
              aria-pressed={showMeta}
              disabled={!selectedId}
              onClick={() => setShowMeta((v) => !v)}
            >
              {showMeta ? 'Ocultar este chat' : 'Este chat'}
            </button>
            <button
              type="button"
              className="btn btn-tiny"
              disabled={busy}
              onClick={() => void loadSessions()}
            >
              Recargar
            </button>
            <button
              type="button"
              className="btn btn-tiny"
              disabled={busy || !selectedId}
              onClick={() => void handleExport('one')}
            >
              Exportar JSON
            </button>
            <button
              type="button"
              className="btn btn-tiny"
              disabled={busy || sessions.length === 0}
              onClick={() => void handleExport('all')}
            >
              Exportar todas
            </button>
          </div>
        </div>

        <input
          ref={inputRef}
          className="chat-file-hidden"
          type="file"
          accept=".txt,text/plain"
          disabled={busy}
          onChange={(e) => void onPick(e.target.files)}
        />

        {newChatOpen && !preview && (
          <div
            className={
              dropActive ? 'chat-new-drop is-active' : 'chat-new-drop'
            }
            onDragOver={onDragOverDrop}
            onDragLeave={onDragLeaveDrop}
            onDrop={onDropFile}
          >
            <div>
              <p className="chat-new-drop-title">Export de WhatsApp</p>
              <p className="muted">
                Arrastrá el .txt o elegí el archivo. Después asignás hablantes
                y anclas, y recién ahí se importa.
              </p>
            </div>
            <div className="chat-new-drop-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? 'Leyendo…' : 'Elegir archivo'}
              </button>
              <button
                type="button"
                className="btn btn-tiny"
                disabled={busy}
                onClick={closeNewChat}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {status && <p className="muted mono">{status}</p>}
        {queueStatus?.running && (
          <p className="muted mono">
            Destilando {queueStatus.done}/{queueStatus.target}
            {queueStatus.current_title
              ? ` · ${queueStatus.current_title}`
              : ''}
          </p>
        )}
        {!queueStatus?.running &&
          (queueStatus?.skipped ?? 0) > 0 &&
          queueStatus?.errors?.[0] && (
            <p className="error-text">
              Destilado: {queueStatus.done} hechos, {queueStatus.skipped}{' '}
              omitidos · {queueStatus.errors[0].error}
            </p>
          )}

        <div
          className={[
            'chat-stage transition-all duration-300',
            showNav ? '' : 'is-nav-off',
            showMeta ? '' : 'is-meta-off',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            className="chat-col chat-col-master"
            aria-hidden={!showNav}
            inert={showNav ? undefined : true}
          >
            <div className="chat-col-head">
              <h3>Conversaciones</h3>
              <button
                type="button"
                className="btn btn-tiny chat-col-toggle"
                aria-label="Ocultar conversaciones"
                onClick={() => setShowNav(false)}
              >
                «
              </button>
            </div>
            {sessions.length > 0 && (
              <label className="field">
                <span className="mono">Filtrar</span>
                <input
                  value={sessionQuery}
                  onChange={(e) => setSessionQuery(e.target.value)}
                  placeholder="Nombre de la conversación…"
                />
              </label>
            )}
            {filteredSessions.length === 0 ? (
                  <p className="muted">Ninguna conversación importada aún.</p>
            ) : (
              <ChatVirtualList
                items={filteredSessions}
                estimate={76}
                className="chat-col-scroll chat-session-list"
                renderItem={(s) => (
                  <div key={s.id} className="chat-session-row">
                    <button
                      type="button"
                      className={
                        selectedId === s.id
                          ? 'chat-session-card is-selected'
                          : 'chat-session-card'
                      }
                      onClick={() => {
                        setShowNav(false)
                        void loadDetail(s.id)
                      }}
                    >
                      <strong>{s.nombre_chat}</strong>
                      <span className="chat-session-meta">
                        {s.tipo} · {s.status} · {s.block_count ?? 0} j. ·{' '}
                        {s.pending_blocks ?? 0} pend.
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-tiny danger-text chat-session-delete"
                      disabled={busy}
                      title="Borrar conversación"
                      aria-label={`Borrar ${s.nombre_chat}`}
                      onClick={() => void handleDeleteConversation(s)}
                    >
                      Borrar
                    </button>
                  </div>
                )}
              />
            )}
          </div>

          <div className="chat-col chat-col-main">
            {selected ? (
              <>
                <div className="chat-thread-head">
                  <div>
                    <input
                      className="chat-thread-title"
                      value={sessionTitle}
                      disabled={busy}
                      aria-label="Nombre de la conversación"
                      onChange={(e) => setSessionTitle(e.target.value)}
                      onBlur={() => void saveSessionTitle()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur()
                        }
                      }}
                    />
                    <p className="muted">
                      {speakers
                        .map((s) => s.person_name || s.remitente)
                        .join(' · ') || 'Sin hablantes'}
                      {cribaPending.some((b) => b.human_weight != null) &&
                      cribaPending.length > 0
                        ? ' · hay chats cribados listos para destilar'
                        : ''}
                    </p>
                  </div>
                  <div className="chat-thread-head-actions">
                    {!showNav && (
                      <button
                        type="button"
                        className="btn btn-tiny"
                        onClick={() => setShowNav(true)}
                      >
                        Conversaciones
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-tiny"
                      onClick={() => {
                        setSpeakerQuery({})
                        setSpeakersOpen(true)
                      }}
                    >
                      Hablantes
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !selectedBlock}
                      onClick={() => void openCriba()}
                    >
                      Cribar
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        busy ||
                        !sessionMapped ||
                        Boolean(queueStatus?.running)
                      }
                      onClick={() => void startDestill()}
                    >
                      Destilar con LLM
                    </button>
                    <button
                      type="button"
                      className={`btn btn-tiny${showMeta ? ' is-on' : ''}`}
                      aria-pressed={showMeta}
                      onClick={() => setShowMeta((v) => !v)}
                    >
                      {showMeta ? 'Ocultar este chat' : 'Este chat'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-tiny danger-text"
                      disabled={busy}
                      onClick={() => void handleDeleteConversation(selected)}
                    >
                      Borrar
                    </button>
                  </div>
                </div>
                <div className="chat-main-split">
                  <div className="chat-chats-rail">
                    <p className="chat-rail-label">Chats</p>
                    {jornadaGroups.length === 0 ? (
                      <p className="muted">Sin cortes aún.</p>
                    ) : (
                      jornadaGroups.map((g) => (
                        <div key={g.key} className="chat-month">
                          <p className="chat-month-label">{g.label}</p>
                          {g.items.map((b) => (
                            <ChatJornadaCard
                              key={b.id}
                              compact
                              block={b}
                              selected={selectedBlockId === b.id}
                              speakers={speakers}
                              onSelect={() =>
                                void loadBlock(selected.id, b.id)
                              }
                            />
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="chat-thread">
                    {selectedBlock ? (
                      <ChatVirtualList
                        items={blockMessages}
                        estimate={96}
                        className="chat-col-scroll chat-thread-scroll"
                        renderItem={(m) => {
                          const ia = speakerIsAi(m.remitente, speakers)
                          const hit = speakers.find(
                            (sp) => sp.remitente === (m.remitente ?? ''),
                          )
                          return (
                            <article
                              key={m.id}
                              className={
                                ia ? 'chat-bubble is-ai' : 'chat-bubble'
                              }
                            >
                              <header className="chat-bubble-meta">
                                {formatTs(m.timestamp_exact)} ·{' '}
                                {hit?.person_name ||
                                  m.remitente ||
                                  'Sistema'}
                                {ia ? ' · IA' : ''}
                              </header>
                              <p className="chat-bubble-body">
                                {m.texto_crudo}
                              </p>
                            </article>
                          )
                        }}
                      />
                    ) : (
                      <p className="muted chat-col-pad">
                        Elegí un chat a la izquierda del hilo.
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="muted chat-col-pad">
                Elegí una conversación. El hilo ocupa el centro; cada chat se
                valida a la derecha.
              </p>
            )}
          </div>

          <div
            className="chat-col chat-col-meta"
            aria-hidden={!showMeta}
            inert={showMeta ? undefined : true}
          >
            {selected ? (
              <>
                <div className="chat-col-head">
                  <h3>Este chat</h3>
                  <button
                    type="button"
                    className="btn btn-tiny chat-col-toggle"
                    aria-label="Ocultar este chat"
                    onClick={() => setShowMeta(false)}
                  >
                    »
                  </button>
                </div>
              <div className="chat-col-scroll chat-col-pad">
                {!sessionMapped && (
                  <p className="error-text">
                    Faltan hablantes de la conversación.{' '}
                    <button
                      type="button"
                      className="btn btn-tiny"
                      onClick={() => setSpeakersOpen(true)}
                    >
                      Asignar
                    </button>
                  </p>
                )}

                <div className="chat-day">
                  <p className="mono">Conversación</p>
                  <p className="muted">
                    El voto de la conversación pondera cada chat y genera un
                    _todo_ al destilar.
                  </p>
                  <WeightButtons
                    label="Peso de la conversación"
                    value={sessionWeight}
                    disabled={busy}
                    onPick={(w) => void voteConversation(w)}
                  />
                </div>

                {selectedBlock ? (
                  <div className="chat-day">
                    <div className="panel-head entity-head">
                      {selectedBlock.estado === 'pendiente' && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !sessionMapped}
                          onClick={() =>
                            void handleProcessDay(selected.id, selectedBlock.id)
                          }
                        >
                          Validar al corpus
                        </button>
                      )}
                      {selectedBlock.estado === 'pendiente' &&
                        cribaPending.filter((b) => b.human_weight != null)
                          .length > 1 && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={
                              busy ||
                              !sessionMapped ||
                              Boolean(queueStatus?.running)
                            }
                            onClick={() => void startDestill()}
                          >
                            Destilar cribados con LLM
                          </button>
                        )}
                    </div>
                    <p className="muted">
                      Links ya extraídos del hilo. Anclá entidades, anotá, fijá
                      el peso y validá.
                    </p>
                    <label className="field">
                      <span>Entidades</span>
                      <EntityChipPicker
                        kinds={CHAT_ENTITY_KINDS}
                        selected={blockChips}
                        onChange={setBlockChips}
                        disabled={busy}
                        placeholder="Persona, proyecto, dominio…"
                      />
                    </label>
                    <label className="field">
                      <span className="mono">Notas</span>
                      <textarea
                        value={blockNotes}
                        onChange={(e) => setBlockNotes(e.target.value)}
                        rows={3}
                        disabled={busy}
                        placeholder="Anotaciones de este chat…"
                      />
                    </label>
                    <div className="field">
                      <span className="mono">Links</span>
                      {blockLinkRows.length === 0 ? (
                        <p className="muted">
                          El lector no encontró URLs en este chat.
                        </p>
                      ) : (
                        <ul className="chat-link-list">
                          {blockLinkRows.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      <textarea
                        value={blockLinks}
                        onChange={(e) => setBlockLinks(e.target.value)}
                        rows={Math.min(6, Math.max(3, blockLinkRows.length + 1))}
                        disabled={busy}
                        placeholder="Extraídos del hilo · uno por línea"
                      />
                    </div>
                    <WeightButtons
                      label="Peso de este chat"
                      value={blockWeight}
                      disabled={busy}
                      onPick={setBlockWeight}
                    />
                    {sessionHasAi && (
                      <p className="muted chat-ai-hint">
                        Hay un hablante IA en la conversación: el voto arranca
                        más bajo. El de este chat pesa más al destilar.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={busy}
                      onClick={() => void saveBlockMeta()}
                    >
                      Guardar este chat
                    </button>

                    {selectedBlock.estado === 'analizado' && (
                      <div className="chat-day-result">
                        {(() => {
                          const summary = parseSummary(
                            selectedBlock.summary_json,
                          )
                          return (
                            <>
                              {summary.title ? <h4>{summary.title}</h4> : null}
                              {summary.summary ? (
                                <p>{summary.summary}</p>
                              ) : null}
                              {summary.quantomo ? (
                                <p className="chat-quantomo">
                                  <span className="mono">Quántomo</span>{' '}
                                  {summary.quantomo}
                                </p>
                              ) : null}
                            </>
                          )
                        })()}
                        <p className="mono">Entidades (ENR)</p>
                        {blockEntities.length === 0 ? (
                          <p className="muted">Sin entidades en este día.</p>
                        ) : (
                          <ul className="chat-entity-list">
                            {blockEntities.map((e) => (
                              <li
                                key={`${e.type}:${e.name}`}
                                className="chat-entity-row"
                              >
                                <div>
                                  <strong>{e.name}</strong>
                                  <span className="muted mono">
                                    {e.type}
                                    {e.assigned_name
                                      ? ` → ${e.assigned_name}`
                                      : e.suggested_match_name
                                        ? ` · sugerido ${e.suggested_match_name}`
                                        : ''}
                                  </span>
                                </div>
                                {!e.assigned_id && (
                                  <div className="chat-entity-actions">
                                    {e.suggested_match_id && (
                                      <button
                                        type="button"
                                        className="btn btn-tiny"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleEntityAction(
                                            e,
                                            'link',
                                            e.suggested_match_id!,
                                          )
                                        }
                                      >
                                        Vincular sugerido
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-tiny"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleEntityAction(e, 'create')
                                      }
                                    >
                                      Crear perfil
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-tiny"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleEntityAction(e, 'reject')
                                      }
                                    >
                                      Descartar
                                    </button>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted">Elegí un chat del listado.</p>
                )}
              </div>
              </>
            ) : (
              <p className="muted chat-col-pad">
                Elegí una conversación para validar cada chat.
              </p>
            )}
          </div>
        </div>

        {newChatOpen &&
          preview &&
          createPortal(
          <div
            className="chat-import-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Importar conversación"
          >
            <div className="chat-import-card">
              <header className="chat-import-head">
                <div className="chat-import-title-block">
                  <p className="chat-import-kicker">Nueva conversación</p>
                  <input
                    className="chat-import-title"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    disabled={busy}
                    aria-label="Nombre de la conversación"
                  />
                  <p className="muted">
                    {preview.message_count} mensajes · {preview.link_count}{' '}
                    links · {formatTs(preview.first_ts)} →{' '}
                    {formatTs(preview.last_ts)}
                  </p>
                </div>
                <div className="chat-import-head-actions">
                  <label className="field chat-import-tipo">
                    <span className="mono">Tipo</span>
                    <select
                      value={tipo}
                      onChange={(e) => setTipo(e.target.value as ChatTipo)}
                      disabled={busy}
                    >
                      <option value="individual">Individual</option>
                      <option value="grupo">Grupo</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => {
                      resetImportDraft()
                      setNewChatOpen(true)
                    }}
                  >
                    Cambiar archivo
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={closeNewChat}
                  >
                    Cancelar
                  </button>
                </div>
              </header>

              {error && <p className="error-text">{error}</p>}

              <div className="chat-import-grid">
                <section className="chat-import-pane">
                  {renderHabladores(previewSpeakers, 'preview')}
                </section>
                <section className="chat-import-pane">
                  <p className="mono">De qué trata</p>
                  <label className="field">
                    <span>Personas (además de quien habla)</span>
                    <EntityChipPicker
                      kinds={['person']}
                      selected={previewPeople}
                      primaryId={previewPrimaryPerson}
                      onPrimary={setPreviewPrimaryPerson}
                      onChange={setPreviewPeople}
                      disabled={busy}
                      placeholder="Alguien de quien se habla…"
                      allowCreate
                      onCreate={(name) => {
                        void handleCreatePerson(name).then((p) => {
                          if (p)
                            setPreviewPeople((prev) => [
                              ...prev,
                              { id: p.id, name: p.name, kind: 'person' },
                            ])
                        })
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Proyectos</span>
                    <EntityChipPicker
                      kinds={['project']}
                      selected={previewProjects}
                      primaryId={previewPrimaryProject}
                      onPrimary={setPreviewPrimaryProject}
                      onChange={setPreviewProjects}
                      disabled={busy}
                      placeholder="Proyecto de esta conversación…"
                      allowCreate
                      onCreate={(name) => {
                        void handleCreateProject(name).then((p) => {
                          if (p)
                            setPreviewProjects((prev) => [
                              ...prev,
                              { id: p.id, name: p.title, kind: 'project' },
                            ])
                        })
                      }}
                    />
                  </label>
                  <p className="muted chat-import-hint">
                    Clic en un nombre lo marca como principal.
                  </p>
                </section>
              </div>

              <footer className="chat-import-foot">
                {previewMapped ? (
                  <p className="muted">Listo para importar.</p>
                ) : (
                  <p className="error-text">
                    Faltan {previewUnmapped} perfil
                    {previewUnmapped === 1 ? '' : 'es'}.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !file || !previewMapped}
                  onClick={() => void handleImport()}
                >
                  {busy ? 'Importando…' : 'Importar'}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

        {speakersOpen &&
          createPortal(
          <div
            className="chat-speakers-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Hablantes de la conversación"
          >
            <div className="chat-speakers-card">
              <div className="panel-head entity-head">
                <h3 style={{ margin: 0 }}>Conversación</h3>
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => setSpeakersOpen(false)}
                >
                  Listo
                </button>
              </div>
              {renderHabladores(
                selected ? speakers : previewSpeakers,
                selected ? 'session' : 'preview',
              )}
              {selected && (
                <>
                  <WeightButtons
                    label="Peso de la conversación"
                    value={sessionWeight}
                    disabled={busy}
                    onPick={(w) => void voteConversation(w)}
                  />
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void saveSessionMeta()}
                  >
                    Guardar hablantes
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

        {cribaOpen &&
          selected &&
          selectedBlock &&
          createPortal(
            <div
              className="chat-criba-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Cribar chats"
            >
              <div className="chat-criba-card">
                <header className="chat-criba-head">
                  <div>
                    <p className="chat-import-kicker">Criba</p>
                    <h3>
                      {selected.nombre_chat}
                      <span className="muted">
                        {' '}
                        · {selectedBlock.day_key}
                      </span>
                    </h3>
                    <p className="muted">
                      {cribaDone}/{cribaPending.length || blocks.length} chats
                      con voto
                      {sessionWeight != null
                        ? ` · conversación ${sessionWeight}`
                        : ''}
                      {' · '}
                      {blockMessages.length} msgs
                    </p>
                  </div>
                  <div className="chat-criba-head-actions">
                    <WeightButtons
                      label="Conversación"
                      value={sessionWeight}
                      disabled={busy}
                      onPick={(w) => void voteConversation(w)}
                    />
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={busy}
                      onClick={() => setCribaOpen(false)}
                    >
                      Cerrar
                    </button>
                  </div>
                </header>
                {error && <p className="error-text">{error}</p>}
                <div className="chat-criba-grid">
                  <div className="chat-criba-thread">
                    {blockMessages.map((m) => {
                      const ia = speakerIsAi(m.remitente, speakers)
                      const hit = speakers.find(
                        (sp) => sp.remitente === (m.remitente ?? ''),
                      )
                      return (
                        <article
                          key={m.id}
                          className={ia ? 'chat-bubble is-ai' : 'chat-bubble'}
                        >
                          <header className="chat-bubble-meta">
                            {formatTs(m.timestamp_exact)} ·{' '}
                            {hit?.person_name || m.remitente || 'Sistema'}
                            {ia ? ' · IA' : ''}
                          </header>
                          <p className="chat-bubble-body">{m.texto_crudo}</p>
                        </article>
                      )
                    })}
                  </div>
                  <aside className="chat-criba-side">
                    <p className="mono">Este chat</p>
                    <label className="field">
                      <span>Entidades</span>
                      <EntityChipPicker
                        kinds={CHAT_ENTITY_KINDS}
                        selected={blockChips}
                        onChange={setBlockChips}
                        disabled={busy}
                        placeholder="Persona, proyecto, dominio…"
                      />
                    </label>
                    <label className="field">
                      <span className="mono">Notas y links</span>
                      <textarea
                        value={blockNotes}
                        onChange={(e) => setBlockNotes(e.target.value)}
                        rows={3}
                        disabled={busy}
                        placeholder="Notas…"
                      />
                      {blockLinkRows.length > 0 && (
                        <ul className="chat-link-list">
                          {blockLinkRows.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      <textarea
                        value={blockLinks}
                        onChange={(e) => setBlockLinks(e.target.value)}
                        rows={Math.min(5, Math.max(2, blockLinkRows.length + 1))}
                        disabled={busy}
                        placeholder="Links · uno por línea"
                      />
                    </label>
                    <WeightButtons
                      label="Peso de este chat"
                      value={blockWeight}
                      disabled={busy}
                      onPick={(w) => void voteCriba(w)}
                    />
                  </aside>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </section>
    </div>
  )
}
