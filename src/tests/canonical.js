// src/tests/canonical.js
// E-001..E-005 BDD acceptance tests for solveFiringSolution

import { solveFiringSolution } from '../solver/ballistics.js';

const TOL_IMPACT = 5.0;   // meters
const TOL_TIME   = 30;    // max seconds

function makeDefaultParams(overrides = {}) {
  return {
    targetWorldPos:   { x: 100, y: 0, z: 0 },
    launcherPose:     { pos: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
    mechanicalLimits: { minElev: 5, maxElev: 85 },
    maxTimeOfFlight:  30,
    gravity:          -9.81,
    wind:             { vx: 0, vy: 0, vz: 0 },
    airDensity:       1.225,
    dragCoefficient:  0.47,
    projectileArea:   0.0079,
    projectileMass:   10,
    enableDrag:       true,
    toleranceMeters:  1.0,
    seed:             'canonical',
    v0:               100,
    ...overrides
  };
}

export async function runCanonicalTests() {
  const results = [];

  // ---- E-001: Short range (50m), no wind, no drag ----
  {
    const id = 'E-001';
    const desc = 'Short range 50m, no wind, no drag';
    const t0 = performance.now();

    const res = await solveFiringSolution(makeDefaultParams({
      targetWorldPos: { x: 50, y: 0, z: 0 },
      enableDrag: false,
      seed: 'e001'
    }));

    const elapsed = performance.now() - t0;
    const passed = res.status === 'converged' &&
                   res.solution.impactError < TOL_IMPACT &&
                   res.solution.tof < TOL_TIME &&
                   res.solution.iterations <= 32;

    results.push({ id, desc, passed, elapsed, status: res.status,
                   impactError: res.solution?.impactError, iters: res.solution?.iterations });
    console.log(`[${id}] ${desc} | passed=${passed} | time=${elapsed.toFixed(1)}ms | ` +
                `error=${res.solution?.impactError?.toFixed(3)}m | iters=${res.solution?.iterations}`);
  }

  // ---- E-002: Medium range (200m), drag enabled ----
  {
    const id = 'E-002';
    const desc = 'Medium range 200m, drag enabled';
    const t0 = performance.now();

    const res = await solveFiringSolution(makeDefaultParams({
      targetWorldPos: { x: 200, y: 0, z: 0 },
      enableDrag: true,
      seed: 'e002'
    }));

    const elapsed = performance.now() - t0;
    const passed = res.status === 'converged' &&
                   res.solution.impactError < TOL_IMPACT &&
                   res.solution.iterations <= 32;

    results.push({ id, desc, passed, elapsed, status: res.status,
                   impactError: res.solution?.impactError, iters: res.solution?.iterations });
    console.log(`[${id}] ${desc} | passed=${passed} | time=${elapsed.toFixed(1)}ms | ` +
                `error=${res.solution?.impactError?.toFixed(3)}m`);
  }

  // ---- E-003: Diagonal target (XZ both nonzero), wind ----
  {
    const id = 'E-003';
    const desc = 'Diagonal target (150,0,80), wind 5 m/s';
    const t0 = performance.now();

    const res = await solveFiringSolution(makeDefaultParams({
      targetWorldPos: { x: 150, y: 0, z: 80 },
      wind: { vx: 5, vy: 0, vz: 2 },
      enableDrag: true,
      seed: 'e003'
    }));

    const elapsed = performance.now() - t0;
    const passed = res.status === 'converged' &&
                   res.solution.impactError < TOL_IMPACT * 2;

    results.push({ id, desc, passed, elapsed, status: res.status,
                   impactError: res.solution?.impactError, iters: res.solution?.iterations });
    console.log(`[${id}] ${desc} | passed=${passed} | time=${elapsed.toFixed(1)}ms | ` +
                `error=${res.solution?.impactError?.toFixed(3)}m`);
  }

  // ---- E-004: High arc preference ----
  {
    const id = 'E-004';
    const desc = 'High arc preference, 120m range';
    const t0 = performance.now();

    const res = await solveFiringSolution(makeDefaultParams({
      targetWorldPos: { x: 120, y: 0, z: 0 },
      preferHighArc: true,
      enableDrag: true,
      seed: 'e004'
    }));

    const elapsed = performance.now() - t0;
    const passed = res.status === 'converged' &&
                   res.solution.impactError < TOL_IMPACT &&
                   (res.solution.selectedArc === 'high' || res.solution.elevationDeg > 40);

    results.push({ id, desc, passed, elapsed, status: res.status,
                   impactError: res.solution?.impactError, arc: res.solution?.selectedArc,
                   elevDeg: res.solution?.elevationDeg });
    console.log(`[${id}] ${desc} | passed=${passed} | time=${elapsed.toFixed(1)}ms | ` +
                `arc=${res.solution?.selectedArc} elevDeg=${res.solution?.elevationDeg?.toFixed(1)}°`);
  }

  // ---- E-005: Infeasible (beyond vacuum max range) ----
  {
    const id = 'E-005';
    const desc = 'Infeasible: target beyond vacuum max range';
    const t0 = performance.now();

    const res = await solveFiringSolution(makeDefaultParams({
      targetWorldPos: { x: 10000, y: 0, z: 0 },  // way too far for v0=100
      v0: 100,
      seed: 'e005'
    }));

    const elapsed = performance.now() - t0;
    // Pass if correctly declared infeasible
    const passed = res.status === 'infeasible' &&
                   typeof res.reason === 'string' &&
                   typeof res.recommendation === 'string';

    results.push({ id, desc, passed, elapsed, status: res.status, reason: res.reason });
    console.log(`[${id}] ${desc} | passed=${passed} | time=${elapsed.toFixed(1)}ms | ` +
                `reason=${res.reason?.substring(0, 60)}`);
  }

  // Summary
  const passCount = results.filter(r => r.passed).length;
  console.log(`\n=== Canonical Test Results: ${passCount}/${results.length} PASSED ===`);
  if (passCount < results.length) {
    console.warn('FAILED tests:', results.filter(r => !r.passed).map(r => r.id).join(', '));
  }

  return { results, passCount, total: results.length };
}
