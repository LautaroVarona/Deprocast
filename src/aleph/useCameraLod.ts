import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { bandFromDistance } from './lod'
import { getAlephLod, setAlephLod } from './store'

const HUD_MS = 120

/** Actualiza la banda al cruzarla; el HUD de distancia se refresca ~8 Hz. */
export function useCameraLod() {
  const lastHud = useRef(0)
  const lastBand = useRef(getAlephLod().band)

  useFrame(({ camera }) => {
    const distance = camera.position.length()
    const band = bandFromDistance(distance)
    const now = performance.now()
    const crossed = band !== lastBand.current
    if (!crossed && now - lastHud.current < HUD_MS) return
    lastBand.current = band
    lastHud.current = now
    setAlephLod({
      band,
      distance,
      log10: Math.log10(Math.max(distance, 1e-8)),
    })
  })
}
