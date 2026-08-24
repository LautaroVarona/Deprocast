import { useEffect, useRef, type ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { clampCameraDistance } from './lod'
import { getAlephUi, requestDistance } from './store'

const WHEEL_GAIN = 0.00145

export function LogZoomControls() {
  const { camera, gl } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)

  useEffect(() => {
    const el = gl.domElement
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (getAlephUi().requestedDistance != null) requestDistance(null)
      const factor = Math.exp(event.deltaY * WHEEL_GAIN)
      camera.position.setLength(
        clampCameraDistance(camera.position.length() * factor),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [camera, gl])

  useFrame(() => {
    const d = camera.position.length()
    camera.near = Math.max(d / 600, 0.00008)
    camera.far = Math.max(d * 90, 80)
    camera.updateProjectionMatrix()

    const ctrl = controls.current
    if (ctrl) {
      ctrl.panSpeed = Math.min(1.4, Math.max(0.12, d / 50))
    }

    const wanted = getAlephUi().requestedDistance
    if (wanted == null) return
    const target = clampCameraDistance(wanted)
    const next = d + (target - d) * 0.16
    if (Math.abs(next - target) < Math.max(0.0004, target * 0.01)) {
      camera.position.setLength(target)
      requestDistance(null)
    } else {
      camera.position.setLength(clampCameraDistance(next))
    }
  })

  return (
    <OrbitControls
      ref={controls}
      enableZoom={false}
      enablePan
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI - 0.08}
      makeDefault
      target={[0, 0, 0]}
    />
  )
}
