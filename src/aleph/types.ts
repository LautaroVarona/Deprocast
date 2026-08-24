export type LodBand =
  | 'cosmic'
  | 'planet'
  | 'landscape'
  | 'body'
  | 'organ'
  | 'tissue'
  | 'micro'

export type AnatomySystem =
  | 'nervous'
  | 'cardiovascular'
  | 'endocrine'
  | 'respiratory'
  | 'digestive'
  | 'skeletal'
  | 'lymphatic'
  | 'integumentary'

export type RenderMode = 'solid' | 'xray' | 'wireframe'

export type SceneNodeKind = 'procedural' | 'glb'

export type ProceduralKind =
  | 'stars'
  | 'earth'
  | 'mercury'
  | 'rivers'
  | 'forest'
  | 'paths'
  | 'skin'
  | 'skeleton'
  | 'heart'
  | 'brain'
  | 'neurons'
  | 'lungs'
  | 'liver'
  | 'stomach'
  | 'kidneys'
  | 'thyroid'
  | 'pituitary'
  | 'adrenals'
  | 'pancreas'
  | 'vessels'
  | 'spine'
  | 'lymph'
  | 'cells'
  | 'bacteria'

export interface SceneNode {
  id: string
  label: string
  kind: SceneNodeKind
  procedural?: ProceduralKind
  lod: LodBand[]
  systems: AnatomySystem[]
  color: string
  /** Fase 2: ruta pública a un .glb / .gltf */
  url?: string
}

export interface EegBands {
  delta: number
  theta: number
  alpha: number
  beta: number
  gamma: number
}

export interface BiometricTelemetry {
  bpm: number
  eeg: EegBands
}

export interface NodeOverride {
  color?: string
  visible?: boolean
}

export interface LodState {
  band: LodBand
  distance: number
  log10: number
}

export interface AlephUiState {
  systems: Record<AnatomySystem, boolean>
  renderMode: RenderMode
  selectedId: string | null
  overrides: Record<string, NodeOverride>
  telemetry: BiometricTelemetry
  requestedDistance: number | null
}
