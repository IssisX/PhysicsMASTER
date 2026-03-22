// src/solver/ballistics.js
// Async RK4 Ballistics Solver with bracketing, root-finding chain, and kinematic pre-check

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_ITER = 32;

/**
 * RK4 integrator step
 * state = [x,y,z,vx,vy,vz]
 * Returns new state (uses pre-allocated output array)
 */
function rk4Step(state, dt, gravity, wind, k_drag, enableDrag, out) {
  // k_drag = 0.5 * Cd * rho * A / m
  function deriv(s, d) {
    const rx = s[3] - wind.vx;
    const ry = s[4] - wind.vy;
    const rz = s[5] - wind.vz;
    const speed = Math.sqrt(rx*rx + ry*ry + rz*rz);
    const drag = enableDrag ? k_drag * speed : 0;
    d[0] = s[3];
    d[1] = s[4];
    d[2] = s[5];
    d[3] = -drag * rx;
    d[4] = gravity - drag * ry;
    d[5] = -drag * rz;
  }

  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const k3 = new Float64Array(6);
  const k4 = new Float64Array(6);
  const tmp = new Float64Array(6);

  deriv(state, k1);

  for (let i = 0; i < 6; i++) tmp[i] = state[i] + 0.5 * dt * k1[i];
  deriv(tmp, k2);

  for (let i = 0; i < 6; i++) tmp[i] = state[i] + 0.5 * dt * k2[i];
  deriv(tmp, k3);

  for (let i = 0; i < 6; i++) tmp[i] = state[i] + dt * k3[i];
  deriv(tmp, k4);

  for (let i = 0; i < 6; i++) {
    out[i] = state[i] + (dt / 6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);
  }
}

/**
 * Simulate a single trajectory given elevation angle (radians) in 2D XZ plane
 * Returns { range, height, tof, impactPos, trajectory }
 */
function simulateTrajectory(params, elevation, collectTrajectory = false) {
  const {
    launcherPose, gravity, wind, airDensity, dragCoefficient,
    projectileArea, projectileMass, enableDrag, maxTimeOfFlight,
    v0, targetDir
  } = params;

  const dt = params.dt || 0.01;
  const g = gravity; // signed (negative)

  // k_drag = 0.5 * Cd * rho * A / m
  const k_drag = 0.5 * dragCoefficient * airDensity * projectileArea / projectileMass;

  // Compute initial velocity vector
  // elevation is angle above horizontal in the targetDir plane
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);

  // targetDir is normalized XZ vector from launcher to target
  const vx = v0 * cosE * targetDir.x;
  const vy = v0 * sinE;
  const vz = v0 * cosE * targetDir.z;

  const state = new Float64Array(6);
  state[0] = launcherPose.pos.x;
  state[1] = launcherPose.pos.y;
  state[2] = launcherPose.pos.z;
  state[3] = vx;
  state[4] = vy;
  state[5] = vz;

  const next = new Float64Array(6);

  let t = 0;
  let maxT = maxTimeOfFlight;
  const samples = collectTrajectory ? [] : null;

  // terrain height function (flat by default, can be extended)
  const terrainY = params.terrainHeight || 0;

  if (collectTrajectory) {
    samples.push({ x: state[0], y: state[1], z: state[2], t: 0 });
  }

  let prevState = state.slice();
  let landedY = terrainY;

  while (t < maxT) {
    rk4Step(state, dt, g, wind, k_drag, enableDrag, next);
    t += dt;

    // Check if crossed terrain
    if (next[1] <= terrainY) {
      // Linear interpolation to find exact impact
      const frac = (state[1] - terrainY) / (state[1] - next[1]);
      const impactX = state[0] + frac * (next[0] - state[0]);
      const impactZ = state[2] + frac * (next[2] - state[2]);

      if (collectTrajectory) {
        samples.push({ x: impactX, y: terrainY, z: impactZ, t: t });
      }

      const dx = impactX - launcherPose.pos.x;
      const dz = impactZ - launcherPose.pos.z;
      const range = Math.sqrt(dx*dx + dz*dz);

      return {
        range,
        height: terrainY,
        tof: t - dt + frac * dt,
        impactPos: { x: impactX, y: terrainY, z: impactZ },
        trajectory: samples
      };
    }

    for (let i = 0; i < 6; i++) state[i] = next[i];

    if (collectTrajectory && (t * 100 | 0) % 5 === 0) {
      samples.push({ x: state[0], y: state[1], z: state[2], t });
    }
  }

  // Did not land within maxTOF — return last position range
  const dx = state[0] - launcherPose.pos.x;
  const dz = state[2] - launcherPose.pos.z;
  return {
    range: Math.sqrt(dx*dx + dz*dz),
    height: state[1],
    tof: maxT,
    impactPos: { x: state[0], y: state[1], z: state[2] },
    trajectory: samples
  };
}

