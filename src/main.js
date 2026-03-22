// src/main.js
// Bootstrap: scene init, loops, command router, seed setup

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';

import { solveFiringSolution, createSolverWorker } from './solver/ballistics.js';
import { StateMachine, STATES, EVENTS }            from './state/machine.js';
import { PinchZoomHandler }                         from './input/touch.js';
import { buildUIIsland, UILayout }                  from './ui/layout.js';
import { HUD }                                      from './ui/hud.js';
import { LoopController, ParticleSoA, ProjectilePool } from './perf/loops.js';
import {
  setupRenderer, setupLights, buildTerrain, buildLauncher,
  buildTargetMarker, buildTrajectoryLine, buildImpactMarker,
  setupPostProcessing, buildPlumeSystem, isMobile
} from './visual/pbr.js';
import { saveSolverRun, recordProfilerSample, saveSettings, loadSettings } from './db/dexie.js';
import { runCanonicalTests }  from './tests/canonical.js';
import { runMutationHarness } from './tests/mutation.js';

// ---- Deterministic seed setup ----
function applySeed(seed) {
  if (typeof Math.seedrandom === 'function') {
    Math.seedrandom(seed);
  }
}

// ---- App State ----
const app = {
  scene:      null,
  camera:     null,
  renderer:   null,
  controls:   null,
  composer:   null,
  loop:       null,
  particles:  null,
  projPool:   null,
  plumeSystem:null,
  targetMesh: null,
  launcherMesh: null,
  trajectoryViz: null,
  impactMarker:  null,
  hud:           null,
  uiLayout:      null,
  stateMachine:  null,
  solverWorker:  null,
  pinchZoom:     null,

  // State for replay and debug
  lastParams:    null,
  lastResult:    null,
  profilerSnapshot: null,
  testResults:   null,

  // Current projectile state
  activeProjectile: null,

  // Profiler
  profiler: { frameMs: 0, physicsMs: 0, solverMs: 0 }
};

