export type LiveFinalBlock = {
  id: string
  text: string
  at: number
}

export type LiveSessionCallbacks = {
  onInterim: (text: string) => void
  onFinal: (block: LiveFinalBlock) => void
  onStatus: (status: 'connecting' | 'listening') => void
  onError: (message: string) => void
  onClosed: () => void
}

export type LiveConnectOptions = {
  model: string
  language: string
  streamPath?: string
  endpointingMs?: number
}

type DeepgramResultsMessage = {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  channel?: {
    alternatives?: Array<{ transcript?: string }>
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

/** WS al proxy local (Vite → Express → Deepgram). La API key nunca llega al browser. */
function buildProxyUrl(
  opts: LiveConnectOptions,
  sampleRate: number,
): string {
  const params = new URLSearchParams({
    model: opts.model || 'nova-3',
    language: opts.language || 'es',
    endpointing: String(opts.endpointingMs ?? 300),
    sample_rate: String(Math.round(sampleRate)),
  })
  const path = opts.streamPath || '/api/live/stream'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}?${params.toString()}`
}

/**
 * Sesión live: mic → PCM linear16 → proxy WS → Deepgram.
 * El caller debe invocar disconnect() para liberar mic / WS / AudioContext.
 */
export class DeepgramLiveSession {
  private ws: WebSocket | null = null
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private muteGain: GainNode | null = null
  private keepAliveTimer: number | null = null
  private closed = false

  constructor(private readonly cb: LiveSessionCallbacks) {}

  async connect(opts: LiveConnectOptions): Promise<void> {
    this.cb.onStatus('connecting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw new Error('Permiso de micrófono denegado. Habilitá el mic en el navegador.')
      }
      if (name === 'NotFoundError') {
        throw new Error('No se encontró un micrófono disponible.')
      }
      throw new Error(
        err instanceof Error ? err.message : 'No se pudo acceder al micrófono',
      )
    }

    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    this.stream = stream

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const audioContext = new AudioCtx({ sampleRate: 16000 })
    this.audioContext = audioContext
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const sampleRate = audioContext.sampleRate
    const url = buildProxyUrl(opts, sampleRate)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(url)
      this.ws = ws
      ws.binaryType = 'arraybuffer'

      const fail = (message: string) => {
        if (settled) return
        settled = true
        reject(new Error(message))
      }

      ws.onopen = () => {
        if (settled || this.closed) return
        settled = true
        this.startAudioPipeline(audioContext, stream)
        this.startKeepAlive()
        this.cb.onStatus('listening')
        resolve()
      }

      ws.onerror = () => {
        fail('Error en la conexión WebSocket (proxy live)')
      }

      ws.onclose = (ev) => {
        if (!settled) {
          fail(
            ev.reason
              ? `WebSocket cerrado: ${ev.reason}`
              : 'WebSocket cerrado antes de conectar',
          )
          return
        }
        if (!this.closed) {
          this.cb.onClosed()
        }
        void this.teardownMediaOnly()
      }

      ws.onmessage = (ev) => {
        this.handleMessage(ev.data)
      }
    })
  }

  disconnect(): void {
    this.closed = true
    this.stopKeepAlive()

    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        /* ignore */
      }
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }

    void this.teardownMediaOnly()
  }

  private async teardownMediaOnly(): Promise<void> {
    this.stopKeepAlive()

    if (this.processor) {
      try {
        this.processor.disconnect()
      } catch {
        /* ignore */
      }
      this.processor.onaudioprocess = null
      this.processor = null
    }
    if (this.muteGain) {
      try {
        this.muteGain.disconnect()
      } catch {
        /* ignore */
      }
      this.muteGain = null
    }
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        /* ignore */
      }
      this.source = null
    }

    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null

    const ctx = this.audioContext
    this.audioContext = null
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close()
      } catch {
        /* ignore */
      }
    }
  }

  private startAudioPipeline(
    audioContext: AudioContext,
    stream: MediaStream,
  ): void {
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const muteGain = audioContext.createGain()
    muteGain.gain.value = 0
    this.source = source
    this.processor = processor
    this.muteGain = muteGain

    processor.onaudioprocess = (event) => {
      if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
      const input = event.inputBuffer.getChannelData(0)
      try {
        this.ws.send(floatTo16BitPCM(input))
      } catch {
        /* ignore send races on close */
      }
    }

    source.connect(processor)
    processor.connect(muteGain)
    muteGain.connect(audioContext.destination)
  }

  private startKeepAlive(): void {
    this.stopKeepAlive()
    this.keepAliveTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      try {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
      } catch {
        /* ignore */
      }
    }, 8000)
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer != null) {
      window.clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let msg: DeepgramResultsMessage
    try {
      msg = JSON.parse(raw) as DeepgramResultsMessage
    } catch {
      return
    }

    if (msg.type && msg.type !== 'Results') return

    const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (!transcript) {
      if (msg.is_final) this.cb.onInterim('')
      return
    }

    if (msg.is_final) {
      this.cb.onFinal({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: transcript,
        at: Date.now(),
      })
      this.cb.onInterim('')
      return
    }

    this.cb.onInterim(transcript)
  }
}
