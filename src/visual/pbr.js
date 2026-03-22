// src/visual/pbr.js
// PBR visual pipeline: lights, shadows, post-stack, terrain, procedural textures,
// sky dome, grid rings, wind arrows, laser rangefinder, shockwave, barrel animation

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
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return renderer;
}

export function setupLights(THREE, scene) {
  const ambient = new THREE.AmbientLight(0x607898, 1.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
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

  const hemi = new THREE.HemisphereLight(0x88bbee, 0x446622, 1.0);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0x8090c0, 0.8);
  fill.position.set(-30, 20, -50);
  scene.add(fill);

  return { sun, ambient, hemi, fill };
}

// ---- Sky dome gradient ----
export function buildSkyDome(THREE, scene) {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor:    { value: new THREE.Color(0x1a3050) },
      bottomColor: { value: new THREE.Color(0x3a5a40) },
      offset:      { value: 10 },
      exponent:    { value: 0.6 }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(geo, mat);
  scene.add(dome);
  return dome;
}

// ---- Range rings (concentric circles at 50m intervals) ----
export function buildRangeRings(THREE, scene, maxRange = 400, interval = 50) {
  const group = new THREE.Group();
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x304060, transparent: true, opacity: 0.25, linewidth: 1
  });

  for (let r = interval; r <= maxRange; r += interval) {
    const segments = 64;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(angle) * r, 0.05, Math.sin(angle) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ring = new THREE.Line(geo, ringMat);
    group.add(ring);

    // Label at +X
    if (r % 100 === 0) {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 24;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(80,140,200,0.7)';
      ctx.font = '14px monospace';
      ctx.fillText(`${r}m`, 2, 17);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.6 });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(r + 3, 1, 0);
      sprite.scale.set(8, 3, 1);
      group.add(sprite);
    }
  }

  scene.add(group);
  return group;
}

// ---- Grid overlay ----
export function buildGridOverlay(THREE, scene) {
  const grid = new THREE.GridHelper(400, 40, 0x203040, 0x182030);
  grid.position.y = 0.02;
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);
  return grid;
}

// ---- Terrain ----
export function buildTerrain(THREE, scene, size = 400, resolution = 128) {
  const geo = new THREE.PlaneGeometry(size, size, resolution, resolution);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = Math.sin(x * 0.03) * 2 + Math.cos(z * 0.02) * 1.5 +
              Math.sin(x * 0.07 + z * 0.05) * 0.8 +
              Math.sin(x * 0.15) * Math.cos(z * 0.12) * 0.4;
    const dist = Math.sqrt(x*x + z*z);
    const flatten = Math.max(0, 1 - dist / 30);
    pos.setY(i, y * (1 - flatten));

    // Vertex coloring: green lowlands -> brown hills
    const h = Math.abs(y * (1 - flatten));
    const green = 0.35 + 0.15 * (1 - h / 4);
    const red   = 0.22 + 0.12 * (h / 4);
    colors[i*3]   = red;
    colors[i*3+1] = green;
    colors[i*3+2] = 0.15 + 0.05 * (1 - h / 4);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const normalMap = generateProceduralNormalMap(THREE, 256);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.0,
    normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4)
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
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      data[idx]   = 128 + Math.floor(Math.sin(x * 0.5 + y * 0.3) * 40 + Math.cos(x * 1.2) * 20);
      data[idx+1] = 128 + Math.floor(Math.cos(y * 0.5 + x * 0.2) * 40 + Math.sin(y * 0.9) * 20);
      data[idx+2] = 255;
      data[idx+3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  return texture;
}

// ---- Launcher with animated barrel ----
export function buildLauncher(THREE, scene, position) {
  const group = new THREE.Group();

  // Base platform
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x505060, metalness: 0.9, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.5, 16), baseMat);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Turret ring
  const turretMat = new THREE.MeshStandardMaterial({ color: 0x404050, metalness: 0.95, roughness: 0.15 });
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.3, 12), turretMat);
  turret.position.y = 0.4;
  turret.castShadow = true;
  group.add(turret);

  // Barrel pivot (for elevation animation)
  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(0, 0.7, 0);
  barrelPivot.name = 'barrelPivot';
  group.add(barrelPivot);

  // Barrel
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.95, roughness: 0.15 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5, 12), barrelMat);
  barrel.castShadow = true;
  barrel.position.set(0, 2.5, 0);
  barrel.name = 'barrel';
  barrelPivot.add(barrel);

  // Muzzle brake
  const muzzleMat = new THREE.MeshStandardMaterial({
    color: 0x202025, metalness: 0.9, roughness: 0.1,
    emissive: 0x100808, emissiveIntensity: 0.3
  });
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 0.5, 8), muzzleMat);
  muzzle.position.set(0, 5.1, 0);
  muzzle.name = 'muzzle';
  barrelPivot.add(muzzle);

  group.position.copy(position || new THREE.Vector3(0, 0, 0));
  scene.add(group);

  return group;
}

