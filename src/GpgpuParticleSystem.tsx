import { useFBO, createPortal } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

// Shader to update particle positions
const simulationVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const simulationFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uOriginalPositions;
  uniform vec3 uMouse;
  uniform float uTime;

  // 2D Random
  float random (vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  // 2D Noise
  float noise (vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec3 originalPos = texture2D(uOriginalPositions, vUv).xyz;

    // Displace particles using noise for organic movement
    float n = noise(originalPos.xy * 0.5 + uTime * 0.1);
    vec3 displacedPos = originalPos + vec3(
      cos(uTime * 0.2 + originalPos.x * 2.0) * n * 0.5,
      sin(uTime * 0.3 + originalPos.y * 2.0) * n * 0.5,
      cos(uTime * 0.4 + originalPos.z * 2.0) * n * 0.5
    );

    // Mouse interaction: push particles away
    float dist = distance(displacedPos, uMouse);
    if (dist < 1.5) {
      vec3 dir = normalize(displacedPos - uMouse);
      displacedPos += dir * (1.5 - dist) * 0.5;
    }

    gl_FragColor = vec4(displacedPos, 1.0);
  }
`

// Shader to render the particles
const particleVertexShader = `
  uniform sampler2D uPositions;
  uniform float uSize;
  void main() {
    vec3 pos = texture2D(uPositions, position.xy).xyz;
    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * (1.0 / -viewPosition.z);
  }
`

const particleFragmentShader = `
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
    gl_FragColor = vec4(vec3(0.2, 0.5, 1.0) * alpha, alpha);
  }
`

const SIZE = 256 // Reduced size for stability

export default function GpgpuParticleSystem() {
  const { viewport } = useThree()
  const renderMaterialRef = useRef<THREE.ShaderMaterial>(null!)

  const scene = useMemo(() => new THREE.Scene(), [])
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1), [])

  const originalPositions = useMemo(() => {
    const arr = new Float32Array(SIZE * SIZE * 4)
    for (let i = 0; i < SIZE * SIZE; i++) {
      arr[i * 4 + 0] = (Math.random() - 0.5) * 10
      arr[i * 4 + 1] = (Math.random() - 0.5) * 10
      arr[i * 4 + 2] = (Math.random() - 0.5) * 10
      arr[i * 4 + 3] = Math.random()
    }
    const texture = new THREE.DataTexture(arr, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType)
    texture.needsUpdate = true
    return texture
  }, [])

  const rtt = useFBO(SIZE, SIZE, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
  })

  const particles = useMemo(() => {
    const p = new Float32Array(SIZE * SIZE * 3)
    for (let i = 0; i < SIZE * SIZE; i++) {
      p[i * 3 + 0] = (i % SIZE) / SIZE
      p[i * 3 + 1] = Math.floor(i / SIZE) / SIZE
    }
    return new THREE.BufferAttribute(p, 3)
  }, [])

  useFrame((state) => {
    const { gl, clock, pointer } = state

    // Run the simulation pass
    gl.setRenderTarget(rtt)
    gl.clear()
    const simMaterial = scene.children[0].material as THREE.ShaderMaterial
    simMaterial.uniforms.uTime.value = clock.elapsedTime
    simMaterial.uniforms.uMouse.value.set(
      pointer.x * (viewport.width / 2),
      pointer.y * (viewport.height / 2),
      0
    )
    gl.render(scene, camera)
    gl.setRenderTarget(null)

    // Update the render material with the new positions
    if (renderMaterialRef.current) {
      renderMaterialRef.current.uniforms.uPositions.value = rtt.texture
    }
  })

  return (
    <>
      {createPortal(
        <mesh>
          <planeGeometry args={[2, 2]} />
          <shaderMaterial
            vertexShader={simulationVertexShader}
            fragmentShader={simulationFragmentShader}
            uniforms={{
              uOriginalPositions: { value: originalPositions },
              uTime: { value: 0 },
              uMouse: { value: new THREE.Vector3() },
            }}
          />
        </mesh>,
        scene
      )}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" {...particles} />
        </bufferGeometry>
        <shaderMaterial
          ref={renderMaterialRef}
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={{
            uPositions: { value: null },
            uSize: { value: 25.0 },
          }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  )
}