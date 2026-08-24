import { Canvas } from '@react-three/fiber'
import { LogZoomControls } from './LogZoomControls'
import { CosmicLayer } from './layers/CosmicLayer'
import { HumanLayer } from './layers/HumanLayer'
import { LandscapeLayer } from './layers/LandscapeLayer'
import { MicroLayer } from './layers/MicroLayer'
import { selectNode, useLodBand } from './store'
import { useCameraLod } from './useCameraLod'

function SceneRig() {
  useCameraLod()
  const band = useLodBand()
  return (
    <>
      <LogZoomControls />
      {(band === 'cosmic' || band === 'planet') && <CosmicLayer band={band} />}
      {band === 'landscape' && <LandscapeLayer />}
      {(band === 'body' || band === 'organ' || band === 'tissue') && (
        <HumanLayer band={band} />
      )}
      {band === 'micro' && <MicroLayer />}
    </>
  )
}

export function UniverseEngine() {
  return (
    <Canvas
      camera={{
        position: [14, 9, 22],
        fov: 50,
        near: 0.02,
        far: 4000,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }}
      dpr={[1, 1.75]}
      onPointerMissed={() => selectNode(null)}
    >
      <color attach="background" args={['#07090c']} />
      <ambientLight intensity={0.34} />
      <hemisphereLight args={['#c8d4e0', '#1a1814', 0.3]} />
      <directionalLight
        position={[12, 18, 9]}
        intensity={1.15}
        color="#fff6e8"
      />
      <pointLight position={[-14, 7, -9]} intensity={0.38} color="#7a9ec4" />
      <SceneRig />
    </Canvas>
  )
}
