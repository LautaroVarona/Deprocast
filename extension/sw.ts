import {
  ALARM_KEEPALIVE,
  defaultState,
  isRecordableUrl,
  PORT_NAME,
  SERVER_ORIGIN,
  type CaptureMode,
  type CofreManifest,
  type CofreState,
  type OffscreenToSw,
  type PopupToSw,
  type SwToOffscreen,
  type SwToPopup,
  type TabEvent,
} from './protocol'
import { clearCaptureStore, getAllChunks, getMeta } from './chunkStore'

const STATE_KEY = 'cofreState'
const TIMELINE_KEY = 'cofreTimeline'
const OPEN_TAB_KEY = 'cofreOpenTab'

let offscreenPort: chrome.Port | null = null
let waitingForPort: ((port: chrome.Port) => void) | null = null
let tabListenersOn = false

async function readState(): Promise<CofreState> {
  const bag = await chrome.storage.session.get(STATE_KEY)
  const raw = bag[STATE_KEY]
  if (!raw || typeof raw !== 'object') return defaultState()
  return { ...defaultState(), ...(raw as CofreState) }
}

async function writeState(patch: Partial<CofreState>): Promise<CofreState> {
  const next = { ...(await readState()), ...patch }
  await chrome.storage.session.set({ [STATE_KEY]: next })
  await applyBadge(next)
  return next
}

async function applyBadge(state: CofreState): Promise<void> {
  if (state.status === 'recording') {
    await chrome.action.setBadgeBackgroundColor({ color: '#c45c4a' })
    await chrome.action.setBadgeText({ text: 'REC' })
    return
  }
  if (state.status === 'uploading') {
    await chrome.action.setBadgeBackgroundColor({ color: '#c4a35a' })
    await chrome.action.setBadgeText({ text: '…' })
    return
  }
  await chrome.action.setBadgeText({ text: '' })
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS'],
      justification:
        'Captura de pantalla, micrófono y MediaRecorder para El Cofre.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already exists|single offscreen/i.test(msg)) return
    throw err
  }
}

function waitForPort(ms = 8000): Promise<chrome.Port> {
  if (offscreenPort) return Promise.resolve(offscreenPort)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waitingForPort = null
      reject(new Error('El documento offscreen no conectó'))
    }, ms)
    waitingForPort = (port) => {
      clearTimeout(timer)
      waitingForPort = null
      resolve(port)
    }
  })
}

function postToOffscreen(msg: SwToOffscreen): void {
  if (!offscreenPort) throw new Error('Offscreen no está conectado')
  offscreenPort.postMessage(msg)
}

function isHttpTab(url: string | undefined): url is string {
  return typeof url === 'string' && isRecordableUrl(url)
}

async function snapshotActiveTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const tab = tabs[0]
  if (!tab?.id || !isHttpTab(tab.url)) return
  await appendTabEvent(tab.id, tab.url, tab.title ?? '')
}

async function appendTabEvent(
  tabId: number,
  url: string,
  title: string,
): Promise<void> {
  const state = await readState()
  if (state.status !== 'recording') return
  if (!isRecordableUrl(url)) return

  const now = Date.now()
  const bag = await chrome.storage.session.get([TIMELINE_KEY, OPEN_TAB_KEY])
  const timeline = Array.isArray(bag[TIMELINE_KEY])
    ? (bag[TIMELINE_KEY] as TabEvent[])
    : []
  const open = (bag[OPEN_TAB_KEY] as TabEvent | null) ?? null
  const clippedTitle = title.slice(0, 200)

  if (
    open &&
    open.tabId === tabId &&
    open.url === url &&
    open.title === clippedTitle
  ) {
    return
  }

  if (open) timeline.push({ ...open, until: now })

  const nextOpen: TabEvent = {
    at: now,
    url,
    title: clippedTitle,
    tabId,
  }
  await chrome.storage.session.set({
    [TIMELINE_KEY]: timeline,
    [OPEN_TAB_KEY]: nextOpen,
  })
}

