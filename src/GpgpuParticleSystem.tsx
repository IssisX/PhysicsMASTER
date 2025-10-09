import { useFBO, createPortal } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const simulationVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const simulationFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uPositions;
  uniform vec3 uMouse;
  uniform float uTime;
  uniform float uDelta;

  // Simple pseudo-random number generator
  float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
  }

  void main() {
    vec4 posTemp = texture2D(uPositions, vUv);
    vec3 pos = posTemp.xyz;
    vec3 vel = posTemp.w > 0.0 ? (pos - texture2D(uPositions, vUv - vec2(0.0, 1.0 / 512.0)).xyz) : vec3(0.0);

    // Verlet integration: apply forces
    vel += vec3(0.0, -0.0005, 0.0); // Gravity

    // Mouse interaction
    float dist = distance(pos, uMouse);
    if (dist < 2.0) {
      vec3 dir = normalize(pos - uMouse);
      vel += dir * ( (2.0 - dist) * 0.01 );
    }

    // Bounce off floor
    if (pos.y < -5.0) {
      pos.y = -5.0;
      vel.y *= -0.8;
    }

    vec3 newPos = pos + vel * uDelta;

    gl_FragColor = vec4(newPos, 1.0);
  }
`

const particleVertexShader = `
  uniform sampler2D uPositions;
  uniform float uSize;
  void main() {
    vec3 pos = texture2D(uPositions, position.xy).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize / -mvPosition.z;
  }
`

const particleFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uSpecularColor;
  uniform float uShininess;

  void main() {
    // Render particle as a lit sphere with PBR-like effects
    vec2 uv = gl_PointCoord.xy - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;

    float alpha = 1.0 - smoothstep(0.45, 0.5, dist);

    // Normal of the sphere-like particle
    vec3 normal = normalize(vec3(uv.x, uv.y, sqrt(1.0 - pow(dist, 2.0))));

    // Lighting (Blinn-Phong)
    vec3 lightDir = normalize(vec3(1.0, 2.0, 3.0));
    vec3 viewDir = normalize(- (modelViewMatrix * vec4(position, 1.0)).xyz);
    vec3 halfwayDir = normalize(lightDir + viewDir);

    // Diffuse
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 diffuseColor = diffuse * uColor;

    // Specular
    float spec = pow(max(dot(normal, halfwayDir), 0.0), uShininess);
    vec3 specularColor = spec * uSpecularColor;

    vec3 finalColor = diffuseColor + specularColor;

    gl_FragColor = vec4(finalColor, alpha);
  }
`

const SIZE = 512

export default function GpgpuParticleSystem() {
  const { viewport } = useThree()
  const pointsRef = useRef<THREE.Points>(null!)
  const simMaterialRef = useRef<THREE.ShaderMaterial>(null!)
  const renderMaterialRef = useRef<THREE.ShaderMaterial>(null!)

  const scene = useMemo(() => new THREE.Scene(), [])
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1), [])

  const positions = useMemo(() => {
    const arr = new Float32Array(SIZE * SIZE * 4)
    for (let i = 0; i < SIZE * SIZE; i++) {
      arr[i * 4 + 0] = (Math.random() - 0.5) * 5
      arr[i * 4 + 1] = (Math.random() - 0.5) * 5
      arr[i * 4 + 2] = (Math.random() - 0.5) * 5
      arr[i * 4 + 3] = 0.0 // Initial velocity placeholder
    }
    return new THREE.DataTexture(arr, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType)
  }, [])

  const rtt = useFBO(SIZE, SIZE, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    stencilBuffer: false,
  })

  const particles = useMemo(() => {
    const p = new Float32Array(SIZE * SIZE * 3)
    for (let i = 0; i < SIZE * SIZE; i++) {
      p[i * 3 + 0] = (i % SIZE) / SIZE
      p[i * 3 + 1] = Math.floor(i / SIZE) / SIZE
    }
    return new THREE.BufferAttribute(p, 3)
  }, [])

  let target = rtt
  let pass = 0

  useFrame((state) => {
    const { gl, clock, pointer, delta } = state

    const oldTarget = target
    target = target === rtt ? rtt.clone() : rtt

    if (simMaterialRef.current) {
      simMaterialRef.current.uniforms.uPositions.value = oldTarget.texture
      simMaterialRef.current.uniforms.uTime.value = clock.elapsedTime
      simMaterialRef.current.uniforms.uDelta.value = delta
      simMaterialRef.current.uniforms.uMouse.value.set(
        pointer.x * (viewport.width / 2),
        pointer.y * (viewport.height / 2),
        0
      )
    }

    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)

    if (renderMaterialRef.current) {
      renderMaterialRef.current.uniforms.uPositions.value = target.texture
    }

    pass++
  })

  return (
    <>
      {createPortal(
        <mesh>
          <planeGeometry args={[2, 2]} />
          <shaderMaterial
            ref={simMaterialRef}
            vertexShader={simulationVertexShader}
            fragmentShader={simulationFragmentShader}
            uniforms={{
              uPositions: { value: positions },
              uTime: { value: 0 },
              uDelta: { value: 0 },
              uMouse: { value: new THREE.Vector3() },
            }}
          />
        </mesh>,
        scene
      )}
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" {...particles} />
        </bufferGeometry>
        <shaderMaterial
          ref={renderMaterialRef}
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={{
            uPositions: { value: null },
            uSize: { value: 30.0 },
            uColor: { value: new THREE.Color('cyan') },
            uSpecularColor: { value: new THREE.Color('white') },
            uShininess: { value: 32.0 },
          }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  )
}