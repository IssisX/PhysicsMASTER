// src/main.js
// Bootstrap: scene, loops, solver, salvo, barrel animation, wind viz, laser, shockwave, camera shake

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
  setupPostProcessing, buildPlumeSystem, isMobile,
  buildSkyDome, buildRangeRings, buildGridOverlay,
  buildLaserBeam, buildWindArrows, buildShockwave,
  createCameraShake, animateBarrel, animateTarget
} from './visual/pbr.js';
import { saveSolverRun, recordProfilerSample, saveSettings, loadSettings } from './db/dexie.js';
import { runCanonicalTests }  from './tests/canonical.js';
import { runMutationHarness } from './tests/mutation.js';

function applySeed(seed) {
  if (typeof Math.seedrandom === 'function') Math.seedrandom(seed);
}

const app = {
  scene: null, camera: null, renderer: null, controls: null,
  composer: null, loop: null, particles: null, projPool: null,
  plumeSystem: null, targetMesh: null, launcherMesh: null,
  trajectoryViz: null, impactMarker: null, hud: null,
  uiLayout: null, stateMachine: null, solverWorker: null,
  pinchZoom: null,
  // Advanced visuals
  skyDome: null, rangeRings: null, gridOverlay: null,
  laserBeam: null, windArrows: null, shockwave: null,
  cameraShake: null,
  // State
  lastParams: null, lastResult: null, profilerSnapshot: null,
  testResults: null, activeProjectiles: [], currentTarget: null,
  clock: null, lastSolution: null,
  profiler: { frameMs: 0, physicsMs: 0, solverMs: 0 }
};

async function init() {
  applySeed('ballistics-main');
  await loadSettings();
  const canvas = document.getElementById('app-canvas');
  app.clock = new THREE.Clock();

  // ---- Scene ----
  app.scene = new THREE.Scene();
  app.scene.fog = new THREE.FogExp2(0x1a2a3a, 0.0015);

  // ---- Camera ----
  app.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  app.camera.position.set(-20, 35, 75);
  app.camera.lookAt(0, 0, 0);

  // ---- Renderer ----
  app.renderer = setupRenderer(THREE, canvas);

  // ---- Controls ----
  app.controls = new OrbitControls(app.camera, canvas);
  app.controls.enableDamping = true;
  app.controls.dampingFactor = 0.06;
  app.controls.maxPolarAngle = Math.PI / 2.1;
  app.controls.minDistance = 5;
  app.controls.maxDistance = 400;
  app.controls.target.set(0, 0, 0);

  // ---- Environment ----
  setupLights(THREE, app.scene);
  app.skyDome     = buildSkyDome(THREE, app.scene);
  app.rangeRings  = buildRangeRings(THREE, app.scene);
  app.gridOverlay = buildGridOverlay(THREE, app.scene);
  buildTerrain(THREE, app.scene);

  // ---- Launcher ----
  app.launcherMesh = buildLauncher(THREE, app.scene, new THREE.Vector3(0, 0, 0));

  // ---- Target ----
  app.targetMesh = buildTargetMarker(THREE, app.scene);

  // ---- Trajectory ----
  app.trajectoryViz = buildTrajectoryLine(THREE, app.scene);

  // ---- Impact marker ----
  app.impactMarker = buildImpactMarker(THREE, app.scene);

  // ---- Laser rangefinder ----
  app.laserBeam = buildLaserBeam(THREE, app.scene);

  // ---- Wind arrows ----
  app.windArrows = buildWindArrows(THREE, app.scene);

  // ---- Shockwave ----
  app.shockwave = buildShockwave(THREE, app.scene);

  // ---- Camera shake ----
  app.cameraShake = createCameraShake();

  // ---- Particles & pools ----
  app.particles = new ParticleSoA(1024);
  app.plumeSystem = buildPlumeSystem(THREE, app.scene);
  app.projPool = new ProjectilePool(app.scene, THREE, 16);

  // ---- Post-processing ----
  const postModules = { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass };
  app.composer = setupPostProcessing(THREE, app.renderer, app.scene, app.camera, postModules);

  // ---- Ground plane (clickable) ----
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  app.scene.add(groundPlane);

  // ---- Raycaster ----
  const raycaster = new THREE.Raycaster();
  const pointer   = new THREE.Vector2();

  canvas.addEventListener('click', (e) => {
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

      // Laser beam from launcher to target
      app.laserBeam.update({ x: 0, y: 0, z: 0 }, pos);

      // Aim barrel toward target
      const azimuth = Math.atan2(pos.x, pos.z);
      animateBarrel(app.launcherMesh, Math.PI / 6, azimuth, 1);
    }
  });

  // ---- Pinch zoom ----
  app.pinchZoom = new PinchZoomHandler(canvas, app.camera, app.controls);

  // ---- UI ----
  const island = buildUIIsland();
  app.hud = new HUD(island, app);
  app.uiLayout = new UILayout(island, app.controls);

  // ---- Solver ----
  app.solverWorker = createSolverWorker();
  const solverInterface = { solve: (params) => app.solverWorker.solve(params) };

  // ---- State machine ----
  app.stateMachine = new StateMachine({
    solver: solverInterface,
    onStateChange: handleStateChange,
    onSolverResult: handleSolverResult,
    onError: (err) => console.error('[StateMachine]', err)
  });

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

  app.stateMachine.on('firing', ({ solution }) => {
    launchProjectile(solution?.solution);
  });

  app.stateMachine.on('reset', () => {
    app.trajectoryViz.hide();
    app.impactMarker.visible = false;
    app.laserBeam.hide();
    app.hud.setSolution(null);
    app.hud.hideRecovery();
    app.hud.setFireEnabled(false);
    app.currentTarget = null;
    app.targetMesh.visible = false;
    app.lastSolution = null;
  });

  // ---- Loop ----
  app.loop = new LoopController({
    onPhysicsStep: physicsStep,
    onRender:      renderStep,
    onStats:       (stats) => {
      app.profiler.frameMs   = stats.frameMs;
      app.profiler.physicsMs = stats.physicsMs;
    }
  });

  // ---- Resize ----
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
    app,
  };

  app.runTests = async () => {
    console.log('Running tests...');
    const canonical  = await runCanonicalTests();
    const mutations  = await runMutationHarness();
    app.testResults  = { canonical, mutations };
    return app.testResults;
  };

  app.replayLast = async () => {
    if (!app.lastParams) { console.warn('No last params'); return; }
    await app.stateMachine.dispatch(EVENTS.PLAN_AND_FIRE_CLICKED, { solverParams: app.lastParams });
  };

  // ---- Start ----
  app.loop.start();
  app.hud.setStatus('ready', 'Click terrain to set target');
  console.log('[BallisticsApp] v2.0 Initialized');

  setTimeout(() => {
    app.runTests().then(r => {
      app.testResults = r;
      console.log(`Tests: Canonical ${r.canonical.passCount}/${r.canonical.total}, ` +
                  `Mutations ${r.mutations.passCount}/${r.mutations.total} (${r.mutations.passRate.toFixed(0)}%)`);
    });
  }, 1000);
}