async function closeOpenTab(): Promise<TabEvent[]> {
  const now = Date.now()
  const bag = await chrome.storage.session.get([TIMELINE_KEY, OPEN_TAB_KEY])
  const timeline = Array.isArray(bag[TIMELINE_KEY])
    ? (bag[TIMELINE_KEY] as TabEvent[])
    : []
  const open = (bag[OPEN_TAB_KEY] as TabEvent | null) ?? null
  if (open) timeline.push({ ...open, until: now })
  await chrome.storage.session.set({
    [TIMELINE_KEY]: timeline,
    [OPEN_TAB_KEY]: null,
  })
  return timeline
}

async function resetTimeline(): Promise<void> {
  await chrome.storage.session.set({
    [TIMELINE_KEY]: [],
    [OPEN_TAB_KEY]: null,
  })
}

function onTabActivated(info: { tabId: number }): void {
  void chrome.tabs
    .get(info.tabId)
    .then((tab) => {
      if (tab.id && isHttpTab(tab.url)) {
        return appendTabEvent(tab.id, tab.url, tab.title ?? '')
      }
    })
    .catch(() => undefined)
}

function onTabUpdated(
  tabId: number,
  change: { url?: string; title?: string },
  tab: chrome.tabs.Tab,
): void {
  if (!tab.active) return
  if (!change.url && !change.title) return
  const url = change.url ?? tab.url
  if (!isHttpTab(url)) return
  void appendTabEvent(tabId, url, change.title ?? tab.title ?? '')
}

function ensureTabListeners(): void {
  if (tabListenersOn) return
  chrome.tabs.onActivated.addListener(onTabActivated)
  chrome.tabs.onUpdated.addListener(onTabUpdated)
  tabListenersOn = true
}

function dropTabListeners(): void {
  if (!tabListenersOn) return
  chrome.tabs.onActivated.removeListener(onTabActivated)
  chrome.tabs.onUpdated.removeListener(onTabUpdated)
  tabListenersOn = false
}

function startKeepalive(): void {
  chrome.alarms.create(ALARM_KEEPALIVE, { periodInMinutes: 0.5 })
}

async function stopKeepalive(): Promise<void> {
  await chrome.alarms.clear(ALARM_KEEPALIVE)
}

async function closeOffscreenSafe(): Promise<void> {
  offscreenPort = null
  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.closeDocument()
    }
  } catch {
    /* ignore */
  }
}

function reply(sendResponse: (r: SwToPopup) => void, payload: SwToPopup): void {
  try {
    sendResponse(payload)
  } catch {
    /* popup closed */
  }
}

async function handleStart(
  desktopSourceId: string | null,
  captureMode: CaptureMode,
  includeMic: boolean,
): Promise<SwToPopup> {
  const current = await readState()
  if (current.status === 'recording' || current.status === 'uploading') {
    return { ok: false, error: 'Ya hay una sesión en curso', state: current }
  }

  let tabStreamId: string | null = null
  if (captureMode === 'tab') {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const tab = tabs[0]
    if (!tab?.id) throw new Error('No hay pestaña activa')
    tabStreamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    })
  } else if (!desktopSourceId) {
    throw new Error('Falta el origen de captura de pantalla')
  }

  await clearCaptureStore()
  await resetTimeline()
  await ensureOffscreen()
  offscreenPort = await waitForPort()

  await writeState({
    status: 'recording',
    error: null,
    startedAt: Date.now(),
    captureMode,
    micDenied: false,
  })
  ensureTabListeners()
  startKeepalive()
  await snapshotActiveTab()

  postToOffscreen({
    type: 'OFFSCREEN_START',
    desktopSourceId,
    tabStreamId,
    captureMode,
    includeMic,
  })

  return { ok: true, state: await readState() }
}