/**
 * Objective function: f(theta) = simulated_range(theta) - targetRange
 * Negative means undershoot, positive means overshoot
 */
function objective(params, theta) {
  const result = simulateTrajectory(params, theta);
  return result.range - params.targetRange;
}

/**
 * Main async solver
 */
export async function solveFiringSolution(params) {
  const {
    targetWorldPos,
    launcherPose,
    mechanicalLimits = { minElev: 5, maxElev: 85 },
    maxTimeOfFlight = 30,
    gravity = -9.81,
    wind = { vx: 0, vy: 0, vz: 0 },
    airDensity = 1.225,
    dragCoefficient = 0.47,
    projectileArea = 0.0079,
    projectileMass = 10,
    enableDrag = true,
    toleranceMeters = 1.0,
    seed = 'ballistics',
    preferHighArc = false,
    v0 = 100,
    terrainHeight = 0
  } = params;

  // Seed RNG for determinism
  if (typeof Math.seedrandom === 'function') {
    Math.seedrandom(seed);
  }

  const startTime = performance.now();
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log('[Solver]', msg); };

  // --- Step 0: Kinematic Feasibility Pre-Check ---
  const dx = targetWorldPos.x - launcherPose.pos.x;
  const dz = targetWorldPos.z - launcherPose.pos.z;
  const targetRange = Math.sqrt(dx*dx + dz*dz);

  // Normalized horizontal direction to target
  const targetDir = targetRange > 0
    ? { x: dx / targetRange, z: dz / targetRange }
    : { x: 1, z: 0 };

  const g_abs = Math.abs(gravity);
  const R_max_vac = v0 * v0 / g_abs;

  if (targetRange > R_max_vac) {
    log(`INFEASIBILITY PROOF: Target range ${targetRange.toFixed(1)}m exceeds vacuum max ${R_max_vac.toFixed(1)}m`);
    return {
      status: 'infeasible',
      reason: `Target exceeds kinematic max (vacuum). Range: ${targetRange.toFixed(1)}m, Max: ${R_max_vac.toFixed(1)}m`,
      recommendation: 'Increase muzzle velocity or move closer.',
      logs
    };
  }

  log(`Kinematic Pre-Check: PASSED (target ${targetRange.toFixed(1)}m within vacuum max ${R_max_vac.toFixed(1)}m)`);

  // Build solver params object (reuse across calls)
  const solverParams = {
    launcherPose,
    gravity,
    wind,
    airDensity,
    dragCoefficient,
    projectileArea,
    projectileMass,
    enableDrag,
    maxTimeOfFlight,
    v0,
    targetDir,
    targetRange,
    terrainHeight,
    dt: 0.01
  };

  const minElevRad = mechanicalLimits.minElev * DEG2RAD;
  const maxElevRad = mechanicalLimits.maxElev * DEG2RAD;

  // --- Step 1: Analytic vacuum seed angles ---
  let thetaLow, thetaHigh;
  const sinArg = g_abs * targetRange / (v0 * v0);

  if (sinArg <= 1.0) {
    thetaLow  = 0.5 * Math.asin(sinArg);
    thetaHigh = Math.PI / 2 - thetaLow;
  } else {
    // Beyond vacuum optimum — use limit angles
    thetaLow  = 45 * DEG2RAD;
    thetaHigh = 80 * DEG2RAD;
  }

  // Clamp to mechanical limits
  thetaLow  = Math.max(minElevRad, Math.min(maxElevRad, thetaLow));
  thetaHigh = Math.max(minElevRad, Math.min(maxElevRad, thetaHigh));

  log(`Vacuum seeds: low=${(thetaLow*RAD2DEG).toFixed(1)}°, high=${(thetaHigh*RAD2DEG).toFixed(1)}°`);

  // --- Step 2: Bracketing Phase ---
  let bracketA = null, bracketB = null;
  let relaxationAttempts = 0;
  let currentMaxTOF = maxTimeOfFlight;
  let currentMaxElev = mechanicalLimits.maxElev;
  let solverEnableDrag = enableDrag;

  const SCAN_STEPS = 18; // 5 deg steps from 5 to 89

  function scanForBracket(scanMin, scanMax, nSteps, dragging) {
    const step = (scanMax - scanMin) / nSteps;
    let prevTheta = scanMin;
    let prevF = objective({ ...solverParams, enableDrag: dragging, maxTimeOfFlight: currentMaxTOF }, prevTheta);
    let best = { theta: prevTheta, absF: Math.abs(prevF) };

    for (let i = 1; i <= nSteps; i++) {
      const theta = scanMin + i * step;
      const f = objective({ ...solverParams, enableDrag: dragging, maxTimeOfFlight: currentMaxTOF }, theta);

      if (Math.abs(f) < best.absF) {
        best = { theta, absF: Math.abs(f) };
      }

      if (prevF * f < 0) {
        // Sign change found
        if (preferHighArc && theta < Math.PI / 4) {
          // Don't accept low arc if user prefers high
        } else {
          return { a: prevTheta, b: theta, fa: prevF, fb: f };
        }
      }
      prevTheta = theta;
      prevF = f;
    }
    return null;
  }

  // Primary scan across full elevation range
  let bracket = scanForBracket(minElevRad, maxElevRad, SCAN_STEPS, solverEnableDrag);

  if (!bracket && preferHighArc) {
    // Try high arc first
    bracket = scanForBracket(maxElevRad - 20*DEG2RAD, maxElevRad, 10, solverEnableDrag);
    if (bracket) { log('Bracket found via high-arc preference scan'); }
  }

  if (!bracket) {
    // Fallback 1: Prefer High Arc scan
    log('No bracket in primary scan. Fallback 1: High Arc scan [maxElev-20, maxElev]');
    bracket = scanForBracket(
      Math.max(minElevRad, (currentMaxElev - 20) * DEG2RAD),
      currentMaxElev * DEG2RAD,
      10, solverEnableDrag
    );
    if (bracket) { relaxationAttempts++; log('Bracket found in high-arc fallback'); }
  }

  if (!bracket) {
    // Fallback 2: Relax TOF
    relaxationAttempts++;
    currentMaxTOF *= 1.2;
    log(`Fallback 2: Relaxing TOT to ${currentMaxTOF.toFixed(1)}s`);
    solverParams.maxTimeOfFlight = currentMaxTOF;
    bracket = scanForBracket(minElevRad, maxElevRad, SCAN_STEPS, solverEnableDrag);
    if (bracket) log('Bracket found after TOF relaxation');
  }

  if (!bracket) {
    // Fallback 3: Expand elevation
    relaxationAttempts++;
    currentMaxElev = Math.min(89, currentMaxElev + 2);
    log(`Fallback 3: Expanding elevation to ${currentMaxElev}°`);
    bracket = scanForBracket(minElevRad, currentMaxElev * DEG2RAD, SCAN_STEPS, solverEnableDrag);
    if (bracket) log('Bracket found after elevation expansion');
  }

  if (!bracket) {
    // Fallback 4: Disable drag to get seed
    relaxationAttempts++;
    log('Fallback 4: Disabling drag for seed');
    const noDragBracket = scanForBracket(minElevRad, currentMaxElev * DEG2RAD, SCAN_STEPS, false);
    if (noDragBracket) {
      // Re-enable drag and use seed angles
      solverEnableDrag = enableDrag;
      // Start with drag-free bracket as seed
      bracket = noDragBracket;
      // Refine: scan tightly around the no-drag bracket
      const center = (noDragBracket.a + noDragBracket.b) / 2;
      const tight = scanForBracket(
        Math.max(minElevRad, center - 5*DEG2RAD),
        Math.min(currentMaxElev*DEG2RAD, center + 5*DEG2RAD),
        20, solverEnableDrag
      );
      if (tight) {
        bracket = tight;
        log('Refined bracket via no-drag seed');
      }
    }
  }

  if (!bracket) {
    // Compute max achievable range for diagnostics
    const maxRangeResult = simulateTrajectory(
      { ...solverParams, maxTimeOfFlight: currentMaxTOF },
      45 * DEG2RAD
    );
    log(`INFEASIBILITY PROOF (drag/wind): Max simulated range ≈ ${maxRangeResult.range.toFixed(1)}m, target ${targetRange.toFixed(1)}m`);
    return {
      status: 'infeasible',
      reason: `No valid firing solution found. Max simulated range ≈ ${maxRangeResult.range.toFixed(1)}m at 45°, target requires ${targetRange.toFixed(1)}m.`,
      recommendation: 'Reduce wind, disable drag, or bring target closer.',
      logs,
      relaxationAttempts
    };
  }

  log(`Bracket found: [${(bracket.a*RAD2DEG).toFixed(2)}°, ${(bracket.b*RAD2DEG).toFixed(2)}°] f=[${bracket.fa.toFixed(2)}, ${bracket.fb.toFixed(2)}]`);

  // --- Step 3: Root-Finding Chain ---
  const finalParams = { ...solverParams, enableDrag: solverEnableDrag, maxTimeOfFlight: currentMaxTOF };
  const tol = toleranceMeters; // meters in range

  let a = bracket.a, b = bracket.b;
  let fa = bracket.fa, fb = bracket.fb;
  let theta = (preferHighArc) ? b : a + (b - a) * Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
  let iterations = 0;
  let residual = Infinity;

  // Method 1: Bracketed Newton-Raphson with backtracking
  let newtonFailed = false;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterations++;
    const f = objective(finalParams, theta);
    residual = Math.abs(f);

    if (residual < tol) break;

    // Numerical derivative
    const dTheta = 1e-5;
    const fp = (objective(finalParams, theta + dTheta) - f) / dTheta;

    if (Math.abs(fp) < 1e-10) {
      newtonFailed = true; break;
    }

    let newTheta = theta - f / fp;

    // Backtracking: keep within bracket
    let backIter = 0;
    while ((newTheta < a || newTheta > b) && backIter < 10) {
      newTheta = (newTheta + theta) / 2;
      backIter++;
    }
    newTheta = Math.max(a, Math.min(b, newTheta));

    const fNew = objective(finalParams, newTheta);

    // Update bracket
    if (f * fNew < 0) {
      if (newTheta < theta) { a = newTheta; fa = fNew; }
      else { b = newTheta; fb = fNew; }
    } else {
      if (fa * fNew < 0) { b = newTheta; fb = fNew; }
      else { a = newTheta; fa = fNew; }
    }

    theta = newTheta;
  }

  if (residual >= tol) {
    // Method 2: Secant within bracket
    log(`Newton didn't converge (residual=${residual.toFixed(2)}m), falling back to Secant`);
    let x0 = a, x1 = b;
    let f0 = fa, f1 = fb;

    for (let iter = 0; iter < MAX_ITER && Math.abs(f1) >= tol; iter++) {
      iterations++;
      if (Math.abs(f1 - f0) < 1e-14) break;
      const x2 = x1 - f1 * (x1 - x0) / (f1 - f0);
      const x2c = Math.max(a, Math.min(b, x2));
      const f2 = objective(finalParams, x2c);
      x0 = x1; f0 = f1;
      x1 = x2c; f1 = f2;
      residual = Math.abs(f2);
    }
    theta = x1;
  }

  if (residual >= tol) {
    // Method 3: Bisection guarantee
    log(`Secant didn't converge (residual=${residual.toFixed(2)}m), falling back to Bisection`);
    a = bracket.a; b = bracket.b;
    fa = bracket.fa; fb = bracket.fb;

    for (let iter = 0; iter < MAX_ITER && Math.abs(b - a) * v0 > tol * 0.5; iter++) {
      iterations++;
      theta = (a + b) / 2;
      const fm = objective(finalParams, theta);
      residual = Math.abs(fm);
      if (residual < tol) break;
      if (fa * fm < 0) { b = theta; fb = fm; }
      else { a = theta; fa = fm; }
    }
  }

  // Final trajectory collection
  const finalResult = simulateTrajectory(finalParams, theta, true);
  const impactError = Math.abs(finalResult.range - targetRange);

  const elapsed = performance.now() - startTime;
  log(`Converged: elevation=${(theta*RAD2DEG).toFixed(3)}°, impactError=${impactError.toFixed(3)}m, iters=${iterations}, time=${elapsed.toFixed(1)}ms`);

  // Determine arc type
  const selectedArc = theta > 44 * DEG2RAD ? 'high' : 'low';

  return {
    status: 'converged',
    solution: {
      elevation: theta,
      elevationDeg: theta * RAD2DEG,
      selectedArc,
      trajectory: finalResult.trajectory,
      tof: finalResult.tof,
      impactPos: finalResult.impactPos,
      impactError,
      iterations,
      relaxationAttempts,
      residual,
      bracketDeg: [bracket.a * RAD2DEG, bracket.b * RAD2DEG],
      planningTimeMs: elapsed,
      logs
    }
  };
}

