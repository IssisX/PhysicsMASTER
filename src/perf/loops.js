// src/perf/loops.js
// Fixed-step physics at 120 Hz, render interpolation, object pools, SoA typed arrays

const PHYSICS_HZ  = 120;
const PHYSICS_DT  = 1 / PHYSICS_HZ;   // ~8.33 ms
const MAX_CATCH_UP = 5;                 // max steps per frame to prevent spiral-of-death

// ---- Structure of Arrays (SoA) for particles ----
const MAX_PARTICLES = 512;

export class ParticleSoA {
  constructor(maxCount = MAX_PARTICLES) {
    this.maxCount = maxCount;
    this.count    = 0;

    // Position
    this.px = new Float32Array(maxCount);
    this.py = new Float32Array(maxCount);
    this.pz = new Float32Array(maxCount);

    // Velocity
    this.vx = new Float32Array(maxCount);
    this.vy = new Float32Array(maxCount);
    this.vz = new Float32Array(maxCount);

    // Life [0..1] and max life (seconds)
    this.life    = new Float32Array(maxCount);
    this.maxLife = new Float32Array(maxCount);

    // Scale
    this.scale = new Float32Array(maxCount);

    // Active flag (1 = alive, 0 = dead)
    this.active = new Uint8Array(maxCount);
  }

  spawn(x, y, z, vx, vy, vz, life, scale = 1) {
    // Find first free slot (swap-free via active flag)
    for (let i = 0; i < this.maxCount; i++) {
      if (!this.active[i]) {
        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
        this.life[i] = 1.0;
        this.maxLife[i] = life;
        this.scale[i] = scale;
        this.active[i] = 1;
        if (i >= this.count) this.count = i + 1;
        return i;
      }
    }
    // Pool exhausted — warn and reuse oldest (index 0 as a fallback)
    console.warn('[ParticleSoA] Pool exhausted. Consider increasing MAX_PARTICLES.');
    this.px[0] = x; this.py[0] = y; this.pz[0] = z;
    this.vx[0] = vx; this.vy[0] = vy; this.vz[0] = vz;
    this.life[0] = 1.0; this.maxLife[0] = life;
    this.scale[0] = scale; this.active[0] = 1;
    return 0;
  }

  step(dt, gravity) {
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;

      this.vx[i] *= 0.98;
      this.vy[i] += gravity * dt;
      this.vz[i] *= 0.98;

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      this.life[i] -= dt / this.maxLife[i];

      if (this.life[i] <= 0) {
        this.active[i] = 0;
        // Compact: swap with last active
        // For simplicity, just mark dead; count will be cleaned periodically
      }
    }
    this._compactCount();
  }

  _compactCount() {
    let maxActive = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.active[i]) { maxActive = i + 1; break; }
    }
    this.count = maxActive;
  }

  get activeCount() {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.active[i]) n++;
    return n;
  }
}

// ---- Projectile pool (mesh-based) ----
export class ProjectilePool {
  constructor(scene, THREE, maxCount = 16) {
    this._scene   = scene;
    this._THREE   = THREE;
    this._pool    = [];
    this._active  = [];
    this._maxCount = maxCount;

    const geo = new THREE.SphereGeometry(0.25, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffa040,
      emissive: 0xff4000,
      emissiveIntensity: 2,
      metalness: 0.8,
      roughness: 0.2
    });

    for (let i = 0; i < maxCount; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this._pool.push({ mesh, active: false });
    }
  }

  acquire(position, velocity) {
    for (const p of this._pool) {
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        p.mesh.position.copy(position);
        p.velocity  = velocity.clone ? velocity.clone() : { ...velocity };
        p.landed    = false;
        this._active.push(p);
        return p;
      }
    }
    console.warn('[ProjectilePool] Pool exhausted');
    return null;
  }

  release(p) {
    p.active = false;
    p.mesh.visible = false;
    const idx = this._active.indexOf(p);
    if (idx >= 0) {
      // Swap-remove for O(1)
      this._active[idx] = this._active[this._active.length - 1];
      this._active.pop();
    }
  }

  get activeCount() { return this._active.length; }
  get activeItems()  { return this._active; }
}

// ---- Main loop controller ----
export class LoopController {
  constructor({ onPhysicsStep, onRender, onStats }) {
    this._onPhysicsStep = onPhysicsStep;
    this._onRender      = onRender;
    this._onStats       = onStats;

    this._accumulator = 0;
    this._lastTime    = null;
    this._running     = false;
    this._rafHandle   = null;

    this._frameMs   = 0;
    this._physicsMs = 0;

    this._tick = this._tick.bind(this);
  }

  start() {
    this._running  = true;
    this._lastTime = performance.now();
    this._rafHandle = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
  }

  _tick(now) {
    if (!this._running) return;
    this._rafHandle = requestAnimationFrame(this._tick);

    const frameStart = performance.now();
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Clamp dt to prevent spiral-of-death
    if (dt > 0.1) dt = 0.1;

    this._accumulator += dt;

    const physStart = performance.now();
    let steps = 0;

    while (this._accumulator >= PHYSICS_DT && steps < MAX_CATCH_UP) {
      this._onPhysicsStep(PHYSICS_DT);
      this._accumulator -= PHYSICS_DT;
      steps++;
    }
    this._physicsMs = performance.now() - physStart;

    // Interpolation alpha for smooth visuals
    const alpha = this._accumulator / PHYSICS_DT;
    this._onRender(alpha, dt);

    this._frameMs = performance.now() - frameStart;

    if (this._onStats) {
      this._onStats({
        frameMs:   this._frameMs,
        physicsMs: this._physicsMs
      });
    }
  }

  get frameMs()   { return this._frameMs; }
  get physicsMs() { return this._physicsMs; }
}
