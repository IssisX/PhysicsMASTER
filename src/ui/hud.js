// src/ui/hud.js
// HUD fields, profiler strip, replay, debug JSON export

import { getLastSolverRun, getProfilerSamples } from '../db/dexie.js';

export class HUD {
  constructor(island, appRef) {
    this._island = island;
    this._app    = appRef;
    this._body   = island.querySelector('.ui-body');
    this._fields = {};
    this._profilerEl = null;
    this._build();
  }

  _build() {
    this._body.innerHTML = `
      <!-- Status -->
      <div id="hud-status" class="ui-status ready">● READY</div>

      <hr class="ui-separator">

      <!-- Target Settings -->
      <div class="ui-row"><span class="ui-label">Target</span>
        <span class="ui-value" id="hud-target">—</span></div>
      <div class="ui-row"><span class="ui-label">Muzzle Vel (m/s)</span>
        <input class="ui-input" id="hud-v0" type="number" value="100" min="10" max="2000" step="5"></div>
      <div class="ui-row"><span class="ui-label">Wind X/Z (m/s)</span>
        <span style="display:flex;gap:3px">
          <input class="ui-input" id="hud-wind-x" type="number" value="0" min="-50" max="50" step="0.5" style="width:42px">
          <input class="ui-input" id="hud-wind-z" type="number" value="0" min="-50" max="50" step="0.5" style="width:42px">
        </span>
      </div>
      <div class="ui-row"><span class="ui-label">Air Density ρ</span>
        <input class="ui-input" id="hud-rho" type="number" value="1.225" min="0" max="5" step="0.01"></div>
      <div class="ui-row">
        <span class="ui-label">Drag</span>
        <label style="color:#c8f0ff;font-size:11px"><input type="checkbox" id="hud-drag" checked> Enable</label>
      </div>
      <div class="ui-row"><span class="ui-label">Prefer High Arc</span>
        <label style="color:#c8f0ff;font-size:11px"><input type="checkbox" id="hud-high-arc"> High</label>
      </div>
      <div class="ui-row"><span class="ui-label">Seed</span>
        <input class="ui-input" id="hud-seed" type="text" value="ballistics" style="width:90px"></div>

      <hr class="ui-separator">

      <!-- Action buttons -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:4px 0">
        <button class="ui-btn success" id="btn-plan-fire">▶ Plan & Fire</button>
        <button class="ui-btn" id="btn-fire" disabled>🔥 Fire</button>
        <button class="ui-btn danger" id="btn-reset">↺ Reset</button>
      </div>

      <!-- Recovery panel (hidden by default) -->
      <div id="recovery-panel" style="display:none">
        <hr class="ui-separator">
        <div style="color:#ff9060;font-size:10px;margin-bottom:4px">⚠ Solver Failed — Recovery Options:</div>
        <div class="ui-recovery">
          <button class="ui-btn" id="btn-try-high-arc">↑ High Arc</button>
          <button class="ui-btn" id="btn-relax-tof">+ Relax TOF</button>
          <button class="ui-btn" id="btn-expand-elev">+ Expand Elev</button>
          <button class="ui-btn" id="btn-reset-wind">No Wind</button>
          <button class="ui-btn" id="btn-reseed">⚄ Re-seed</button>
        </div>
        <div id="hud-failure-reason" style="color:#ff8060;font-size:10px;margin-top:4px"></div>
        <div id="hud-recommendation" style="color:#80d080;font-size:10px"></div>
      </div>

      <hr class="ui-separator">

      <!-- Solution readout -->
      <div class="ui-row"><span class="ui-label">Elevation Offset</span>
        <span class="ui-value" id="hud-elevation">—</span></div>
      <div class="ui-row"><span class="ui-label">Arc</span>
        <span class="ui-value" id="hud-arc">—</span></div>
      <div class="ui-row"><span class="ui-label">TOF (s)</span>
        <span class="ui-value" id="hud-tof">—</span></div>
      <div class="ui-row"><span class="ui-label">Impact Error (m)</span>
        <span class="ui-value" id="hud-impact-err">—</span></div>
      <div class="ui-row"><span class="ui-label">Iterations</span>
        <span class="ui-value" id="hud-iters">—</span></div>
      <div class="ui-row"><span class="ui-label">Residual (m)</span>
        <span class="ui-value" id="hud-residual">—</span></div>
      <div class="ui-row"><span class="ui-label">Bracket [lo,hi]°</span>
        <span class="ui-value" id="hud-bracket">—</span></div>
      <div class="ui-row"><span class="ui-label">Integrator</span>
        <span class="ui-value">RK4</span></div>
      <div class="ui-row"><span class="ui-label">dt (s)</span>
        <span class="ui-value">0.01</span></div>

      <hr class="ui-separator">

      <!-- Profiler strip -->
      <div style="font-size:10px;color:#5080a0">PROFILER</div>
      <div id="profiler-strip" style="font-size:10px;color:#a0c0e0;font-family:monospace;line-height:1.6">
        <div class="ui-row"><span class="ui-label">Frame (ms)</span><span class="ui-value" id="prof-frame">—</span></div>
        <div class="ui-row"><span class="ui-label">Physics (ms)</span><span class="ui-value" id="prof-physics">—</span></div>
        <div class="ui-row"><span class="ui-label">Solver (ms)</span><span class="ui-value" id="prof-solver">—</span></div>
        <div class="ui-row"><span class="ui-label">Draw Calls</span><span class="ui-value" id="prof-draws">—</span></div>
        <div class="ui-row"><span class="ui-label">Particles</span><span class="ui-value" id="prof-particles">—</span></div>
      </div>

      <hr class="ui-separator">

      <!-- Debug controls -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:4px 0">
        <button class="ui-btn" id="btn-replay">⟳ Replay Last</button>
        <button class="ui-btn" id="btn-debug-json">⬇ Debug JSON</button>
        <button class="ui-btn" id="btn-run-tests">✓ Run Tests</button>
      </div>
    `;

    // Cache field references
    const $ = id => document.getElementById(id);
    this._fields = {
      status:        $('hud-status'),
      target:        $('hud-target'),
      elevation:     $('hud-elevation'),
      arc:           $('hud-arc'),
      tof:           $('hud-tof'),
      impactErr:     $('hud-impact-err'),
      iters:         $('hud-iters'),
      residual:      $('hud-residual'),
      bracket:       $('hud-bracket'),
      profFrame:     $('prof-frame'),
      profPhysics:   $('prof-physics'),
      profSolver:    $('prof-solver'),
      profDraws:     $('prof-draws'),
      profParticles: $('prof-particles'),
      recovery:      $('recovery-panel'),
      failureReason: $('hud-failure-reason'),
      recommendation:$('hud-recommendation'),
    };

    // Input accessors
    this.inputs = {
      v0:      () => parseFloat($('hud-v0').value) || 100,
      windX:   () => parseFloat($('hud-wind-x').value) || 0,
      windZ:   () => parseFloat($('hud-wind-z').value) || 0,
      rho:     () => parseFloat($('hud-rho').value) || 1.225,
      drag:    () => $('hud-drag').checked,
      highArc: () => $('hud-high-arc').checked,
      seed:    () => $('hud-seed').value || 'ballistics'
    };

    // Wire debug buttons
    $('btn-replay').addEventListener('click', () => this._onReplay());
    $('btn-debug-json').addEventListener('click', () => this._onDebugJSON());
    $('btn-run-tests').addEventListener('click', () => this._onRunTests());
  }