/**
 * Animate barrel to point at a given elevation and azimuth
 */
export function animateBarrel(launcher, elevation, azimuth, dt) {
  if (!launcher) return;
  const pivot = launcher.getObjectByName('barrelPivot');
  if (!pivot) return;

  // Elevation: rotate around X (default barrel is vertical, so 0 elev = horizontal)
  // barrel points up (+Y) by default, need to tilt: PI/2 - elevation rotates from vertical
  const targetRotX = -(Math.PI / 2 - elevation);
  pivot.rotation.x += (targetRotX - pivot.rotation.x) * Math.min(1, dt * 3);

  // Azimuth: rotate the entire launcher group around Y
  if (azimuth !== undefined) {
    launcher.rotation.y += (azimuth - launcher.rotation.y) * Math.min(1, dt * 3);
  }
}

// ---- Target marker with pulse animation ----
export function buildTargetMarker(THREE, scene) {
  const group = new THREE.Group();

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.5,
    metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.9
  });

  for (let r = 1; r <= 3; r++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.2, 0.06, 8, 48),
      ringMat.clone()
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.name = `ring-${r}`;
    group.add(ring);
  }

  // Vertical beam
  const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, 12, 6);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff3300, transparent: true, opacity: 0.4
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 6;
  beam.name = 'targetBeam';
  group.add(beam);

  // Center dot
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 3 })
  );
  dot.position.y = 0.2;
  group.add(dot);

  group.visible = false;
  scene.add(group);
  return group;
}

/**
 * Pulse target rings
 */
export function animateTarget(target, time) {
  if (!target || !target.visible) return;
  for (let r = 1; r <= 3; r++) {
    const ring = target.getObjectByName(`ring-${r}`);
    if (ring) {
      const pulse = 1 + Math.sin(time * 3 + r) * 0.08;
      ring.scale.set(pulse, pulse, 1);
      ring.material.opacity = 0.6 + Math.sin(time * 2 + r * 1.5) * 0.3;
    }
  }
  const beam = target.getObjectByName('targetBeam');
  if (beam) beam.material.opacity = 0.2 + Math.sin(time * 4) * 0.15;
}

// ---- Laser rangefinder beam ----
export function buildLaserBeam(THREE, scene) {
  const MAX_POINTS = 2;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_POINTS * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0x00ff80,
    transparent: true,
    opacity: 0.5,
    linewidth: 1
  });

  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);

  return {
    line,
    update(from, to) {
      if (!from || !to) { line.visible = false; return; }
      const buf = geo.attributes.position.array;
      buf[0] = from.x; buf[1] = from.y + 1; buf[2] = from.z;
      buf[3] = to.x;   buf[4] = to.y + 0.5; buf[5] = to.z;
      geo.attributes.position.needsUpdate = true;
      line.visible = true;
    },
    hide() { line.visible = false; }
  };
}

// ---- Wind visualization arrows ----
export function buildWindArrows(THREE, scene) {
  const group = new THREE.Group();
  const arrowCount = 20;
  const arrows = [];

  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0x80c0ff, transparent: true, opacity: 0.3
  });

  for (let i = 0; i < arrowCount; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 4), arrowMat.clone());
    cone.position.set(
      (Math.random() - 0.5) * 200,
      3 + Math.random() * 8,
      (Math.random() - 0.5) * 200
    );
    cone.rotation.z = -Math.PI / 2; // point along +X default
    group.add(cone);
    arrows.push({ mesh: cone, baseX: cone.position.x, baseZ: cone.position.z, phase: Math.random() * Math.PI * 2 });
  }

  scene.add(group);

  return {
    group,
    update(windX, windZ, time) {
      const windMag = Math.sqrt(windX * windX + windZ * windZ);
      const windAngle = Math.atan2(windZ, windX);

      for (const a of arrows) {
        // Drift arrows in wind direction
        a.mesh.position.x = a.baseX + Math.sin(time * 0.3 + a.phase) * 20;
        a.mesh.position.z = a.baseZ + Math.cos(time * 0.2 + a.phase) * 20;
        a.mesh.position.y = 4 + Math.sin(time * 0.5 + a.phase) * 2;

        // Point in wind direction
        a.mesh.rotation.y = -windAngle;

        // Scale by wind magnitude
        const s = Math.max(0.3, Math.min(2, windMag * 0.2));
        a.mesh.scale.set(s, s, s);
        a.mesh.material.opacity = Math.min(0.5, windMag * 0.05);
      }
    }
  };
}

