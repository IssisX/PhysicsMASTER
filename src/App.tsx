import { Canvas } from '@react-three/fiber'
import Experience from './Experience.tsx'
import * as THREE from 'three'
import { Leva } from 'leva'

function App() {
  return (
    <>
      <Leva collapsed />
      <Canvas
        shadows
        camera={{
          fov: 45,
          near: 0.1,
          far: 200,
          position: [-4, 3, 6],
        }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
      >
        <Experience />
      </Canvas>
    </>
  )
}

export default App