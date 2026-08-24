import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../services/api'
import {
  DeepgramLiveSession,
  type LiveFinalBlock,
} from './deepgramLive'

export type LiveStatus = 'idle' | 'connecting' | 'listening' | 'error'

type LiveSessionValue = {
  status: LiveStatus
  interim: string
  finalBlocks: LiveFinalBlock[]
  error: string | null
  start: () => Promise<void>
  stop: () => void
  clearFeed: () => void
}

const LiveSessionContext = createContext<LiveSessionValue | null>(null)

export function LiveSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [interim, setInterim] = useState('')
  const [finalBlocks, setFinalBlocks] = useState<LiveFinalBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<DeepgramLiveSession | null>(null)
  const startingRef = useRef(false)

  const stop = useCallback(() => {
    startingRef.current = false
    const session = sessionRef.current
    sessionRef.current = null
    session?.disconnect()
    setInterim('')
    setError(null)
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    if (startingRef.current) return
    if (sessionRef.current) {
      stop()
    }

    startingRef.current = true
    setError(null)
    setStatus('connecting')
    setInterim('')

    try {
      const config = await api.getLiveConfig()
      if (!startingRef.current) return

      const session = new DeepgramLiveSession({
        onInterim: (text) => setInterim(text),
        onFinal: (block) => {
          setFinalBlocks((prev) => [...prev, block])
        },
        onStatus: (s) => {
          if (s === 'listening') setStatus('listening')
          else if (s === 'connecting') setStatus('connecting')
        },
        onError: (message) => {
          setError(message)
          setStatus('error')
        },
        onClosed: () => {
          sessionRef.current = null
          startingRef.current = false
          setInterim('')
          setStatus((prev) => (prev === 'error' ? prev : 'idle'))
        },
      })

      sessionRef.current = session
      await session.connect({
        model: config.model,
        language: config.language,
        streamPath: config.stream_path,
        endpointingMs: 300,
      })
      startingRef.current = false
    } catch (err) {
      startingRef.current = false
      sessionRef.current?.disconnect()
      sessionRef.current = null
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar Directo'
      setError(message)
      setStatus('error')
      setInterim('')
    }
  }, [stop])

  const clearFeed = useCallback(() => {
    setFinalBlocks([])
    setInterim('')
  }, [])

  useEffect(() => {
    return () => {
      startingRef.current = false
      sessionRef.current?.disconnect()
      sessionRef.current = null
    }
  }, [])

  const value = useMemo<LiveSessionValue>(
    () => ({
      status,
      interim,
      finalBlocks,
      error,
      start,
      stop,
      clearFeed,
    }),
    [status, interim, finalBlocks, error, start, stop, clearFeed],
  )

  return (
    <LiveSessionContext.Provider value={value}>
      {children}
    </LiveSessionContext.Provider>
  )
}

export function useLiveSession(): LiveSessionValue {
  const ctx = useContext(LiveSessionContext)
  if (!ctx) {
    throw new Error('useLiveSession debe usarse dentro de LiveSessionProvider')
  }
  return ctx
}
