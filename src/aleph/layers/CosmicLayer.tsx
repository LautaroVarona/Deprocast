import { Stars } from '@react-three/drei'
import { AlephMaterial } from '../AlephMaterial'
import { GlbNode } from '../GlbNode'
import { nodesForBand } from '../sceneGraph'
import { isNodeActive, nodeColor, pickNode } from '../nodeState'
import { useAlephUi } from '../store'
import type { LodBand, SceneNode } from '../types'

function EarthGlobe({
  node,
  radius,
  selected,
}: {
  node: SceneNode
  radius: number
  selected: boolean
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  return (
    <group onClick={pickNode(node.id)}>
      <mesh>
        <sphereGeometry args={[radius, 48, 32]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          roughness={0.7}
        />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[radius, 32, 24]} />
        <meshStandardMaterial
          color="#8ec8ff"
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[radius * 0.35, radius * 0.15, radius * 0.55]} scale={[0.55, 0.28, 0.4]}>
        <sphereGeometry args={[radius * 0.42, 16, 12]} />
        <meshStandardMaterial color="#3d6b3a" roughness={0.9} />
      </mesh>
      <mesh position={[-radius * 0.45, radius * 0.05, -radius * 0.2]} scale={[0.4, 0.22, 0.5]}>
        <sphereGeometry args={[radius * 0.38, 16, 12]} />
        <meshStandardMaterial color="#4a7a42" roughness={0.9} />
      </mesh>
      <mesh position={[radius * 0.1, -radius * 0.55, radius * 0.15]} scale={[0.35, 0.18, 0.35]}>
        <sphereGeometry args={[radius * 0.32, 12, 10]} />
        <meshStandardMaterial color="#d8d4cc" roughness={0.85} />
      </mesh>
    </group>
  )
}

function MercuryGlobe({
  node,
  radius,
  position,
  selected,
}: {
  node: SceneNode
  radius: number
  position: [number, number, number]
  selected: boolean
}) {
  const ui = useAlephUi()
  return (
    <mesh position={position} onClick={pickNode(node.id)}>
      <sphereGeometry args={[radius, 32, 24]} />
      <AlephMaterial
        color={nodeColor(node, ui)}
        renderMode={ui.renderMode}
        selected={selected}
        roughness={0.85}
        metalness={0.15}
      />
    </mesh>
  )
}

export function CosmicLayer({ band }: { band: LodBand }) {
  const ui = useAlephUi()
  const planet = band === 'planet'
  const earthR = planet ? 380 : 72
  const mercuryR = planet ? 88 : 24
  const mercuryPos: [number, number, number] = planet
    ? [920, 40, -180]
    : [210, 18, -40]

  return (
    <group>
      {nodesForBand(band).map((node) => {
        if (!isNodeActive(node, ui)) return null
        const selected = ui.selectedId === node.id
        if (node.kind === 'glb' && node.url) {
          return <GlbNode key={node.id} node={node} />
        }
        if (node.procedural === 'stars') {
          return (
            <group key={node.id} onClick={pickNode(node.id)}>
              <Stars
                radius={planet ? 18000 : 42000}
                depth={planet ? 2500 : 9000}
                count={planet ? 2500 : 5200}
                factor={planet ? 12 : 28}
                saturation={0}
                fade
                speed={0.2}
              />
            </group>
          )
        }
        if (node.procedural === 'earth') {
          return (
            <EarthGlobe
              key={node.id}
              node={node}
              radius={earthR}
              selected={selected}
            />
          )
        }
        if (node.procedural === 'mercury') {
          return (
            <MercuryGlobe
              key={node.id}
              node={node}
              radius={mercuryR}
              position={mercuryPos}
              selected={selected}
            />
          )
        }
        return null
      })}
    </group>
  )
}
