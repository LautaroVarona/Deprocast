import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AudioAnalysisPayload, AudioTimeRegion } from '../types'

const SKIP_PADDING_SEC = 0.05

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function regionAt(
  regions: AudioTimeRegion[],
  time: number,
): AudioTimeRegion | null {
  for (const r of regions) {
    if (time >= r.start && time < r.end) return r
  }
  return null
}

function nextSpeechStart(
  speechRegions: AudioTimeRegion[],
  time: number,
): number | null {
  for (const r of speechRegions) {
    if (r.start > time + SKIP_PADDING_SEC) return r.start + SKIP_PADDING_SEC
  }
  return null
}

function findNextSegment(
  speechRegions: AudioTimeRegion[],
  time: number,
): number | null {
  for (const r of speechRegions) {
    if (r.start >= time + 0.2) return r.start
  }
  return null
}

function findPrevSegment(
  speechRegions: AudioTimeRegion[],
  time: number,
): number | null {
  let prev: number | null = null
  for (const r of speechRegions) {
    if (r.start >= time - 0.3) break
    prev = r.start
  }
  return prev
}

function speechDuration(regions: AudioTimeRegion[]): number {
  return regions.reduce((sum, r) => sum + (r.end - r.start), 0)
}

export type SmartAudioPlayback = {
  skipSilence: boolean
  setSkipSilence: (v: boolean) => void
  enhanced: boolean
  setEnhanced: (v: boolean) => void
  enhancing: boolean
  currentTime: number
  duration: number
  activeSpeechIndex: number
  speechDurationLabel: string
  totalDurationLabel: string
  seekTo: (sec: number) => void
  nextSegment: () => void
  prevSegment: () => void
  skipIfSilent: (time: number) => number | null
}

type Options = {
  analysis: AudioAnalysisPayload | null
  entryId: string | null
  onRequestAnalysis?: () => void
}

export function useSmartAudioPlayback(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  { analysis, entryId, onRequestAnalysis }: Options,
): SmartAudioPlayback {
  const [skipSilence, setSkipSilence] = useState(true)
  const [enhanced, setEnhanced] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const skipLock = useRef(false)

  const speechRegions = analysis?.speech_regions ?? []
  const silenceRegions = analysis?.silence_regions ?? []

  const speechDurationLabel = useMemo(
    () => formatDuration(speechDuration(speechRegions)),
    [speechRegions],
  )
  const totalDurationLabel = useMemo(
    () =>
      formatDuration(
        analysis?.duration_sec ?? duration ?? 0,
      ),
    [analysis?.duration_sec, duration],
  )

  const activeSpeechIndex = useMemo(() => {
    for (let i = 0; i < speechRegions.length; i++) {
      const r = speechRegions[i]!
      if (currentTime >= r.start && currentTime < r.end) return i
    }
    return -1
  }, [currentTime, speechRegions])

  const seekTo = useCallback(
    (sec: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(0, sec)
      setCurrentTime(audio.currentTime)
    },
    [audioRef],
  )

  const skipIfSilent = useCallback(
    (time: number): number | null => {
      if (!skipSilence || speechRegions.length === 0) return null
      const inSilence = regionAt(silenceRegions, time)
      if (inSilence) {
        const next = nextSpeechStart(speechRegions, inSilence.end - SKIP_PADDING_SEC)
        return next
      }
      if (!regionAt(speechRegions, time)) {
        return nextSpeechStart(speechRegions, time)
      }
      return null
    },
    [skipSilence, silenceRegions, speechRegions],
  )

  const nextSegment = useCallback(() => {
    const next = findNextSegment(speechRegions, currentTime)
    if (next != null) seekTo(next)
  }, [speechRegions, currentTime, seekTo])

  const prevSegment = useCallback(() => {
    const prev = findPrevSegment(speechRegions, currentTime)
    if (prev != null) seekTo(prev)
  }, [speechRegions, currentTime, seekTo])

  useEffect(() => {
    setSkipSilence(true)
    setEnhanced(false)
    setEnhancing(false)
    setCurrentTime(0)
    setDuration(0)
  }, [entryId])

  useEffect(() => {
    if (!analysis && entryId && onRequestAnalysis) {
      onRequestAnalysis()
    }
  }, [analysis, entryId, onRequestAnalysis])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onMeta = () => setDuration(audio.duration || 0)
    const onTime = () => {
      const t = audio.currentTime
      setCurrentTime(t)
      if (!skipSilence || skipLock.current) return
      const jump = skipIfSilent(t)
      if (jump != null && Math.abs(jump - t) > 0.1) {
        skipLock.current = true
        audio.currentTime = jump
        setCurrentTime(jump)
        requestAnimationFrame(() => {
          skipLock.current = false
        })
      }
    }
    const onPlay = () => {
      if (!skipSilence) return
      const jump = skipIfSilent(audio.currentTime)
      if (jump != null && Math.abs(jump - audio.currentTime) > 0.1) {
        audio.currentTime = jump
        setCurrentTime(jump)
      }
    }

    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
    }
  }, [audioRef, skipSilence, skipIfSilent, entryId, enhanced])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !entryId) return
    const base = `/api/entries/${encodeURIComponent(entryId)}/media`
    const nextSrc = enhanced ? `${base}?variant=enhanced` : base
    setEnhancing(enhanced)
    audio.src = nextSrc
    const onCanPlay = () => setEnhancing(false)
    const onErr = () => setEnhancing(false)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onErr)
    audio.load()
    return () => {
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onErr)
    }
  }, [audioRef, entryId, enhanced])

  return {
    skipSilence,
    setSkipSilence,
    enhanced,
    setEnhanced,
    enhancing,
    currentTime,
    duration,
    activeSpeechIndex,
    speechDurationLabel,
    totalDurationLabel,
    seekTo,
    nextSegment,
    prevSegment,
    skipIfSilent,
  }
}

export { formatDuration, speechDuration, regionAt, findNextSegment }