  setStatus(state, msg) {
    const el = this._fields.status;
    el.className = `ui-status ${state}`;
    const icons = {
      ready:'●', planning:'◌', planned:'◉', armed:'◎', firing:'◆', postfire:'✓', error:'✗'
    };
    el.textContent = `${icons[state] || '●'} ${(msg || state).toUpperCase()}`;
  }

  setTarget(pos) {
    if (pos) {
      this._fields.target.textContent =
        `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
    } else {
      this._fields.target.textContent = '—';
    }
  }

  setSolution(solution) {
    if (!solution) {
      ['elevation','arc','tof','impactErr','iters','residual','bracket'].forEach(k => {
        this._fields[k].textContent = '—';
      });
      return;
    }

    this._fields.elevation.textContent  = `${(solution.elevationDeg || 0).toFixed(2)}°`;
    this._fields.arc.textContent        = solution.selectedArc || '—';
    this._fields.tof.textContent        = `${(solution.tof || 0).toFixed(2)}`;
    this._fields.impactErr.textContent  = `${(solution.impactError || 0).toFixed(3)}`;
    this._fields.iters.textContent      = solution.iterations || '—';
    this._fields.residual.textContent   = `${(solution.residual || 0).toFixed(3)}`;

    if (solution.bracketDeg) {
      this._fields.bracket.textContent =
        `[${solution.bracketDeg[0].toFixed(1)}, ${solution.bracketDeg[1].toFixed(1)}]`;
    }
  }

  showRecovery(reason, recommendation) {
    this._fields.recovery.style.display = 'block';
    this._fields.failureReason.textContent = reason || '';
    this._fields.recommendation.textContent = recommendation || '';
  }

  hideRecovery() {
    this._fields.recovery.style.display = 'none';
  }

  updateProfiler({ frameMs, physicsMs, solverMs, drawCalls, particles }) {
    this._fields.profFrame.textContent     = frameMs    != null ? frameMs.toFixed(2)    : '—';
    this._fields.profPhysics.textContent   = physicsMs  != null ? physicsMs.toFixed(2)  : '—';
    this._fields.profSolver.textContent    = solverMs   != null ? solverMs.toFixed(2)   : '—';
    this._fields.profDraws.textContent     = drawCalls  != null ? drawCalls              : '—';
    this._fields.profParticles.textContent = particles  != null ? particles               : '—';
  }

  async _onReplay() {
    if (this._app && typeof this._app.replayLast === 'function') {
      this._app.replayLast();
    }
  }

  async _onDebugJSON() {
    if (!this._app) return;
    const data = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      inputs: this._app.lastParams,
      solution: this._app.lastResult,
      profiler: this._app.profilerSnapshot,
      testResults: this._app.testResults || null
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ballistics-debug-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async _onRunTests() {
    if (this._app && typeof this._app.runTests === 'function') {
      this._app.runTests();
    }
  }

  wireButtons(handlers) {
    const $ = id => document.getElementById(id);
    if (handlers.planAndFire) $('btn-plan-fire').addEventListener('click', handlers.planAndFire);
    if (handlers.fire)        $('btn-fire').addEventListener('click', handlers.fire);
    if (handlers.reset)       $('btn-reset').addEventListener('click', handlers.reset);
    if (handlers.tryHighArc)  $('btn-try-high-arc').addEventListener('click', handlers.tryHighArc);
    if (handlers.relaxTOF)    $('btn-relax-tof').addEventListener('click', handlers.relaxTOF);
    if (handlers.expandElev)  $('btn-expand-elev').addEventListener('click', handlers.expandElev);
    if (handlers.resetWind)   $('btn-reset-wind').addEventListener('click', handlers.resetWind);
    if (handlers.reseed)      $('btn-reseed').addEventListener('click', handlers.reseed);
    this._fireBtn = $('btn-fire');
  }

  setFireEnabled(enabled) {
    if (this._fireBtn) this._fireBtn.disabled = !enabled;
  }
}
