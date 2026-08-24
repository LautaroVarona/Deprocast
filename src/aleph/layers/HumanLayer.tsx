import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Points } from 'three'
import { AlephMaterial } from '../AlephMaterial'
import { GlbNode } from '../GlbNode'
import { isNodeActive, nodeColor, pickNode } from '../nodeState'
import { nodesForBand } from '../sceneGraph'
import { getAlephUi, useAlephUi } from '../store'
import { EEG_HZ } from '../telemetry'
import type { LodBand, RenderMode, SceneNode } from '../types'

function organOpacity(band: LodBand, renderMode: RenderMode): number | undefined {
  if (renderMode === 'xray') return 0.3
  if (band === 'body') return 0.92
  return undefined
}

function Limb({
  position,
  rotation,
  args,
  color,
  renderMode,
  selected,
  opacity,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  args: [number, number, number, number]
  color: string
  renderMode: RenderMode
  selected: boolean
  opacity?: number
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <capsuleGeometry args={args} />
      <AlephMaterial
        color={color}
        renderMode={renderMode}
        selected={selected}
        opacity={opacity}
      />
    </mesh>
  )
}

function SkinFigure({
  node,
  band,
  selected,
}: {
  node: SceneNode
  band: LodBand
  selected: boolean
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const op =
    band === 'organ' || band === 'tissue'
      ? 0.1
      : ui.renderMode === 'xray'
        ? 0.18
        : 0.88
  return (
    <group onClick={pickNode(node.id)}>
      <mesh position={[0, 3.15, 0]}>
        <sphereGeometry args={[0.58, 28, 20]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={op}
        />
      </mesh>
      <mesh position={[0, 2.48, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.38, 12]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={op}
        />
      </mesh>
      <Limb
        position={[0, 1.15, 0]}
        args={[0.72, 1.55, 6, 12]}
        color={color}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={op}
      />
      <Limb
        position={[-1.15, 1.35, 0]}
        rotation={[0, 0, 0.35]}
        args={[0.2, 1.35, 4, 10]}
        color={color}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={op}
      />
      <Limb
        position={[1.15, 1.35, 0]}
        rotation={[0, 0, -0.35]}
        args={[0.2, 1.35, 4, 10]}
        color={color}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={op}
      />
      <Limb
        position={[-0.42, -1.55, 0]}
        args={[0.26, 2.1, 4, 10]}
        color={color}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={op}
      />
      <Limb
        position={[0.42, -1.55, 0]}
        args={[0.26, 2.1, 4, 10]}
        color={color}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={op}
      />
    </group>
  )
}

function Skeleton({
  node,
  selected,
}: {
  node: SceneNode
  selected: boolean
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const bones: Array<{
    p: [number, number, number]
    r?: [number, number, number]
    a: [number, number, number, number]
  }> = [
    { p: [0, 1.2, 0], a: [0.18, 1.7, 3, 8] },
    { p: [-0.42, -1.5, 0], a: [0.12, 2.05, 3, 8] },
    { p: [0.42, -1.5, 0], a: [0.12, 2.05, 3, 8] },
    { p: [-1.1, 1.4, 0], r: [0, 0, 0.35], a: [0.09, 1.3, 3, 8] },
    { p: [1.1, 1.4, 0], r: [0, 0, -0.35], a: [0.09, 1.3, 3, 8] },
  ]
  return (
    <group onClick={pickNode(node.id)}>
      {bones.map((b, i) => (
        <mesh key={i} position={b.p} rotation={b.r}>
          <capsuleGeometry args={b.a} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
          />
        </mesh>
      ))}
    </group>
  )
}

function Spine({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  return (
    <group onClick={pickNode(node.id)}>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[0, 2.4 - i * 0.22, -0.28]}>
          <cylinderGeometry args={[0.11, 0.12, 0.16, 8]} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
          />
        </mesh>
      ))}
    </group>
  )
}

function Heart({
  node,
  band,
  selected,
}: {
  node: SceneNode
  band: LodBand
  selected: boolean
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const bpm = getAlephUi().telemetry.bpm
    const phase = (state.clock.elapsedTime * bpm) / 60
    const lub = Math.pow(Math.abs(Math.sin(phase * Math.PI * 2)), 7)
    const dub = Math.pow(Math.abs(Math.sin(phase * Math.PI * 2 + 0.38)), 10) * 0.45
    const s = 1 + (lub + dub) * 0.14
    ref.current?.scale.setScalar(s)
  })
  return (
    <group
      ref={ref}
      position={[-0.38, 0.42, 0.48]}
      onClick={pickNode(node.id)}
    >
      <mesh>
        <sphereGeometry args={[0.42, 24, 18]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
          emissive="#6a2018"
        />
      </mesh>
      <mesh position={[0.22, 0.14, 0.02]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
        />
      </mesh>
    </group>
  )
}

function Brain({
  node,
  band,
  selected,
}: {
  node: SceneNode
  band: LodBand
  selected: boolean
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const { eeg } = getAlephUi().telemetry
    const t = state.clock.elapsedTime
    const wave =
      eeg.alpha * Math.sin(t * EEG_HZ.alpha) +
      eeg.beta * Math.sin(t * EEG_HZ.beta) * 0.6
    const s = 1 + wave * 0.025
    ref.current?.scale.setScalar(s)
  })
  return (
    <group ref={ref} position={[0, 3.18, 0.05]} onClick={pickNode(node.id)}>
      <mesh position={[-0.28, 0, 0]}>
        <sphereGeometry args={[0.38, 20, 16]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
        />
      </mesh>
      <mesh position={[0.28, 0, 0]}>
        <sphereGeometry args={[0.38, 20, 16]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
        />
      </mesh>
    </group>
  )
}

function Neurons({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const count = 520
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const u = Math.random()
      const v = Math.random()
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      const r = 0.42 + Math.random() * 0.32
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = 3.18 + r * Math.cos(phi) * 0.65
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    return arr
  }, [])
  const base = useMemo(() => positions.slice(), [positions])
  const ref = useRef<Points>(null)

  useFrame((state) => {
    const pts = ref.current
    if (!pts) return
    const attr = pts.geometry.getAttribute('position')
    const { eeg } = getAlephUi().telemetry
    const t = state.clock.elapsedTime
    const amp =
      eeg.delta * 0.018 +
      eeg.theta * 0.028 +
      eeg.alpha * 0.05 +
      eeg.beta * 0.03 +
      eeg.gamma * 0.022
    const freq =
      eeg.delta * EEG_HZ.delta +
      eeg.theta * EEG_HZ.theta +
      eeg.alpha * EEG_HZ.alpha +
      eeg.beta * EEG_HZ.beta +
      eeg.gamma * EEG_HZ.gamma
    for (let i = 0; i < count; i += 1) {
      const wobble = Math.sin(t * freq * 0.12 + i * 0.41) * amp
      attr.setXYZ(
        i,
        base[i * 3] * (1 + wobble),
        base[i * 3 + 1] + wobble * 0.35,
        base[i * 3 + 2] * (1 + wobble),
      )
    }
    attr.needsUpdate = true
  })

  return (
    <points ref={ref} onClick={pickNode(node.id)}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={selected ? 0.045 : 0.03}
        color={color}
        sizeAttenuation
        transparent
        opacity={0.9}
      />
    </points>
  )
}

function PairOrgans({
  node,
  band,
  selected,
  left,
  right,
  radius,
}: {
  node: SceneNode
  band: LodBand
  selected: boolean
  left: [number, number, number]
  right: [number, number, number]
  radius: number
}) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  return (
    <group onClick={pickNode(node.id)}>
      <mesh position={left}>
        <sphereGeometry args={[radius, 18, 14]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
        />
      </mesh>
      <mesh position={right}>
        <sphereGeometry args={[radius, 18, 14]} />
        <AlephMaterial
          color={color}
          renderMode={ui.renderMode}
          selected={selected}
          opacity={organOpacity(band, ui.renderMode)}
        />
      </mesh>
    </group>
  )
}

function SingleOrgan({
  node,
  band,
  selected,
  position,
  scale,
  radius = 0.28,
}: {
  node: SceneNode
  band: LodBand
  selected: boolean
  position: [number, number, number]
  scale?: [number, number, number]
  radius?: number
}) {
  const ui = useAlephUi()
  return (
    <mesh
      position={position}
      scale={scale}
      onClick={pickNode(node.id)}
    >
      <sphereGeometry args={[radius, 18, 14]} />
      <AlephMaterial
        color={nodeColor(node, ui)}
        renderMode={ui.renderMode}
        selected={selected}
        opacity={organOpacity(band, ui.renderMode)}
      />
    </mesh>
  )
}

function Vessels({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const segs: Array<{
    p: [number, number, number]
    r: [number, number, number]
    h: number
  }> = [
    { p: [0, 0.9, 0.15], r: [0, 0, 0], h: 1.6 },
    { p: [-0.7, 0.55, 0.2], r: [0, 0, 1.05], h: 1.1 },
    { p: [0.7, 0.55, 0.2], r: [0, 0, -1.05], h: 1.1 },
    { p: [0, -0.6, 0.1], r: [0.15, 0, 0], h: 1.4 },
  ]
  return (
    <group onClick={pickNode(node.id)}>
      {segs.map((s, i) => (
        <mesh key={i} position={s.p} rotation={s.r}>
          <cylinderGeometry args={[0.045, 0.055, s.h, 8]} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
            emissive="#5a1818"
          />
        </mesh>
      ))}
    </group>
  )
}

function Lymph({ node, selected }: { node: SceneNode; selected: boolean }) {
  const ui = useAlephUi()
  const color = nodeColor(node, ui)
  const spots: Array<[number, number, number]> = [
    [-0.55, 2.15, 0.2],
    [0.55, 2.15, 0.2],
    [-0.7, 0.2, 0.15],
    [0.7, 0.2, 0.15],
    [0, -0.15, 0.25],
  ]
  return (
    <group onClick={pickNode(node.id)}>
      {spots.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.09, 10, 8]} />
          <AlephMaterial
            color={color}
            renderMode={ui.renderMode}
            selected={selected}
            emissive="#2a4a32"
          />
        </mesh>
      ))}
    </group>
  )
}

