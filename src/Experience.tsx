import { OrbitControls, MeshReflectorMaterial } from '@react-three/drei'
import { EffectComposer, SSAO, Bloom, SMAA } from '@react-three/postprocessing'
import GpgpuParticleSystem from './GpgpuParticleSystem'

export default function Experience() {
  return (
    <>
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#050505', 10, 25]} />

      <OrbitControls makeDefault maxDistance={30} minDistance={5} autoRotate autoRotateSpeed={-0.1} />

      <EffectComposer>
        <SSAO
          blendFunction={0} // BlendFunction.MULTIPLY
          samples={30}
          rings={4}
          distanceThreshold={1.0}
          distanceFalloff={0.0}
          rangeThreshold={0.5}
          rangeFalloff={0.1}
          luminanceInfluence={0.9}
          radius={20}
          scale={0.6}
          bias={0.5}
        />
        <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0} kernelSize={3} />
        <SMAA />
      </EffectComposer>

      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 5]} intensity={1.5} color="#ffffff" />
      <pointLight position={[-10, -10, -5]} intensity={1.0} color="#ff0000" />

      <GpgpuParticleSystem />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[50, 50]} />
        <MeshReflectorMaterial
          resolution={512}
          args={[50, 50]}
          mirror={1}
          mixBlur={10}
          mixStrength={1.5}
          rotation={[-Math.PI / 2, 0, Math.PI / 2]}
          blur={[400, 100]}
          color="#151515"
          metalness={0.9}
          roughness={0.6}
        />
      </mesh>
    </>
  )
}