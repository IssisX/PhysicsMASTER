// src/tests/mutation.js
// Adversarial mutation harness: 10 deterministic mutations, >=90% pass rate

import { solveFiringSolution } from '../solver/ballistics.js';

function seededRandom(seed) {
  // Simple LCG for portability without seedrandom
  let s = typeof seed === 'string'
    ? seed.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)
    : seed;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function makeBaseScenario() {
  return {
    targetWorldPos:   { x: 150, y: 0, z: 0 },
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
    v0:               100,
  };
}

function generateMutations(rng) {
  const base = makeBaseScenario();
  const mutations = [];

  // M-001: Vary target range (short)
  mutations.push({
    id: 'M-001', desc: 'Short range 30m',
    params: { ...base, targetWorldPos: { x: 30, y: 0, z: 0 }, seed: 'mut001' }
  });

  // M-002: Vary target range (far but feasible)
  mutations.push({
    id: 'M-002', desc: 'Far range 450m, high v0',
    params: { ...base, targetWorldPos: { x: 450, y: 0, z: 0 }, v0: 150, seed: 'mut002' }
  });

  // M-003: Strong crosswind
  mutations.push({
    id: 'M-003', desc: 'Strong crosswind 15 m/s',
    params: { ...base, wind: { vx: 15, vy: 0, vz: 0 }, seed: 'mut003' }
  });

  // M-004: Diagonal target with wind
  mutations.push({
    id: 'M-004', desc: 'Diagonal (100, 0, 100) with wind',
    params: { ...base, targetWorldPos: { x: 100, y: 0, z: 100 }, wind: { vx: 5, vy: 0, vz: -3 }, seed: 'mut004' }
  });

  // M-005: High arc preference
  mutations.push({
    id: 'M-005', desc: 'High arc preference 80m',
    params: { ...base, targetWorldPos: { x: 80, y: 0, z: 0 }, preferHighArc: true, seed: 'mut005' }
  });

  // M-006: No drag
  mutations.push({
    id: 'M-006', desc: 'No drag 200m',
    params: { ...base, targetWorldPos: { x: 200, y: 0, z: 0 }, enableDrag: false, seed: 'mut006' }
  });

  // M-007: Very high air density (dense atmosphere)
  mutations.push({
    id: 'M-007', desc: 'Dense atmosphere rho=2.0',
    params: { ...base, airDensity: 2.0, seed: 'mut007' }
  });

  // M-008: Tight elevation limits
  mutations.push({
    id: 'M-008', desc: 'Tight elevation 30-60deg, 100m',
    params: { ...base, mechanicalLimits: { minElev: 30, maxElev: 60 }, seed: 'mut008' }
  });

  // M-009: Infeasible (correctly detected)
  mutations.push({
    id: 'M-009', desc: 'Infeasible: 20000m target',
    params: { ...base, targetWorldPos: { x: 20000, y: 0, z: 0 }, seed: 'mut009' },
    expectedInfeasible: true
  });

  // M-010: Random perturbation via LCG seeded rng
  const r = rng;
  const rx = 50 + r() * 200;
  const rz = (r() - 0.5) * 100;
  const rv0 = 80 + r() * 80;
  mutations.push({
    id: 'M-010', desc: `Random: range≈${Math.sqrt(rx*rx+rz*rz).toFixed(0)}m v0=${rv0.toFixed(0)}`,
    params: {
      ...base,
      targetWorldPos: { x: rx, y: 0, z: rz },
      v0: rv0,
      wind: { vx: (r()-0.5)*10, vy: 0, vz: (r()-0.5)*5 },
      seed: 'mut010'
    }
  });

  return mutations;
}

export async function runMutationHarness() {
  const rng = seededRandom('mutation-harness-seed');
  const mutations = generateMutations(rng);
  const results = [];

  console.log(`\n=== Mutation Harness: ${mutations.length} cases ===`);

  for (const mut of mutations) {
    const t0 = performance.now();
    let passed = false;
    let status = 'error';
    let error = null;

    try {
      const res = await solveFiringSolution(mut.params);
      const elapsed = performance.now() - t0;
      status = res.status;

      if (mut.expectedInfeasible) {
        passed = res.status === 'infeasible';
      } else {
        passed = res.status === 'converged' &&
                 res.solution.impactError < 10.0 &&
                 res.solution.iterations <= 32;
      }

      const logStr = `[${mut.id}] ${mut.desc} | passed=${passed} | ` +
        `status=${res.status} | time=${elapsed.toFixed(1)}ms | ` +
        (res.status === 'converged'
          ? `error=${res.solution.impactError.toFixed(3)}m iters=${res.solution.iterations}`
          : `reason=${(res.reason||'').substring(0,50)}`);

      console.log(logStr);
      results.push({ id: mut.id, desc: mut.desc, passed, status, elapsed,
                     impactError: res.solution?.impactError, iters: res.solution?.iterations,
                     reason: res.reason });
    } catch (err) {
      const elapsed = performance.now() - t0;
      error = err.message;
      console.error(`[${mut.id}] ${mut.desc} | EXCEPTION: ${err.message}`);
      results.push({ id: mut.id, desc: mut.desc, passed: false, status: 'exception',
                     elapsed, error });
    }
  }

  const passCount = results.filter(r => r.passed).length;
  const passRate  = (passCount / results.length) * 100;
  const meetsCriteria = passRate >= 90;

  console.log(`\n=== Mutation Results: ${passCount}/${results.length} (${passRate.toFixed(0)}%) ` +
              `| Requirement: >=90% | ${meetsCriteria ? 'PASS' : 'FAIL'} ===`);

  if (!meetsCriteria) {
    console.warn('FAILED mutations:', results.filter(r => !r.passed).map(r => r.id).join(', '));
  }

  return { results, passCount, total: results.length, passRate, meetsCriteria };
}