// ---- Shockwave ring (expands on impact) ----
export function buildShockwave(THREE, scene) {
  const geo = new THREE.TorusGeometry(1, 0.15, 8, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaa40, transparent: true, opacity: 0, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  let _animating = false;
  let _progress = 0;

  return {
    ring,
    trigger(pos) {
      ring.position.set(pos.x, 0.1, pos.z);
      ring.visible = true;
      _animating = true;
      _progress = 0;
      ring.scale.set(1, 1, 1);
      mat.opacity = 0.8;
    },
    update(dt) {
      if (!_animating) return;
      _progress += dt * 2;
      const s = 1 + _progress * 25;
      ring.scale.set(s, s, 1);
      mat.opacity = Math.max(0, 0.8 - _progress * 0.8);
      if (_progress >= 1) {
        _animating = false;
        ring.visible = false;
      }
    }
  };
}

// ---- Camera shake on impact ----
export function createCameraShake() {
  let _shaking = false;
  let _intensity = 0;
  let _decay = 0;

  return {
    trigger(intensity = 0.5) {
      _shaking = true;
      _intensity = intensity;
      _decay = intensity;
    },
    apply(camera, dt) {
      if (!_shaking) return;
      _decay *= 0.92;
      camera.position.x += (Math.random() - 0.5) * _decay * 0.8;
      camera.position.y += (Math.random() - 0.5) * _decay * 0.4;
      if (_decay < 0.001) _shaking = false;
    }
  };
}

// ---- Trajectory line ----
export function buildTrajectoryLine(THREE, scene) {
  const MAX_POINTS = 2000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_POINTS * 3);
  const colors    = new Float32Array(MAX_POINTS * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
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
      const posBuf = geo.attributes.position.array;
      const colBuf = geo.attributes.color.array;

      // Find max height for color gradient
      let maxY = 0;
      for (let i = 0; i < count; i++) {
        if (samples[i].y > maxY) maxY = samples[i].y;
      }
      maxY = Math.max(maxY, 1);

      for (let i = 0; i < count; i++) {
        posBuf[i*3]   = samples[i].x;
        posBuf[i*3+1] = samples[i].y + 0.05;
        posBuf[i*3+2] = samples[i].z;

        // Color: cyan at launch -> white at apex -> orange at impact
        const t = i / count;
        const h = samples[i].y / maxY;
        if (t < 0.5) {
          colBuf[i*3] = 0.2 + h * 0.8; colBuf[i*3+1] = 0.7 + h * 0.3; colBuf[i*3+2] = 1.0;
        } else {
          colBuf[i*3] = 1.0; colBuf[i*3+1] = 0.6 - (t-0.5)*0.8; colBuf[i*3+2] = 0.3 - (t-0.5)*0.5;
        }
      }
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      line.visible = true;
    },
    hide() { line.visible = false; }
  };
}

// ---- Impact marker ----
export function buildImpactMarker(THREE, scene) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffaa00, emissive: 0xff6600, emissiveIntensity: 2,
    metalness: 0.3, roughness: 0.7
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat);
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---- Post-processing ----
export function setupPostProcessing(THREE, renderer, scene, camera, postModules) {
  const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass } = postModules;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5, 0.4, 0.88
  );
  composer.addPass(bloom);

  // Chromatic aberration
  const caShader = {
    uniforms: {
      tDiffuse: { value: null },
      amount:   { value: 0.002 }
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
  composer.addPass(new ShaderPass(caShader));

  // Vignette
  const vignetteShader = {
    uniforms: {
      tDiffuse: { value: null },
      darkness: { value: 0.4 },
      offset:   { value: 1.2 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float darkness;
      uniform float offset;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        float d = distance(vUv, vec2(0.5));
        color.rgb *= smoothstep(0.8, offset * 0.5, d * (darkness + offset));
        gl_FragColor = color;
      }
    `
  };
  composer.addPass(new ShaderPass(vignetteShader));

  return composer;
}

// ---- Plume particle system ----
export function buildPlumeSystem(THREE, scene) {
  const MAX = 400;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const colors    = new Float32Array(MAX * 3);
  const sizes     = new Float32Array(MAX);

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));
  geo.setDrawRange(0, 0);

  const mat = new THREE.PointsMaterial({
    size: 2.0,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
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

        if (life > 0.7) {
          colors[j] = 1; colors[j+1] = 0.95; colors[j+2] = 0.8;
        } else if (life > 0.3) {
          colors[j] = 1; colors[j+1] = 0.5; colors[j+2] = 0.1;
        } else {
          colors[j] = 0.4; colors[j+1] = 0.3; colors[j+2] = 0.2;
        }

        sizes[drawCount] = particleSoA.scale[i] * life * 2.5;
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
