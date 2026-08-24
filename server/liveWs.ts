import type { Server, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket as WsClient, type RawData } from 'ws'

function env(key: string, fallback = ''): string {
  return process.env[key]?.replace(/^["']|["']$/g, '') ?? fallback
}

function buildDeepgramUrl(searchParams: URLSearchParams): string {
  const model = searchParams.get('model') || env('DEEPGRAM_MODEL', 'nova-3')
  const language = searchParams.get('language') || env('DEEPGRAM_LANGUAGE', 'es')
  const sampleRate = searchParams.get('sample_rate') || '16000'
  const endpointing = searchParams.get('endpointing') || '300'

  const diarize = searchParams.get('diarize') === 'false' ? 'false' : 'true'

  const params = new URLSearchParams({
    model,
    language,
    smart_format: 'true',
    interim_results: 'true',
    endpointing,
    encoding: 'linear16',
    sample_rate: sampleRate,
    diarize,
  })
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`
}

type QueuedFrame = { data: RawData; isBinary: boolean }

/**
 * Proxy browser ↔ Deepgram Live.
 * Usa DEEPGRAM_API_KEY en el server (no requiere auth/grant / Member).
 */
export function attachLiveWsProxy(server: Server): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = ''
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      socket.destroy()
      return
    }

    if (pathname !== '/api/live/stream') {
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req)
    })
  })

  wss.on('connection', (client, req: IncomingMessage) => {
    const apiKey = env('DEEPGRAM_API_KEY')
    if (!apiKey) {
      client.close(1011, 'DEEPGRAM_API_KEY missing')
      return
    }

    let search: URLSearchParams
    try {
      search = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    } catch {
      client.close(1008, 'bad url')
      return
    }

    const dgUrl = buildDeepgramUrl(search)
    let dg: WsClient
    try {
      dg = new WsClient(dgUrl, {
        headers: { Authorization: `Token ${apiKey}` },
      })
    } catch (err) {
      console.error('[live/ws] open Deepgram failed', err)
      client.close(1011, 'deepgram open failed')
      return
    }

    const pending: QueuedFrame[] = []
    let dgOpen = false
    let closing = false

    const closeBoth = (code = 1000, reason = '') => {
      if (closing) return
      closing = true
      try {
        if (
          client.readyState === WsClient.OPEN ||
          client.readyState === WsClient.CONNECTING
        ) {
          client.close(code, reason)
        }
      } catch {
        /* ignore */
      }
      try {
        if (
          dg.readyState === WsClient.OPEN ||
          dg.readyState === WsClient.CONNECTING
        ) {
          dg.close()
        }
      } catch {
        /* ignore */
      }
    }

    const forwardToDg = (data: RawData, isBinary: boolean) => {
      if (dg.readyState !== WsClient.OPEN) return
      try {
        dg.send(data, { binary: isBinary })
      } catch {
        /* ignore */
      }
    }

    dg.on('open', () => {
      dgOpen = true
      for (const frame of pending.splice(0)) {
        forwardToDg(frame.data, frame.isBinary)
      }
    })

    dg.on('message', (data, isBinary) => {
      if (client.readyState !== WsClient.OPEN) return
      try {
        client.send(data, { binary: isBinary })
      } catch {
        /* ignore */
      }
    })

    dg.on('error', (err) => {
      console.error('[live/ws] Deepgram error', err.message)
      closeBoth(1011, 'deepgram error')
    })

    dg.on('close', (code, reason) => {
      const text = reason?.toString?.() || ''
      if (!closing) {
        console.warn('[live/ws] Deepgram closed', code, text)
      }
      closeBoth(code === 1000 ? 1000 : 1011, text.slice(0, 100))
    })

    client.on('message', (data, isBinary) => {
      if (dgOpen) {
        forwardToDg(data, isBinary)
        return
      }
      if (pending.length < 64) {
        pending.push({ data, isBinary })
      }
    })

    client.on('error', (err) => {
      console.error('[live/ws] client error', err.message)
      closeBoth(1011, 'client error')
    })

    client.on('close', () => {
      try {
        if (dg.readyState === WsClient.OPEN) {
          dg.send(JSON.stringify({ type: 'CloseStream' }))
        }
      } catch {
        /* ignore */
      }
      try {
        dg.close()
      } catch {
        /* ignore */
      }
    })
  })

  console.log('[deprocast] live WS proxy on /api/live/stream')
}
