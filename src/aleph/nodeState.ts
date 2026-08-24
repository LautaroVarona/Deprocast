import type { ThreeEvent } from '@react-three/fiber'
import { selectNode } from './store'
import type { AlephUiState, SceneNode } from './types'

export function isNodeActive(node: SceneNode, ui: AlephUiState): boolean {
  if (ui.overrides[node.id]?.visible === false) return false
  if (node.systems.length === 0) return true
  return node.systems.some((sys) => ui.systems[sys])
}

export function nodeColor(node: SceneNode, ui: AlephUiState): string {
  return ui.overrides[node.id]?.color ?? node.color
}

export function pickNode(id: string) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    selectNode(id)
  }
}