/**
 * Create a solver worker via Blob URL
 * Returns { solve: async (params) => result, terminate: () => void }
 */
export function createSolverWorker() {
  const solverCode = `
${rk4Step.toString()}
${simulateTrajectory.toString()}
${objective.toString()}
${solveFiringSolution.toString()}

// Expose performance.now in worker context
if (typeof performance === 'undefined') {
  self.performance = { now: () => Date.now() };
}

self.onmessage = async function(e) {
  const { id, params } = e.data;
  try {
    const result = await solveFiringSolution(params);
    self.postMessage({ id, result });
  } catch(err) {
    self.postMessage({ id, error: err.message });
  }
};
`;

  const blob = new Blob([solverCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  let _idCounter = 0;
  const _pending = new Map();

  worker.onmessage = (e) => {
    const { id, result, error } = e.data;
    const handler = _pending.get(id);
    if (handler) {
      _pending.delete(id);
      if (error) handler.reject(new Error(error));
      else handler.resolve(result);
    }
  };

  worker.onerror = (e) => {
    console.error('[SolverWorker] Error:', e.message);
  };

  return {
    solve: (params) => new Promise((resolve, reject) => {
      const id = ++_idCounter;
      _pending.set(id, { resolve, reject });
      worker.postMessage({ id, params });
    }),
    terminate: () => {
      URL.revokeObjectURL(url);
      worker.terminate();
    }
  };
}

export { simulateTrajectory };
