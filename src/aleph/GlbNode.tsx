import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import { selectNode } from './store'
import type { SceneNode } from './types'

export function GlbNode({ node }: { node: SceneNode }) {
  const gltf = useGLTF(node.url!)
  const object = useMemo(() => gltf.scene.clone(true), [gltf.scene])

  return (
    <primitive
      object={object}
      onClick={(event: { stopPropagation: () => void }) => {
        event.stopPropagation()
        selectNode(node.id)
      }}
    />
  )
}
