import {
  PORT_NAME,
  SERVER_ORIGIN,
  TIMESLICE_MS,
  type CaptureMode,
  type CofreFinalBlock,
  type CofreUtterance,
  type SwToOffscreen,
} from './protocol'
import { clearCaptureStore, putChunk, putMeta } from './chunkStore'

type DgWord = {
  word?: string
  start?: number
  end?: number
  speaker?: number
}

type DgMessage = {
  type?: string
  is_final?: boolean
  start?: number
  duration?: number
  channel?: {
    alternatives?: Array<{
      transcript?: string
      words?: DgWord[]
    }>
  }
}

type LiveConfig = {
  model?: string
  language?: string
  stream_path?: string
}

type CaptureSession = {
  startedAt: number
  captureMode: CaptureMode
  includeMic: boolean
  micDenied: boolean
  desktopStream: MediaStream | null
  micStream: MediaStream | null
  audioContext: AudioContext | null
  processor: ScriptProcessorNode | null
  recorder: MediaRecorder | null
  ws: WebSocket | null
  keepAliveTimer: number | null
  chunkSeq: number
  blocks: CofreFinalBlock[]
  utterances: CofreUtterance[]
  mime: string
  stopping: boolean
}

let session: CaptureSession | null = null
let port: chrome.Port | null = null

function connectPort(): void {
  port = chrome.runtime.connect({ name: PORT_NAME })
  port.onMessage.addListener((raw) => {
    void handleSwMessage(raw as SwToOffscreen)
  })
  port.onDisconnect.addListener(() => {
    port = null
    window.setTimeout(connectPort, 250)
  })
}

function tellSw(msg: unknown): void {
  try {
    port?.postMessage(msg)
  } catch {
    /* SW asleep */
  }
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

function desktopConstraints(
  sourceId: string,
  withAudio: boolean,
): MediaStreamConstraints {
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: 1920,
      maxHeight: 1080,
      maxFrameRate: 15,
    },
  }
  if (!withAudio) {
    return { audio: false, video } as unknown as MediaStreamConstraints
  }
  return {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
    video,
  } as unknown as MediaStreamConstraints
}

function tabConstraints(streamId: string): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 15,
      },
    },
  } as unknown as MediaStreamConstraints
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}

async function getDesktopStream(sourceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(
      desktopConstraints(sourceId, true),
    )
  } catch {
    return await navigator.mediaDevices.getUserMedia(
      desktopConstraints(sourceId, false),
    )
  }
}

async function getTabStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(tabConstraints(streamId))
}

async function getMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  })
}

async function connectWs(
  sampleRate: number,
  cfg: LiveConfig,
): Promise<WebSocket> {
  const params = new URLSearchParams({
    model: cfg.model || 'nova-3',
    language: cfg.language || 'es',
    encoding: 'linear16',
    sample_rate: String(Math.round(sampleRate)),
    punctuate: 'true',
    smart_format: 'true',
    interim_results: 'true',
    diarize: 'true',
    endpointing: '300',
  })
  const path = cfg.stream_path || '/api/live/stream'
  const url = `${SERVER_ORIGIN.replace(/^http/, 'ws')}${path}?${params.toString()}`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    let settled = false
    ws.onopen = () => {
      settled = true
      resolve(ws)
    }
    ws.onerror = () => {
      if (!settled) reject(new Error('No se pudo abrir el WebSocket live'))
    }
    ws.onclose = (ev) => {
      if (!settled) {
        reject(
          new Error(
            ev.reason
              ? `WebSocket cerrado: ${ev.reason}`
              : 'WebSocket cerrado antes de conectar',
          ),
        )
      }
    }
  })
}

function handleDgMessage(raw: string, sess: CaptureSession): void {
  let msg: DgMessage
  try {
    msg = JSON.parse(raw) as DgMessage
  } catch {
    return
  }
  if (msg.type && msg.type !== 'Results') return
  const alt = msg.channel?.alternatives?.[0]
  const transcript = alt?.transcript?.trim() ?? ''
  if (!transcript || !msg.is_final) return

  const words = alt?.words ?? []
  const speaker =
    typeof words[0]?.speaker === 'number' ? words[0].speaker : 0
  const start =
    typeof words[0]?.start === 'number'
      ? words[0].start
      : typeof msg.start === 'number'
        ? msg.start
        : (Date.now() - sess.startedAt) / 1000
  const last = words[words.length - 1]
  const end =
    typeof last?.end === 'number'
      ? last.end
      : start + (typeof msg.duration === 'number' ? msg.duration : 0)

  sess.utterances.push({
    speaker,
    start,
    end: end >= start ? end : start,
    transcript,
  })
  sess.blocks.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: transcript,
    at: Date.now(),
    speaker,
  })
}

