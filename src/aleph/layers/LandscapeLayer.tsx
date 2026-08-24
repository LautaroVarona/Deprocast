import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  CatmullRomCurve3,
  ConeGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  TubeGeometry,
  Vector3,
} from 'three'
import { AlephMaterial } from '../AlephMaterial'
import { GlbNode } from '../GlbNode'
import { isNodeActive, nodeColor, pickNode } from '../nodeState'
import { nodesForBand } from '../sceneGraph'
import { useAlephUi } from '../store'
import type { SceneNode } from '../types'

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[520, 520, 1, 1]} />
      <meshStandardMaterial color="#1e2a1c" roughness={0.95} />
    </mesh>
  )
}

function RiverMesh({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const geom = useMemo(() => {
    const curve = new CatmullRomCurve3([
      new Vector3(-110, 0.6, -80),
      new Vector3(-50, 0.55, -18),
      new Vector3(8, 0.5, 16),
      new Vector3(48, 0.55, 52),
      new Vector3(118, 0.6, 28),
    ])
    return new TubeGeometry(curve, 80, 3.1, 10, false)
  }, [])

  useEffect(() => () => geom.dispose(), [geom])

  return (
    <mesh geometry={geom} onClick={pickNode(node.id)}>
      <AlephMaterial
        color={nodeColor(node, ui)}
        renderMode={ui.renderMode}
        selected={selected}
        roughness={0.22}
        metalness={0.18}
      />
    </mesh>
  )
}

function PathMesh({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const geom = useMemo(() => {
    const curve = new CatmullRomCurve3([
      new Vector3(-40, 0.35, 90),
      new Vector3(-10, 0.35, 40),
      new Vector3(12, 0.4, -10),
      new Vector3(70, 0.35, -60),
    ])
    return new TubeGeometry(curve, 48, 1.15, 6, false)
  }, [])
  useEffect(() => () => geom.dispose(), [geom])

  return (
    <mesh geometry={geom} onClick={pickNode(node.id)}>
      <AlephMaterial
        color={nodeColor(node, ui)}
        renderMode={ui.renderMode}
        selected={selected}
        roughness={0.9}
      />
    </mesh>
  )
}

function ForestMesh({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const count = 72
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const geom = useMemo(() => new ConeGeometry(2.4, 9.5, 6), [])
  const mat = useMemo(() => {
    return new MeshStandardMaterial({
      color,
      roughness: 0.85,
      emissive: selected ? '#c4a35a' : '#000000',
      emissiveIntensity: selected ? 0.4 : 0,
    })
  }, [color, selected])

  useLayoutEffect(() => {
    const inst = mesh.current
    if (!inst) return
    for (let i = 0; i < count; i += 1) {
      const col = i % 9
      const row = Math.floor(i / 9)
      const x = col * 22 - 88 + ((i * 17) % 9) - 4
      const z = row * 22 - 80 + ((i * 11) % 13) - 6
      dummy.position.set(x, 4.7, z)
      dummy.scale.setScalar(0.75 + (i % 6) * 0.1)
      dummy.rotation.set(0, (i * 0.7) % Math.PI, 0)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
  }, [count, dummy])

  useEffect(
    () => () => {
      geom.dispose()
      mat.dispose()
    },
    [geom, mat],
  )

  return (
    <instancedMesh
      ref={mesh}
      args={[geom, mat, count]}
      onClick={pickNode(node.id)}
    />
  )
}

export function LandscapeLayer() {
  const ui = useAlephUi()
  return (
    <group>
      <Ground />
      {nodesForBand('landscape').map((node) => {
        if (!isNodeActive(node, ui)) return null
        const selected = ui.selectedId === node.id
        if (node.kind === 'glb' && node.url) {
          return <GlbNode key={node.id} node={node} />
        }
        if (node.procedural === 'rivers') {
          return <RiverMesh key={node.id} node={node} selected={selected} />
        }
        if (node.procedural === 'paths') {
          return <PathMesh key={node.id} node={node} selected={selected} />
        }
        if (node.procedural === 'forest') {
          return <ForestMesh key={node.id} node={node} selected={selected} />
        }
        return null
      })}
    </group>
  )
}
