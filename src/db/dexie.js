// src/db/dexie.js
// Dexie.js IndexedDB layer with /api/v1/sql mirroring
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.mjs';

export const db = new Dexie('BallisticsApp');

db.version(1).stores({
  uiLayout:        'id,x,y,collapsed',
  settings:        'id',
  solverRuns:      '++id,timestamp',
  profilerSamples: '++id,timestamp'
});

// Mirror to /api/v1/sql (fire-and-forget, best-effort)
async function mirrorSQL(table, data) {
  try {
    await fetch('/api/v1/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, data })
    });
  } catch (_) { /* offline-tolerant */ }
}

// --- UI Layout ---
export async function saveUILayout(layout) {
  await db.uiLayout.put({ id: 'main', ...layout });
  mirrorSQL('uiLayout', { id: 'main', ...layout });
}

export async function loadUILayout() {
  return db.uiLayout.get('main');
}

// --- Settings ---
export async function saveSettings(settings) {
  await db.settings.put({ id: 'main', ...settings });
  mirrorSQL('settings', { id: 'main', ...settings });
}

export async function loadSettings() {
  return db.settings.get('main');
}

// --- Solver Runs (keep last 10) ---
export async function saveSolverRun(inputs, solution) {
  const id = await db.solverRuns.add({
    timestamp: Date.now(),
    inputs,
    solution
  });
  mirrorSQL('solverRuns', { id, timestamp: Date.now(), inputs, solution });
  // prune to last 10
  const count = await db.solverRuns.count();
  if (count > 10) {
    const oldest = await db.solverRuns.orderBy('id').first();
    if (oldest) await db.solverRuns.delete(oldest.id);
  }
}

export async function getLastSolverRun() {
  return db.solverRuns.orderBy('id').last();
}

export async function getAllSolverRuns() {
  return db.solverRuns.orderBy('id').toArray();
}

// --- Profiler Samples (cap 10000) ---
const PROFILER_CAP = 10000;
let _profilerBatch = [];
let _profilerFlushTimer = null;

export function recordProfilerSample(sample) {
  _profilerBatch.push({ timestamp: Date.now(), ...sample });
  if (!_profilerFlushTimer) {
    _profilerFlushTimer = setTimeout(flushProfilerBatch, 500);
  }
}

async function flushProfilerBatch() {
  _profilerFlushTimer = null;
  if (_profilerBatch.length === 0) return;
  const batch = _profilerBatch.splice(0);
  await db.profilerSamples.bulkAdd(batch);
  // prune over cap
  const count = await db.profilerSamples.count();
  if (count > PROFILER_CAP) {
    const overflow = count - PROFILER_CAP;
    const oldest = await db.profilerSamples.orderBy('id').limit(overflow).toArray();
    await db.profilerSamples.bulkDelete(oldest.map(s => s.id));
  }
}

export async function getProfilerSamples(limit = 100) {
  return db.profilerSamples.orderBy('id').reverse().limit(limit).toArray();
}