// ---- Physics (120 Hz) ----
function physicsStep(dt) {
  app.particles.step(dt, -9.81);

  for (let i = app.activeProjectiles.length - 1; i >= 0; i--) {
    const p = app.activeProjectiles[i];
    if (p.landed) continue;

    const pos = p.mesh.position;
    const vel = p.velocity;

    // Add drag to projectile visual
    const speed = Math.sqrt(vel.x*vel.x + vel.y*vel.y + vel.z*vel.z);
    const dragFactor = 1 - 0.001 * speed * dt;

    vel.x *= dragFactor;
    vel.y += -9.81 * dt;
    vel.z *= dragFactor;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    // Plume trail
    if (Math.random() < 0.6) {
      app.particles.spawn(
        pos.x, pos.y, pos.z,
        (Math.random()-0.5)*4, (Math.random()-0.5)*3 + 3, (Math.random()-0.5)*4,
        0.8, 1.0
      );
    }

    // Landing
    if (pos.y <= 0.1) {
      pos.y = 0.1;
      p.landed = true;
      app.impactMarker.position.set(pos.x, 0.5, pos.z);
      app.impactMarker.visible = true;

      // Impact effects
      app.shockwave.trigger(pos);
      app.cameraShake.trigger(0.6);

      // Massive impact burst
      for (let j = 0; j < 60; j++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 20;
        const upSpeed = 4 + Math.random() * 15;
        app.particles.spawn(
          pos.x, 0.3, pos.z,
          Math.cos(angle) * speed, upSpeed, Math.sin(angle) * speed,
          1.8, 1.8
        );
      }
      // Smoke column
      for (let j = 0; j < 20; j++) {
        app.particles.spawn(
          pos.x + (Math.random()-0.5)*2, 1 + Math.random()*3, pos.z + (Math.random()-0.5)*2,
          (Math.random()-0.5)*2, 3 + Math.random()*5, (Math.random()-0.5)*2,
          3.0, 2.0
        );
      }

      const projRef = p;
      setTimeout(() => {
        const idx = app.activeProjectiles.indexOf(projRef);
        if (idx >= 0) {
          app.projPool.release(projRef);
          app.activeProjectiles.splice(idx, 1);
        }
        if (app.activeProjectiles.length === 0) {
          app.stateMachine.dispatch(EVENTS.PROJECTILE_LANDED);
        }
      }, 200);
    }
  }
}

