import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { AlephMaterial } from '../AlephMaterial'
import { GlbNode } from '../GlbNode'
import { isNodeActive, nodeColor, pickNode } from '../nodeState'
import { nodesForBand } from '../sceneGraph'
import { useAlephUi } from '../store'
import type { SceneNode } from '../types'

function Cells({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const spots: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.018, 0.006, -0.01],
    [-0.016, -0.004, 0.012],
    [0.008, -0.014, 0.008],
    [-0.01, 0.012, -0.006],
    [0.004, 0.002, 0.016],
  ]
  return (
    <group onClick={pickNode(node.id)}>
      {spots.map((p, i) => (
        <mesh key={i} position={p}>
          <icosahedronGeometry args={[0.007 + (i % 3) * 0.0015, 1]} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  )
}

function Bacteria({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const ref = useRef<Group>(null)
  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = state.clock.elapsedTime * 0.35
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.2
  })
  const rods: Array<[number, number, number]> = [
    [0.02, 0.004, 0.008],
    [-0.018, -0.006, 0.01],
    [0.006, 0.012, -0.014],
    [-0.008, -0.01, -0.008],
  ]
  return (
    <group ref={ref} onClick={pickNode(node.id)}>
      {rods.map((p, i) => (
        <mesh key={i} position={p} rotation={[0.4 * i, 0.7 * i, 0.2]}>
          <capsuleGeometry args={[0.0018, 0.007, 4, 8]} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
            emissive="#3a5a28"
          />
        </mesh>
      ))}
    </group>
  )
}

export function MicroLayer() {
  const ui = useAlephUi()
  return (
    <group>
      {nodesForBand('micro').map((node) => {
        if (!isNodeActive(node, ui)) return null
        const selected = ui.selectedId === node.id
        if (node.kind === 'glb' && node.url) {
          return <GlbNode key={node.id} node={node} />
        }
        if (node.procedural === 'cells') {
          return <Cells key={node.id} node={node} selected={selected} />
        }
        if (node.procedural === 'bacteria') {
          return <Bacteria key={node.id} node={node} selected={selected} />
        }
        return null
      })}
    </group>
  )
}