function Hormone({ position }: { position: [number, number, number] }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    ref.current?.position.setY(position[1] + Math.sin(t * 1.6 + position[0]) * 0.06)
  })
  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial
          color="#e8d090"
          emissive="#c4a35a"
          emissiveIntensity={0.7}
        />
      </mesh>
    </group>
  )
}

export function HumanLayer({ band }: { band: LodBand }) {
  const ui = useAlephUi()
  return (
    <group>
      {nodesForBand(band).map((node) => {
        if (!isNodeActive(node, ui)) return null
        const selected = ui.selectedId === node.id
        if (node.kind === 'glb' && node.url) {
          return <GlbNode key={node.id} node={node} />
        }
        switch (node.procedural) {
          case 'skin':
            return (
              <SkinFigure
                key={node.id}
                node={node}
                band={band}
                selected={selected}
              />
            )
          case 'skeleton':
            return <Skeleton key={node.id} node={node} selected={selected} />
          case 'spine':
            return <Spine key={node.id} node={node} selected={selected} />
          case 'heart':
            return (
              <Heart
                key={node.id}
                node={node}
                band={band}
                selected={selected}
              />
            )
          case 'brain':
            return (
              <Brain
                key={node.id}
                node={node}
                band={band}
                selected={selected}
              />
            )
          case 'neurons':
            return <Neurons key={node.id} node={node} selected={selected} />
          case 'lungs':
            return (
              <PairOrgans
                key={node.id}
                node={node}
                band={band}
                selected={selected}
                left={[-0.62, 0.55, 0.15]}
                right={[0.62, 0.55, 0.15]}
                radius={0.48}
              />
            )
          case 'liver':
            return (
              <SingleOrgan
                key={node.id}
                node={node}
                band={band}
                selected={selected}
                position={[0.55, -0.15, 0.22]}
                scale={[1.3, 0.7, 0.9]}
                radius={0.42}
              />
            )
          case 'stomach':
            return (
              <SingleOrgan
                key={node.id}
                node={node}
                band={band}
                selected={selected}
                position={[-0.25, -0.2, 0.3]}
                scale={[0.9, 0.7, 0.8]}
                radius={0.32}
              />
            )
          case 'kidneys':
            return (
              <PairOrgans
                key={node.id}
                node={node}
                band={band}
                selected={selected}
                left={[-0.48, -0.55, -0.18]}
                right={[0.48, -0.55, -0.18]}
                radius={0.22}
              />
            )
          case 'thyroid':
            return (
              <group key={node.id}>
                <SingleOrgan
                  node={node}
                  band={band}
                  selected={selected}
                  position={[0, 2.42, 0.22]}
                  scale={[1.4, 0.55, 0.6]}
                  radius={0.12}
                />
                <Hormone position={[0.12, 2.55, 0.32]} />
                <Hormone position={[-0.12, 2.52, 0.3]} />
              </group>
            )
          case 'pituitary':
            return (
              <group key={node.id}>
                <SingleOrgan
                  node={node}
                  band={band}
                  selected={selected}
                  position={[0, 3.02, 0.12]}
                  radius={0.08}
                />
                <Hormone position={[0.05, 3.12, 0.18]} />
              </group>
            )
          case 'adrenals':
            return (
              <group key={node.id}>
                <PairOrgans
                  node={node}
                  band={band}
                  selected={selected}
                  left={[-0.48, -0.28, -0.18]}
                  right={[0.48, -0.28, -0.18]}
                  radius={0.1}
                />
                <Hormone position={[-0.48, -0.12, -0.05]} />
                <Hormone position={[0.48, -0.12, -0.05]} />
              </group>
            )
          case 'pancreas':
            return (
              <SingleOrgan
                key={node.id}
                node={node}
                band={band}
                selected={selected}
                position={[0.15, -0.35, 0.12]}
                scale={[1.6, 0.4, 0.5]}
                radius={0.18}
              />
            )
          case 'vessels':
            return <Vessels key={node.id} node={node} selected={selected} />
          case 'lymph':
            return <Lymph key={node.id} node={node} selected={selected} />
          default:
            return null
        }
      })}
    </group>
  )
}
