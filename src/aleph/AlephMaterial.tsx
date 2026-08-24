import type { RenderMode } from './types'

export function AlephMaterial({
  color,
  renderMode,
  selected = false,
  opacity,
  emissive,
  roughness = 0.52,
  metalness = 0.06,
}: {
  color: string
  renderMode: RenderMode
  selected?: boolean
  opacity?: number
  emissive?: string
  roughness?: number
  metalness?: number
}) {
  const xray = renderMode === 'xray'
  const wire = renderMode === 'wireframe'
  const op = opacity ?? (xray ? 0.28 : 1)
  const glow = selected ? '#c4a35a' : (emissive ?? '#000000')
  return (
    <meshStandardMaterial
      color={color}
      wireframe={wire}
      transparent={op < 0.99}
      opacity={op}
      roughness={roughness}
      metalness={metalness}
      emissive={glow}
      emissiveIntensity={selected ? 0.55 : emissive ? 0.4 : 0}
      depthWrite={op >= 0.95}
    />
  )
}
