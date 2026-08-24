/** Contrato de mensajes El Cofre. Solo tipos: no genera chunk en el build. */

export const SERVER_ORIGIN = 'http://127.0.0.1:3001'
export const ALARM_KEEPALIVE = 'cofre-keepalive'
export const PORT_NAME = 'cofre'
export const TIMESLICE_MS = 12_000

export type CaptureMode = 'desktop' | 'tab'

export type CofreStatus = 'idle' | 'recording' | 'uploading' | 'error'

export type TabEvent = {
  at: number
  until?: number
  url: string
  title: string
  tabId: number
}

export type CofreFinalBlock = {
  id: string
  text: string
  at: number
  speaker?: number
}

export type CofreUtterance = {
  speaker: number
  start: number
  end: number
  transcript: string
}

export type CofreState = {
  status: CofreStatus
  error: string | null
  startedAt: number | null
  captureMode: CaptureMode | null
  lastEntryId: string | null
  lastTitle: string | null
  micDenied: boolean
}

export type CofreManifest = {
  started_at: string
  ended_at: string
  capture_mode: CaptureMode
  include_mic: boolean
  mic_denied: boolean
  final_blocks: CofreFinalBlock[]
  utterances: CofreUtterance[]
  tab_timeline: TabEvent[]
}

export type PopupToSw =
  | { type: 'GET_STATE' }
  | {
      type: 'START'
      desktopSourceId: string | null
      captureMode: CaptureMode
      includeMic: boolean
    }
  | { type: 'STOP' }
  | { type: 'RETRY_UPLOAD' }

export type SwToPopup = {
  ok: boolean
  error?: string
  state?: CofreState
  entry?: { id: string; title: string; status: string }
}

export type SwToOffscreen =
  | {
      type: 'OFFSCREEN_START'
      desktopSourceId: string | null
      tabStreamId: string | null
      captureMode: CaptureMode
      includeMic: boolean
    }
  | { type: 'OFFSCREEN_STOP' }

export type OffscreenToSw =
  | { type: 'PING' }
  | { type: 'OFFSCREEN_STATUS'; phase: 'connecting' | 'recording' }
  | { type: 'CAPTURE_READY' }
  | { type: 'OFFSCREEN_ERROR'; error: string }
  | { type: 'MIC_DENIED' }

export type CofreIdbMeta = {
  startedAt: number
  endedAt: number
  mime: string
  captureMode: CaptureMode
  includeMic: boolean
  micDenied: boolean
  blocks: CofreFinalBlock[]
  utterances: CofreUtterance[]
}

export function isRecordableUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function defaultState(): CofreState {
  return {
    status: 'idle',
    error: null,
    startedAt: null,
    captureMode: null,
    lastEntryId: null,
    lastTitle: null,
    micDenied: false,
  }
}