async function startCapture(
  msg: Extract<SwToOffscreen, { type: 'OFFSCREEN_START' }>,
): Promise<void> {
  if (session) throw new Error('Ya hay una captura offscreen activa')

  tellSw({ type: 'OFFSCREEN_STATUS', phase: 'connecting' })
  await clearCaptureStore()

  let desktopStream: MediaStream
  if (msg.captureMode === 'tab') {
    if (!msg.tabStreamId) throw new Error('Falta tabStreamId')
    desktopStream = await getTabStream(msg.tabStreamId)
  } else {
    if (!msg.desktopSourceId) throw new Error('Falta desktopSourceId')
    desktopStream = await getDesktopStream(msg.desktopSourceId)
  }

  let micStream: MediaStream | null = null
  let micDenied = false
  if (msg.includeMic) {
    try {
      micStream = await getMicStream()
    } catch {
      micDenied = true
      tellSw({ type: 'MIC_DENIED' })
    }
  }

  const audioContext = new AudioContext({ sampleRate: 16000 })
  if (audioContext.state === 'suspended') await audioContext.resume()

  const mixDest = audioContext.createMediaStreamDestination()
  if (desktopStream.getAudioTracks().length > 0) {
    const displayOnly = new MediaStream(desktopStream.getAudioTracks())
    audioContext.createMediaStreamSource(displayOnly).connect(mixDest)
  }
  if (micStream) {
    audioContext.createMediaStreamSource(micStream).connect(mixDest)
  }

  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const mute = audioContext.createGain()
  mute.gain.value = 0
  audioContext.createMediaStreamSource(mixDest.stream).connect(processor)
  processor.connect(mute)
  mute.connect(audioContext.destination)

  let cfg: LiveConfig = {}
  try {
    const res = await fetch(`${SERVER_ORIGIN}/api/live/config`)
    if (res.ok) cfg = (await res.json()) as LiveConfig
  } catch {
    /* defaults */
  }

  const ws = await connectWs(audioContext.sampleRate, cfg)
  const mime = pickMime()

  const sess: CaptureSession = {
    startedAt: Date.now(),
    captureMode: msg.captureMode,
    includeMic: msg.includeMic,
    micDenied,
    desktopStream,
    micStream,
    audioContext,
    processor,
    recorder: null,
    ws,
    keepAliveTimer: null,
    chunkSeq: 0,
    blocks: [],
    utterances: [],
    mime,
    stopping: false,
  }
  session = sess

  processor.onaudioprocess = (ev) => {
    if (!session || session.ws?.readyState !== WebSocket.OPEN) return
    const input = ev.inputBuffer.getChannelData(0)
    try {
      session.ws.send(floatTo16BitPCM(input))
    } catch {
      /* ignore */
    }
  }

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') handleDgMessage(ev.data, sess)
  }

  sess.keepAliveTimer = window.setInterval(() => {
    if (sess.ws?.readyState !== WebSocket.OPEN) return
    try {
      sess.ws.send(JSON.stringify({ type: 'KeepAlive' }))
    } catch {
      /* ignore */
    }
  }, 8000)

  const recordTracks: MediaStreamTrack[] = [
    ...desktopStream.getVideoTracks(),
    ...mixDest.stream.getAudioTracks(),
  ]
  if (recordTracks.length === 0) {
    throw new Error('La captura no devolvió pistas de audio ni video')
  }
  const recordStream = new MediaStream(recordTracks)
  const recorder = new MediaRecorder(
    recordStream,
    sess.mime
      ? { mimeType: sess.mime, videoBitsPerSecond: 1_200_000 }
      : undefined,
  )
  sess.recorder = recorder
  sess.mime = recorder.mimeType || sess.mime || 'video/webm'

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return
    const seq = sess.chunkSeq++
    void putChunk(seq, ev.data)
  }

  recorder.start(TIMESLICE_MS)
  tellSw({ type: 'OFFSCREEN_STATUS', phase: 'recording' })
}

function waitForRecorderStop(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return Promise.resolve()
  return new Promise((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true })
    try {
      recorder.stop()
    } catch {
      resolve()
    }
  })
}

async function teardownMedia(sess: CaptureSession): Promise<void> {
  if (sess.keepAliveTimer != null) {
    window.clearInterval(sess.keepAliveTimer)
    sess.keepAliveTimer = null
  }
  if (sess.processor) {
    sess.processor.onaudioprocess = null
    try {
      sess.processor.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (sess.ws) {
    try {
      if (sess.ws.readyState === WebSocket.OPEN) {
        sess.ws.send(JSON.stringify({ type: 'CloseStream' }))
      }
      sess.ws.close()
    } catch {
      /* ignore */
    }
  }
  stopStream(sess.desktopStream)
  stopStream(sess.micStream)
  if (sess.audioContext && sess.audioContext.state !== 'closed') {
    try {
      await sess.audioContext.close()
    } catch {
      /* ignore */
    }
  }
}

async function stopCapture(): Promise<void> {
  const sess = session
  if (!sess || sess.stopping) return
  sess.stopping = true

  if (sess.recorder) {
    try {
      if (sess.recorder.state === 'recording') sess.recorder.requestData()
    } catch {
      /* ignore */
    }
    await waitForRecorderStop(sess.recorder)
  }

  await teardownMedia(sess)
  await putMeta({
    startedAt: sess.startedAt,
    endedAt: Date.now(),
    mime: sess.mime,
    captureMode: sess.captureMode,
    includeMic: sess.includeMic,
    micDenied: sess.micDenied,
    blocks: sess.blocks,
    utterances: sess.utterances,
  })
  session = null
  tellSw({ type: 'CAPTURE_READY' })
}

async function handleSwMessage(msg: SwToOffscreen): Promise<void> {
  try {
    if (msg.type === 'OFFSCREEN_START') {
      await startCapture(msg)
      return
    }
    if (msg.type === 'OFFSCREEN_STOP') {
      await stopCapture()
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (session) {
      await teardownMedia(session).catch(() => undefined)
      session = null
    }
    tellSw({ type: 'OFFSCREEN_ERROR', error })
  }
}

connectPort()
window.setInterval(() => tellSw({ type: 'PING' }), 20_000)
