import type { BiometricTelemetry } from './types'

export const DEFAULT_TELEMETRY: BiometricTelemetry = {
  bpm: 68,
  eeg: {
    delta: 0.15,
    theta: 0.22,
    alpha: 0.55,
    beta: 0.35,
    gamma: 0.12,
  },
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function clampBpm(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TELEMETRY.bpm
  return Math.min(180, Math.max(30, n))
}

/** Frecuencias centrales aproximadas (Hz) para el campo neuronal. */
export const EEG_HZ = {
  delta: 2.5,
  theta: 6,
  alpha: 10,
  beta: 20,
  gamma: 40,
} as const