async function uploadPending(): Promise<SwToPopup> {
  const meta = await getMeta()
  const chunks = await getAllChunks()
  if (!meta || chunks.length === 0) {
    throw new Error('No hay captura pendiente para enviar')
  }

  await writeState({ status: 'uploading', error: null })
  const timeline = await closeOpenTab()
  const blob = new Blob(chunks, { type: meta.mime || 'video/webm' })
  const manifest: CofreManifest = {
    started_at: new Date(meta.startedAt).toISOString(),
    ended_at: new Date(meta.endedAt).toISOString(),
    capture_mode: meta.captureMode,
    include_mic: meta.includeMic,
    mic_denied: meta.micDenied,
    final_blocks: meta.blocks,
    utterances: meta.utterances,
    tab_timeline: timeline,
  }

  const stamp = manifest.started_at.slice(0, 16).replace(/[-:T]/g, '')
  const form = new FormData()
  form.append('audio', blob, `cofre-${stamp}.webm`)
  form.append('manifest', JSON.stringify(manifest))

  const res = await fetch(`${SERVER_ORIGIN}/api/ingest/cofre`, {
    method: 'POST',
    body: form,
  })
  const raw = await res.text()
  let parsed: { error?: string; id?: string; title?: string; status?: string } =
    {}
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    parsed = { error: raw.slice(0, 200) || `HTTP ${res.status}` }
  }
  if (!res.ok) {
    throw new Error(parsed.error || `El servidor respondió ${res.status}`)
  }
  if (!parsed.id) throw new Error('El servidor no devolvió id de entrada')

  await clearCaptureStore()
  dropTabListeners()
  await stopKeepalive()
  await closeOffscreenSafe()
  const state = await writeState({
    status: 'idle',
    error: null,
    startedAt: null,
    captureMode: null,
    lastEntryId: parsed.id,
    lastTitle: parsed.title ?? 'Cofre',
    micDenied: false,
  })
  return {
    ok: true,
    state,
    entry: {
      id: parsed.id,
      title: parsed.title ?? 'Cofre',
      status: parsed.status ?? 'pending_criba',
    },
  }
}

async function handleStop(): Promise<SwToPopup> {
  const current = await readState()
  if (current.status !== 'recording') {
    return { ok: false, error: 'No hay grabación activa', state: current }
  }
  if (!offscreenPort) {
    await ensureOffscreen()
    offscreenPort = await waitForPort()
  }
  postToOffscreen({ type: 'OFFSCREEN_STOP' })
  return { ok: true, state: await readState() }
}

async function handleOffscreenMessage(msg: OffscreenToSw): Promise<void> {
  if (msg.type === 'PING') return
  if (msg.type === 'MIC_DENIED') {
    await writeState({ micDenied: true })
    return
  }
  if (msg.type === 'OFFSCREEN_STATUS' && msg.phase === 'recording') {
    await writeState({ status: 'recording' })
    return
  }
  if (msg.type === 'OFFSCREEN_ERROR') {
    dropTabListeners()
    await stopKeepalive()
    await writeState({ status: 'error', error: msg.error })
    return
  }
  if (msg.type === 'CAPTURE_READY') {
    try {
      await uploadPending()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await writeState({ status: 'error', error })
    }
  }
}

async function reconcile(): Promise<void> {
  const state = await readState()
  const hasDoc = await chrome.offscreen.hasDocument().catch(() => false)
  if (state.status === 'recording' && !hasDoc) {
    dropTabListeners()
    await stopKeepalive()
    await writeState({
      status: 'error',
      error: 'La captura se interrumpió (offscreen cerrado).',
    })
  }
  await applyBadge(await readState())
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return
  offscreenPort = port
  if (waitingForPort) waitingForPort(port)
  port.onMessage.addListener((raw) => {
    void handleOffscreenMessage(raw as OffscreenToSw)
  })
  port.onDisconnect.addListener(() => {
    if (offscreenPort === port) offscreenPort = null
  })
})

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as PopupToSw
  void (async () => {
    try {
      if (msg.type === 'GET_STATE') {
        reply(sendResponse, { ok: true, state: await readState() })
        return
      }
      if (msg.type === 'START') {
        reply(
          sendResponse,
          await handleStart(
            msg.desktopSourceId,
            msg.captureMode,
            msg.includeMic,
          ),
        )
        return
      }
      if (msg.type === 'STOP') {
        reply(sendResponse, await handleStop())
        return
      }
      if (msg.type === 'RETRY_UPLOAD') {
        reply(sendResponse, await uploadPending())
        return
      }
      reply(sendResponse, { ok: false, error: 'Mensaje desconocido' })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const state = await writeState({ status: 'error', error })
      reply(sendResponse, { ok: false, error, state })
    }
  })()
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_KEEPALIVE) return
  void readState()
})

void reconcile()