// ---- Render ----
let _lastHUDUpdate = 0;

function renderStep(alpha, dt) {
  const time = app.clock.getElapsedTime();

  app.controls.update();

  // Animate target rings
  animateTarget(app.targetMesh, time);

  // Animate barrel towards solved elevation
  if (app.lastSolution && app.currentTarget) {
    const az = Math.atan2(app.currentTarget.x, app.currentTarget.z);
    animateBarrel(app.launcherMesh, app.lastSolution.elevation || Math.PI/6, az, dt);
  }

  // Update wind arrows
  const windX = app.hud?.inputs?.windX() || 0;
  const windZ = app.hud?.inputs?.windZ() || 0;
  app.windArrows.update(windX, windZ, time);

  // Shockwave
  app.shockwave.update(dt);

  // Camera shake
  app.cameraShake.apply(app.camera, dt);

  // Particles
  app.plumeSystem.update(app.particles);

  // Render
  if (app.composer) {
    app.composer.render();
  } else {
    app.renderer.render(app.scene, app.camera);
  }

  // HUD
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

// ---- State change ----
function handleStateChange(state, prev) {
  const msgs = {
    [STATES.READY]:     'Click terrain to set target, then Plan & Fire',
    [STATES.PLANNING]:  'Computing firing solution...',
    [STATES.PLANNED]:   'Solution ready — click Fire to launch',
    [STATES.ARMED]:     'Armed — confirm fire',
    [STATES.FIRING]:    'Projectile in flight',
    [STATES.POSTFIRE]:  'Impact recorded — Reset to continue'
  };
  app.hud.setStatus(state, msgs[state]);

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

// ---- Solver result ----
function handleSolverResult(result) {
  if (result.status === 'converged') {
    app.lastResult = result;
    app.lastSolution = result.solution;
    app.profiler.solverMs = result.solution.planningTimeMs;
    app.hud.setSolution(result.solution);
    app.trajectoryViz.updateTrajectory(result.solution.trajectory);
    saveSolverRun(app.lastParams, result);
  } else {
    app.hud.setStatus('error', 'Solver Failed');
    app.hud.showRecovery(result.reason, result.recommendation);
    app.hud.setSolution(null);
  }
}

// ---- Plan & Fire ----
function dispatchPlanAndFire() {
  if (!app.currentTarget) {
    app.hud.setStatus('error', 'Click terrain to set target first');
    return;
  }

  const hud = app.hud;
  const solverParams = {
    targetWorldPos:   app.currentTarget,
    launcherPose:     { pos: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
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
    enableCoriolis:   hud.inputs.coriolis(),
    latitude:         hud.inputs.latitude(),
    spinRPM:          hud.inputs.spin(),
  };

  app.lastParams = solverParams;
  const t0 = performance.now();

  app.stateMachine.dispatch(EVENTS.PLAN_AND_FIRE_CLICKED, { solverParams }).then(() => {
    app.profiler.solverMs = performance.now() - t0;
  });
}

// ---- Launch (supports salvo) ----
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
  const salvoCount  = app.hud.inputs.salvoCount();
  const salvoSpread = app.hud.inputs.salvoSpread();

  for (let i = 0; i < salvoCount; i++) {
    // Add spread offset
    const spreadX = (Math.random() - 0.5) * salvoSpread * 0.01;
    const spreadZ = (Math.random() - 0.5) * salvoSpread * 0.01;
    const spreadElev = (Math.random() - 0.5) * salvoSpread * 0.002;

    const vel = new THREE.Vector3(
      v0 * Math.cos(elevation + spreadElev) * (dir.x + spreadX),
      v0 * Math.sin(elevation + spreadElev),
      v0 * Math.cos(elevation + spreadElev) * (dir.z + spreadZ)
    );

    const spawnPos = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      1.5,
      (Math.random() - 0.5) * 0.5
    );

    const proj = app.projPool.acquire(spawnPos, vel);
    if (proj) {
      app.activeProjectiles.push(proj);
    }

    // Muzzle flash particles
    for (let j = 0; j < 15; j++) {
      app.particles.spawn(
        0, 2, 0,
        vel.x * 0.02 + (Math.random()-0.5)*8,
        vel.y * 0.02 + Math.random()*5,
        vel.z * 0.02 + (Math.random()-0.5)*8,
        0.3, 1.2
      );
    }
  }

  // Camera shake on fire
  app.cameraShake.trigger(0.25 * salvoCount);
}

// ---- Start ----
init().catch(err => {
  console.error('[BallisticsApp] Init failed:', err);
  document.body.innerHTML += `<div style="color:red;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:rgba(0,0,0,0.9);padding:20px;border-radius:10px;font-family:monospace">
    <b>Init Error:</b><br>${err.message}
  </div>`;
});