async function init() {
  applySeed('ballistics-main');

  // Load settings
  const savedSettings = await loadSettings();
  const canvas = document.getElementById('app-canvas');

  // ---- Scene ----
  app.scene = new THREE.Scene();
  app.scene.fog = new THREE.FogExp2(0x0a0d14, 0.003);
  app.scene.background = new THREE.Color(0x0a0d14);

  // ---- Camera ----
  app.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  app.camera.position.set(0, 40, 80);
  app.camera.lookAt(0, 0, 0);

  // ---- Renderer ----
  app.renderer = setupRenderer(THREE, canvas);
  app.renderer.setSize(window.innerWidth, window.innerHeight);

  // ---- Controls ----
  app.controls = new OrbitControls(app.camera, canvas);
  app.controls.enableDamping = true;
  app.controls.dampingFactor = 0.05;
  app.controls.maxPolarAngle = Math.PI / 2.1;
  app.controls.minDistance   = 5;
  app.controls.maxDistance   = 400;
  app.controls.target.set(0, 0, 0);

  // ---- Lights ----
  const lights = setupLights(THREE, app.scene);

  // ---- Terrain ----
  buildTerrain(THREE, app.scene);

  // ---- Launcher ----
  app.launcherMesh = buildLauncher(THREE, app.scene, new THREE.Vector3(0, 0, 0));

  // ---- Target marker ----
  app.targetMesh = buildTargetMarker(THREE, app.scene);
  app.targetMesh.visible = false;

  // ---- Trajectory viz ----
  app.trajectoryViz = buildTrajectoryLine(THREE, app.scene);

  // ---- Impact marker ----
  app.impactMarker = buildImpactMarker(THREE, app.scene);

  // ---- Particles (SoA) ----
  app.particles = new ParticleSoA(512);
  app.plumeSystem = buildPlumeSystem(THREE, app.scene);

  // ---- Projectile Pool ----
  app.projPool = new ProjectilePool(app.scene, THREE, 16);

  // ---- Post-processing ----
  const postModules = { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass };
  app.composer = setupPostProcessing(THREE, app.renderer, app.scene, app.camera, postModules);

  // ---- Target plane (clickable) ----
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.name = 'groundPlane';
  app.scene.add(groundPlane);

  // ---- Raycaster for target placement ----
  const raycaster = new THREE.Raycaster();
  const pointer   = new THREE.Vector2();

  canvas.addEventListener('click', (e) => {
    // Don't process if pinch zoom was active
    if (app.pinchZoom?.isActive) return;

    pointer.x = (e.clientX / window.innerWidth)  * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, app.camera);
    const hits = raycaster.intersectObject(groundPlane);

    if (hits.length > 0) {
      const pos = hits[0].point;
      app.targetMesh.position.copy(pos);
      app.targetMesh.visible = true;
      app.hud?.setTarget(pos);
      app.currentTarget = { x: pos.x, y: pos.y, z: pos.z };
    }
  });

  // ---- Pinch zoom ----
  app.pinchZoom = new PinchZoomHandler(canvas, app.camera, app.controls);

  // ---- UI island ----
  const island = buildUIIsland();
  app.hud = new HUD(island, app);
  app.uiLayout = new UILayout(island, app.controls);

  // ---- Solver worker ----
  app.solverWorker = createSolverWorker();

  // Wrap worker in solver interface expected by StateMachine
  const solverInterface = {
    solve: (params) => app.solverWorker.solve(params)
  };

  // ---- State machine ----
  app.stateMachine = new StateMachine({
    solver: solverInterface,
    onStateChange: handleStateChange,
    onSolverResult: handleSolverResult,
    onError: (err) => console.error('[StateMachine]', err)
  });

  // ---- Wire UI buttons ----
  app.hud.wireButtons({
    planAndFire: () => dispatchPlanAndFire(),
    fire:        () => app.stateMachine.dispatch(EVENTS.FIRE_CLICKED),
    reset:       () => app.stateMachine.dispatch(EVENTS.RESET_CLICKED),
    tryHighArc:  () => app.stateMachine.dispatch(EVENTS.TRY_HIGH_ARC),
    relaxTOF:    () => app.stateMachine.dispatch(EVENTS.RELAX_TOF),
    expandElev:  () => app.stateMachine.dispatch(EVENTS.EXPAND_ELEVATION),
    resetWind:   () => app.stateMachine.dispatch(EVENTS.RESET_WIND_DRAG),
    reseed:      () => app.stateMachine.dispatch(EVENTS.RESEED_GUESS)
  });

  // ---- State machine event hooks ----
  app.stateMachine.on('stateChange', ({ state, prev }) => {
    handleStateChange(state, prev);
  });

  app.stateMachine.on('solverSuccess', ({ result }) => {
    handleSolverResult(result);
  });

  app.stateMachine.on('solverFailure', ({ result }) => {
    handleSolverResult(result);
  });

  app.stateMachine.on('firing', ({ solution }) => {
    launchProjectile(solution?.solution);
  });

  app.stateMachine.on('reset', () => {
    app.trajectoryViz.hide();
    app.impactMarker.visible = false;
    app.hud.setSolution(null);
    app.hud.hideRecovery();
    app.hud.setFireEnabled(false);
    app.currentTarget = null;
    app.targetMesh.visible = false;
  });

  // ---- Physics loop ----
  app.loop = new LoopController({
    onPhysicsStep: physicsStep,
    onRender:      renderStep,
    onStats:       (stats) => {
      app.profiler.frameMs   = stats.frameMs;
      app.profiler.physicsMs = stats.physicsMs;
    }
  });

  // ---- Resize handler ----
  window.addEventListener('resize', () => {
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();
    app.renderer.setSize(window.innerWidth, window.innerHeight);
    app.composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- Console commands ----
  window.ballistics = {
    planAndFire: () => dispatchPlanAndFire(),
    runTests:    () => app.runTests(),
    evolve:      () => console.log('!evolve: See RELEASE NOTES for recommendations'),
    reflexion:   (id) => console.log('!reflexion: See Phase C log'),
    muse:        () => console.log('!muse: See MUSE INSIGHT LOG above'),
    fast:        () => console.log('!fast: Skipping Phase 0/0.5 for incremental fixes'),
  };

  app.runTests = async () => {
    console.log('Running canonical tests...');
    const canonical  = await runCanonicalTests();
    const mutations  = await runMutationHarness();
    app.testResults  = { canonical, mutations };
    return app.testResults;
  };

  app.replayLast = async () => {
    if (!app.lastParams) { console.warn('No last params to replay'); return; }
    await app.stateMachine.dispatch(EVENTS.PLAN_AND_FIRE_CLICKED, { solverParams: app.lastParams });
  };

  // ---- Start loop ----
  app.loop.start();

  // ---- Print initial HUD ----
  app.hud.setStatus('ready', 'Click terrain to set target');
  console.log('[BallisticsApp] Initialized. Use window.ballistics.* commands or click terrain to set target.');

  // Auto-run tests in background (non-blocking)
  setTimeout(() => {
    app.runTests().then(r => {
      app.testResults = r;
      const { canonical, mutations } = r;
      console.log(`Tests complete: Canonical ${canonical.passCount}/${canonical.total}, ` +
                  `Mutations ${mutations.passCount}/${mutations.total} (${mutations.passRate.toFixed(0)}%)`);
    });
  }, 500);
}

// ---- Physics step (120 Hz) ----
let _physicsTime = 0;

function physicsStep(dt) {
  const t0 = performance.now();

  // Update particles
  app.particles.step(dt, -9.81);

  // Update projectiles
  if (app.activeProjectile) {
    const p = app.activeProjectile;
    if (!p.landed) {
      const pos = p.mesh.position;
      const vel = p.velocity;

      // Simple Euler integration for visual (solver already computed path)
      vel.y += -9.81 * dt;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;

      // Spawn plume particles (no alloc — index into SoA)
      if (Math.random() < 0.4) {
        app.particles.spawn(
          pos.x, pos.y, pos.z,
          (Math.random()-0.5)*3, (Math.random()-0.5)*3 + 2, (Math.random()-0.5)*3,
          0.6, 0.8
        );
      }

      // Check landing
      if (pos.y <= 0.1) {
        pos.y = 0.1;
        p.landed = true;
        app.impactMarker.position.set(pos.x, 0.5, pos.z);
        app.impactMarker.visible = true;

        // Spawn impact burst
        for (let i = 0; i < 30; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 5 + Math.random() * 15;
          app.particles.spawn(
            pos.x, 0.5, pos.z,
            Math.cos(angle) * speed, 5 + Math.random() * 10, Math.sin(angle) * speed,
            1.5, 1.5
          );
        }

        setTimeout(() => {
          if (app.activeProjectile === p) {
            app.projPool.release(p);
            app.activeProjectile = null;
            app.stateMachine.dispatch(EVENTS.PROJECTILE_LANDED);
          }
        }, 100);
      }
    }
  }

  _physicsTime = performance.now() - t0;
}

// ---- Render step ----
let _lastHUDUpdate = 0;

function renderStep(alpha, dt) {
  app.controls.update();

  // Update plume visualization
  app.plumeSystem.update(app.particles);

  // Render
  if (app.composer) {
    app.composer.render();
  } else {
    app.renderer.render(app.scene, app.camera);
  }

  // Update HUD periodically (not every frame to save CPU)
  const now = performance.now();
  if (now - _lastHUDUpdate > 100) {
    _lastHUDUpdate = now;

    const profSnap = {
      frameMs:   app.profiler.frameMs,
      physicsMs: app.profiler.physicsMs,
      solverMs:  app.profiler.solverMs,
      drawCalls: app.renderer.info.render.calls,
      particles: app.particles.activeCount
    };
    app.hud.updateProfiler(profSnap);
    app.profilerSnapshot = profSnap;

    recordProfilerSample(profSnap);
  }
}

// ---- Handle state changes ----
function handleStateChange(state, prev) {
  const statusMsgs = {
    [STATES.READY]:     'Click terrain to set target, then Plan & Fire',
    [STATES.PLANNING]:  '⟳ Computing firing solution...',
    [STATES.PLANNED]:   'Solution ready. Click Fire to launch.',
    [STATES.ARMED]:     'Armed. Confirm fire.',
    [STATES.FIRING]:    'Projectile in flight...',
    [STATES.POSTFIRE]:  'Impact recorded. Reset to continue.'
  };

  app.hud.setStatus(state, statusMsgs[state]);

  if (state === STATES.PLANNED) {
    app.hud.setFireEnabled(true);
    app.hud.hideRecovery();
  } else if (state === STATES.PLANNING) {
    app.hud.setFireEnabled(false);
  } else if (state === STATES.READY) {
    app.hud.setFireEnabled(false);
    app.hud.setSolution(null);
    app.hud.hideRecovery();
  }
}

// ---- Handle solver result ----
function handleSolverResult(result) {
  if (result.status === 'converged') {
    app.lastResult = result;
    app.profiler.solverMs = result.solution.planningTimeMs;
    app.hud.setSolution(result.solution);

    // Update trajectory visualization
    app.trajectoryViz.updateTrajectory(result.solution.trajectory);

    // Save to Dexie
    saveSolverRun(app.lastParams, result);
  } else {
    // Failure: show recovery UI
    app.hud.setStatus('error', 'Solver Failed');
    app.hud.showRecovery(result.reason, result.recommendation);
    app.hud.setSolution(null);
  }
}

// ---- Dispatch plan and fire ----
function dispatchPlanAndFire() {
  if (!app.currentTarget) {
    alert('Click on the terrain to set a target first!');
    return;
  }

  const hud = app.hud;
  const solverParams = {
    targetWorldPos:   app.currentTarget,
    launcherPose:     {
      pos: { x: 0, y: 0, z: 0 },
      forward: { x: 1, y: 0, z: 0 },
      up:      { x: 0, y: 1, z: 0 }
    },
    mechanicalLimits: { minElev: 5, maxElev: 85 },
    maxTimeOfFlight:  30,
    gravity:          -9.81,
    wind:             { vx: hud.inputs.windX(), vy: 0, vz: hud.inputs.windZ() },
    airDensity:       hud.inputs.rho(),
    dragCoefficient:  0.47,
    projectileArea:   0.0079,
    projectileMass:   10,
    enableDrag:       hud.inputs.drag(),
    toleranceMeters:  1.0,
    seed:             hud.inputs.seed(),
    preferHighArc:    hud.inputs.highArc(),
    v0:               hud.inputs.v0(),
  };

  app.lastParams = solverParams;
  const t0 = performance.now();

  app.stateMachine.dispatch(EVENTS.PLAN_AND_FIRE_CLICKED, { solverParams }).then(() => {
    app.profiler.solverMs = performance.now() - t0;
  });
}

// ---- Launch projectile ----
function launchProjectile(solution) {
  if (!solution) return;

  const elevation = solution.elevation;
  const target    = app.currentTarget;
  if (!target) return;

  const dx  = target.x;
  const dz  = target.z;
  const rng = Math.sqrt(dx*dx + dz*dz);
  const dir = rng > 0 ? { x: dx/rng, z: dz/rng } : { x: 1, z: 0 };

  const v0 = app.lastParams?.v0 || 100;
  const vel = new THREE.Vector3(
    v0 * Math.cos(elevation) * dir.x,
    v0 * Math.sin(elevation),
    v0 * Math.cos(elevation) * dir.z
  );

  const spawnPos = new THREE.Vector3(0, 1.5, 0);
  const proj = app.projPool.acquire(spawnPos, vel);

  if (proj) {
    app.activeProjectile = proj;
    app.hud.setStatus('firing', 'Projectile in flight...');
  }
}

// ---- Start ----
init().catch(err => {
  console.error('[BallisticsApp] Init failed:', err);
  document.body.innerHTML += `<div style="color:red;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);padding:20px;border-radius:8px">
    <b>Init Error:</b><br>${err.message}
  </div>`;
});
