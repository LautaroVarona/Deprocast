import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_CAMERA_DISTANCE, bandFromDistance } from './lod'
import { defaultSystems } from './systems'
import { DEFAULT_TELEMETRY, clamp01, clampBpm } from './telemetry'
import type {
  AlephUiState,
  AnatomySystem,
  LodState,
  NodeOverride,
  RenderMode,
} from './types'

type Listener = () => void

const uiListeners = new Set<Listener>()
const lodListeners = new Set<Listener>()

let ui: AlephUiState = {
  systems: defaultSystems(),
  renderMode: 'solid',
  selectedId: null,
  overrides: {},
  telemetry: DEFAULT_TELEMETRY,
  requestedDistance: null,
}

let lod: LodState = {
  band: bandFromDistance(DEFAULT_CAMERA_DISTANCE),
  distance: DEFAULT_CAMERA_DISTANCE,
  log10: Math.log10(DEFAULT_CAMERA_DISTANCE),
}

function emitUi() {
  uiListeners.forEach((l) => l())
}

function emitLod() {
  lodListeners.forEach((l) => l())
}

export function getAlephUi(): AlephUiState {
  return ui
}

export function getAlephLod(): LodState {
  return lod
}

export function setAlephUi(patch: Partial<AlephUiState>) {
  ui = { ...ui, ...patch }
  emitUi()
}

export function patchSystems(id: AnatomySystem, on: boolean) {
  ui = { ...ui, systems: { ...ui.systems, [id]: on } }
  emitUi()
}

export function setRenderMode(mode: RenderMode) {
  ui = { ...ui, renderMode: mode }
  emitUi()
}

export function selectNode(id: string | null) {
  ui = { ...ui, selectedId: id }
  emitUi()
}

export function patchOverride(id: string, patch: NodeOverride) {
  const prev = ui.overrides[id] ?? {}
  ui = {
    ...ui,
    overrides: { ...ui.overrides, [id]: { ...prev, ...patch } },
  }
  emitUi()
}

export function setBpm(bpm: number) {
  ui = {
    ...ui,
    telemetry: { ...ui.telemetry, bpm: clampBpm(bpm) },
  }
  emitUi()
}

export function setEegBand(band: keyof AlephUiState['telemetry']['eeg'], value: number) {
  ui = {
    ...ui,
    telemetry: {
      ...ui.telemetry,
      eeg: { ...ui.telemetry.eeg, [band]: clamp01(value) },
    },
  }
  emitUi()
}

export function requestDistance(distance: number | null) {
  ui = { ...ui, requestedDistance: distance }
  emitUi()
}

export function setAlephLod(next: LodState) {
  if (
    lod.band === next.band &&
    lod.distance === next.distance &&
    lod.log10 === next.log10
  ) {
    return
  }
  lod = next
  emitLod()
}

function subscribeUi(listener: Listener) {
  uiListeners.add(listener)
  return () => {
    uiListeners.delete(listener)
  }
}

function subscribeLod(listener: Listener) {
  lodListeners.add(listener)
  return () => {
    lodListeners.delete(listener)
  }
}

export function useAlephUi(): AlephUiState {
  return useSyncExternalStore(subscribeUi, getAlephUi, getAlephUi)
}

export function useAlephLod(): LodState {
  return useSyncExternalStore(subscribeLod, getAlephLod, getAlephLod)
}

export function useLodBand() {
  return useSyncExternalStore(
    subscribeLod,
    () => getAlephLod().band,
    () => getAlephLod().band,
  )
}

export function useSelectedId() {
  return useSyncExternalStore(
    subscribeUi,
    () => getAlephUi().selectedId,
    () => getAlephUi().selectedId,
  )
}

export function useResetAleph() {
  return useCallback(() => {
    ui = {
      systems: defaultSystems(),
      renderMode: 'solid',
      selectedId: null,
      overrides: {},
      telemetry: DEFAULT_TELEMETRY,
      requestedDistance: DEFAULT_CAMERA_DISTANCE,
    }
    emitUi()
  }, [])
}
