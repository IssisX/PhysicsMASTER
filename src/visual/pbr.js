// src/visual/pbr.js
// PBR visual pipeline: lights, shadows, post-stack, terrain, procedural textures

const isMobile = /Mobi|Android/i.test(navigator.userAgent) ||
                 (window.innerWidth < 768 && window.innerHeight < 1024);

export function setupRenderer(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    powerPreference: isMobile ? 'low-power' : 'high-performance'
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return renderer;
}

export function setupLights(THREE, scene) {
  // Ambient
  const ambient = new THREE.AmbientLight(0x202840, 0.4);
  scene.add(ambient);

  // Directional (sun)
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.position.set(50, 100, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.width  = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.height = isMobile ? 1024 : 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 400;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -150;
  sun.shadow.camera.right = sun.shadow.camera.top   =  150;
  sun.shadow.radius = 2;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Hemisphere (sky/ground)
  const hemi = new THREE.HemisphereLight(0x4488bb, 0x223311, 0.6);
  scene.add(hemi);

  // Fill light (soft blue)
  const fill = new THREE.DirectionalLight(0x8090c0, 0.4);
  fill.position.set(-30, 20, -50);
  scene.add(fill);

  return { sun, ambient, hemi, fill };
}

/**
 * Build terrain: procedural heightmap via offscreen canvas
 */
export function buildTerrain(THREE, scene, size = 400, resolution = 64) {
  const geo = new THREE.PlaneGeometry(size, size, resolution, resolution);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;

  // Gentle procedural hills using sine waves (no allocation in hot path)
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = Math.sin(x * 0.03) * 2 + Math.cos(z * 0.02) * 1.5 +
              Math.sin(x * 0.07 + z * 0.05) * 0.8;
    // Keep center flat (landing zone)
    const dist = Math.sqrt(x*x + z*z);
    const flatten = Math.max(0, 1 - dist / 30);
    pos.setY(i, y * (1 - flatten));
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Procedural normal map via offscreen canvas
  const normalMap = generateProceduralNormalMap(THREE, 256);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a5c2a,
    roughness: 0.85,
    metalness: 0.0,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  return mesh;
}

function generateProceduralNormalMap(THREE, size) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Generate grayscale noise
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Simplex-like noise via trig
      const n = (Math.sin(x * 0.8) * Math.cos(y * 0.6) +
                 Math.sin(x * 0.3 + y * 0.5) * 0.5) * 0.5 + 0.5;
      const v = Math.floor(n * 255);
      // Normal map: rg encodes normals, b=1 (up)
      data[idx]   = 128 + Math.floor(Math.sin(x * 0.5) * 60);  // R = normal.x
      data[idx+1] = 128 + Math.floor(Math.cos(y * 0.5) * 60);  // G = normal.y
      data[idx+2] = 255;                                          // B = normal.z
      data[idx+3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
}

/**
 * Build launcher model
 */
export function buildLauncher(THREE, scene, position) {
  const group = new THREE.Group();

  // Base
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x505060, metalness: 0.9, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.6, 16), baseMat);
  base.castShadow = true;
  group.add(base);

  // Barrel
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x303035, metalness: 0.95, roughness: 0.2 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 4, 12), barrelMat);
  barrel.castShadow = true;
  barrel.position.set(0, 2.5, 0);
  barrel.name = 'barrel';
  group.add(barrel);

  group.position.copy(position || { x: 0, y: 0, z: 0 });
  scene.add(group);

  return group;
}

/**
 * Build target marker
 */
export function buildTargetMarker(THREE, scene) {
  const group = new THREE.Group();

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.5,
    metalness: 0.6, roughness: 0.4
  });

  for (let r = 1; r <= 3; r++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.5, 0.08, 8, 32),
      ringMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
  }

  // Center spike
  const spike = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 1.0, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff0000, emissiveIntensity: 2 })
  );
  spike.position.y = 0.5;
  group.add(spike);

  group.visible = false;
  scene.add(group);
  return group;
}

/**
 * Build trajectory line
 */
export function buildTrajectoryLine(THREE, scene) {
  const MAX_POINTS = 2000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_POINTS * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicMaterial({
    color: 0x40c0ff,
    transparent: true,
    opacity: 0.7,
    linewidth: 1
  });

  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);

  return {
    line,
    updateTrajectory(samples) {
      if (!samples || samples.length === 0) { line.visible = false; return; }
      const count = Math.min(samples.length, MAX_POINTS);
      const buf = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        buf[i*3]   = samples[i].x;
        buf[i*3+1] = samples[i].y + 0.05;
        buf[i*3+2] = samples[i].z;
      }
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
      line.visible = true;
    },
    hide() { line.visible = false; }
  };
}

/**
 * Build impact marker
 */
export function buildImpactMarker(THREE, scene) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffaa00, emissive: 0xff6600, emissiveIntensity: 2,
    metalness: 0.3, roughness: 0.7
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    mat
  );
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
}

/**
 * Setup EffectComposer post-processing stack
 */
export function setupPostProcessing(THREE, renderer, scene, camera, postModules) {
  const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass } = postModules;
  let SSAOPass, BokehPass;
  try { SSAOPass  = postModules.SSAOPass; }  catch(_) {}
  try { BokehPass = postModules.BokehPass; } catch(_) {}

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // SSAO (desktop only)
  if (!isMobile && SSAOPass) {
    const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssao.kernelRadius = 8;
    ssao.minDistance  = 0.001;
    ssao.maxDistance  = 0.1;
    composer.addPass(ssao);
  }

  // Bloom
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,   // strength
    0.4,   // radius
    0.85   // threshold
  );
  composer.addPass(bloom);

  // Chromatic Aberration (subtle ShaderPass)
  const caShader = {
    uniforms: {
      tDiffuse: { value: null },
      amount:   { value: 0.003 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float amount;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - 0.5;
        float d = length(dir);
        vec2 offset = normalize(dir) * amount * d;
        float r = texture2D(tDiffuse, vUv + offset).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv - offset).b;
        gl_FragColor = vec4(r, g, b, 1.0);
      }
    `
  };

  const caPass = new ShaderPass(caShader);
  composer.addPass(caPass);

  return composer;
}

/**
 * Build plume particle system (billboard sprites, pooled)
 */
export function buildPlumeSystem(THREE, scene) {
  const MAX = 200;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const colors    = new Float32Array(MAX * 3);
  const sizes     = new Float32Array(MAX);

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));
  geo.setDrawRange(0, 0);

  const mat = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return {
    points,
    update(particleSoA) {
      const count = Math.min(particleSoA.count, MAX);
      let drawCount = 0;

      for (let i = 0; i < count; i++) {
        if (!particleSoA.active[i]) continue;
        const life = particleSoA.life[i];
        const j = drawCount * 3;

        positions[j]   = particleSoA.px[i];
        positions[j+1] = particleSoA.py[i];
        positions[j+2] = particleSoA.pz[i];

        // Color gradient: white -> orange -> grey
        if (life > 0.7) {
          colors[j] = 1; colors[j+1] = 0.9; colors[j+2] = 0.7;
        } else if (life > 0.3) {
          colors[j] = 1; colors[j+1] = 0.4; colors[j+2] = 0.1;
        } else {
          colors[j] = 0.3; colors[j+1] = 0.25; colors[j+2] = 0.2;
        }

        sizes[drawCount] = particleSoA.scale[i] * life * 2;
        drawCount++;
      }

      geo.setDrawRange(0, drawCount);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate    = true;
      geo.attributes.size.needsUpdate     = true;
    }
  };
}

export { isMobile };
