// src/ui/hud.js
// HUD fields, profiler strip, energy analytics, salvo mode, replay, debug JSON export

import { getLastSolverRun, getProfilerSamples } from '../db/dexie.js';

export class HUD {
  constructor(island, appRef) {
    this._island = island;
    this._app    = appRef;
    this._body   = island.querySelector('.ui-body');
    this._fields = {};
    this._build();
  }

  _build() {
    this._body.innerHTML = `
      <!-- Status -->
      <div id="hud-status" class="ui-status ready">READY</div>

      <hr class="ui-separator">
      <div class="ui-section-title">Target & Launch</div>

      <div class="ui-row"><span class="ui-label">Target</span>
        <span class="ui-value" id="hud-target">click terrain</span></div>
      <div class="ui-row"><span class="ui-label">Range (m)</span>
        <span class="ui-value" id="hud-range">--</span></div>
      <div class="ui-row"><span class="ui-label">Muzzle Vel</span>
        <input class="ui-input" id="hud-v0" type="number" value="100" min="10" max="2000" step="5"></div>
      <div class="ui-row"><span class="ui-label">Wind X / Z</span>
        <span style="display:flex;gap:3px">
          <input class="ui-input" id="hud-wind-x" type="number" value="0" min="-50" max="50" step="0.5" style="width:42px">
          <input class="ui-input" id="hud-wind-z" type="number" value="0" min="-50" max="50" step="0.5" style="width:42px">
        </span>
      </div>
      <div class="ui-row"><span class="ui-label">Density rho</span>
        <input class="ui-input" id="hud-rho" type="number" value="1.225" min="0" max="5" step="0.01"></div>
      <div class="ui-row">
        <span class="ui-label">Drag</span>
        <label style="color:#c8f0ff;font-size:10px"><input type="checkbox" id="hud-drag" checked> On</label>
      </div>
      <div class="ui-row"><span class="ui-label">High Arc</span>
        <label style="color:#c8f0ff;font-size:10px"><input type="checkbox" id="hud-high-arc"> Prefer</label>
      </div>
      <div class="ui-row"><span class="ui-label">Coriolis</span>
        <label style="color:#c8f0ff;font-size:10px"><input type="checkbox" id="hud-coriolis"> On</label>
      </div>
      <div class="ui-row"><span class="ui-label">Spin (RPM)</span>
        <input class="ui-input" id="hud-spin" type="number" value="0" min="0" max="50000" step="100"></div>
      <div class="ui-row"><span class="ui-label">Latitude</span>
        <input class="ui-input" id="hud-latitude" type="number" value="45" min="-90" max="90" step="1"></div>
      <div class="ui-row"><span class="ui-label">Seed</span>
        <input class="ui-input" id="hud-seed" type="text" value="ballistics" style="width:90px"></div>

      <hr class="ui-separator">
      <div class="ui-section-title">Salvo Mode</div>
      <div class="ui-row"><span class="ui-label">Rounds</span>
        <input class="ui-input" id="hud-salvo-count" type="number" value="1" min="1" max="12" step="1" style="width:42px"></div>
      <div class="ui-row"><span class="ui-label">Spread (m)</span>
        <input class="ui-input" id="hud-salvo-spread" type="number" value="5" min="0" max="50" step="1" style="width:42px"></div>

      <hr class="ui-separator">

      <!-- Action buttons -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:4px 0">
        <button class="ui-btn success" id="btn-plan-fire">PLAN & FIRE</button>
        <button class="ui-btn" id="btn-fire" disabled>FIRE</button>
        <button class="ui-btn danger" id="btn-reset">RESET</button>
      </div>

      <!-- Recovery panel -->
      <div id="recovery-panel" style="display:none">
        <hr class="ui-separator">
        <div style="color:#ff9060;font-size:9px;margin-bottom:4px;letter-spacing:0.5px">SOLVER FAILED — RECOVERY</div>
        <div class="ui-recovery">
          <button class="ui-btn" id="btn-try-high-arc">HIGH ARC</button>
          <button class="ui-btn" id="btn-relax-tof">+TOF</button>
          <button class="ui-btn" id="btn-expand-elev">+ELEV</button>
          <button class="ui-btn" id="btn-reset-wind">NO WIND</button>
          <button class="ui-btn" id="btn-reseed">RESEED</button>
        </div>
        <div id="hud-failure-reason" style="color:#ff7050;font-size:9px;margin-top:4px"></div>
        <div id="hud-recommendation" style="color:#70c070;font-size:9px"></div>
      </div>

      <hr class="ui-separator">
      <div class="ui-section-title">Solution</div>

      <div class="ui-row"><span class="ui-label">Elevation</span>
        <span class="ui-value" id="hud-elevation">--</span></div>
      <div class="ui-row"><span class="ui-label">Arc</span>
        <span class="ui-value" id="hud-arc">--</span></div>
      <div class="ui-row"><span class="ui-label">TOF</span>
        <span class="ui-value" id="hud-tof">--</span></div>
      <div class="ui-row"><span class="ui-label">Impact Err</span>
        <span class="ui-value" id="hud-impact-err">--</span></div>
      <div class="ui-row"><span class="ui-label">Iterations</span>
        <span class="ui-value" id="hud-iters">--</span></div>
      <div class="ui-row"><span class="ui-label">Residual</span>
        <span class="ui-value" id="hud-residual">--</span></div>
      <div class="ui-row"><span class="ui-label">Bracket</span>
        <span class="ui-value" id="hud-bracket">--</span></div>
      <div class="ui-row"><span class="ui-label">Integrator</span>
        <span class="ui-value">RK4</span></div>

      <hr class="ui-separator">
      <div class="ui-section-title">Flight Energy</div>

      <div class="ui-row"><span class="ui-label">Muzzle KE</span>
        <span class="ui-value" id="hud-muzzle-ke">--</span></div>
      <div class="ui-row"><span class="ui-label">Impact KE</span>
        <span class="ui-value" id="hud-impact-ke">--</span></div>
      <div class="ui-row"><span class="ui-label">KE Retained</span>
        <span class="ui-value" id="hud-ke-ratio">--</span></div>
      <div class="ui-energy-bar"><div class="ui-energy-fill" id="hud-ke-bar"
        style="width:0%;background:linear-gradient(90deg,#ff4040,#ffaa40,#40ff40)"></div></div>
      <div class="ui-row"><span class="ui-label">Apex Height</span>
        <span class="ui-value" id="hud-apex">--</span></div>
      <div class="ui-row"><span class="ui-label">Max Speed</span>
        <span class="ui-value" id="hud-max-speed">--</span></div>
      <div class="ui-row"><span class="ui-label">Coriolis Drift</span>
        <span class="ui-value" id="hud-coriolis-drift">--</span></div>
      <div class="ui-row"><span class="ui-label">Magnus Drift</span>
        <span class="ui-value" id="hud-magnus-drift">--</span></div>

      <hr class="ui-separator">
      <div class="ui-section-title">Profiler</div>

      <div id="profiler-strip" style="font-size:10px;line-height:1.5">
        <div class="ui-row"><span class="ui-label">Frame</span><span class="ui-value" id="prof-frame">--</span></div>
        <div class="ui-row"><span class="ui-label">Physics</span><span class="ui-value" id="prof-physics">--</span></div>
        <div class="ui-row"><span class="ui-label">Solver</span><span class="ui-value" id="prof-solver">--</span></div>
        <div class="ui-row"><span class="ui-label">Draws</span><span class="ui-value" id="prof-draws">--</span></div>
        <div class="ui-row"><span class="ui-label">Particles</span><span class="ui-value" id="prof-particles">--</span></div>
      </div>

      <!-- Mini frame time graph -->
      <div class="ui-mini-graph" id="prof-graph"></div>

      <hr class="ui-separator">

      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:4px 0">
        <button class="ui-btn" id="btn-replay">REPLAY</button>
        <button class="ui-btn" id="btn-debug-json">JSON</button>
        <button class="ui-btn" id="btn-run-tests">TESTS</button>
      </div>
    `;

    const $ = id => document.getElementById(id);
    this._fields = {
      status:        $('hud-status'),
      target:        $('hud-target'),
      range:         $('hud-range'),
      elevation:     $('hud-elevation'),
      arc:           $('hud-arc'),
      tof:           $('hud-tof'),
      impactErr:     $('hud-impact-err'),
      iters:         $('hud-iters'),
      residual:      $('hud-residual'),
      bracket:       $('hud-bracket'),
      muzzleKe:      $('hud-muzzle-ke'),
      impactKe:      $('hud-impact-ke'),
      keRatio:       $('hud-ke-ratio'),
      keBar:         $('hud-ke-bar'),
      apex:          $('hud-apex'),
      maxSpeed:      $('hud-max-speed'),
      coriolisDrift: $('hud-coriolis-drift'),
      magnusDrift:   $('hud-magnus-drift'),
      profFrame:     $('prof-frame'),
      profPhysics:   $('prof-physics'),
      profSolver:    $('prof-solver'),
      profDraws:     $('prof-draws'),
      profParticles: $('prof-particles'),
      profGraph:     $('prof-graph'),
      recovery:      $('recovery-panel'),
      failureReason: $('hud-failure-reason'),
      recommendation:$('hud-recommendation'),
    };

    // Mini graph bars
    this._graphSamples = [];
    for (let i = 0; i < 30; i++) {
      const bar = document.createElement('div');
      bar.className = 'ui-mini-bar';
      bar.style.height = '1px';
      this._fields.profGraph.appendChild(bar);
      this._graphSamples.push(bar);
    }
    this._graphIdx = 0;

    this.inputs = {
      v0:         () => parseFloat($('hud-v0').value) || 100,
      windX:      () => parseFloat($('hud-wind-x').value) || 0,
      windZ:      () => parseFloat($('hud-wind-z').value) || 0,
      rho:        () => parseFloat($('hud-rho').value) || 1.225,
      drag:       () => $('hud-drag').checked,
      highArc:    () => $('hud-high-arc').checked,
      coriolis:   () => $('hud-coriolis').checked,
      spin:       () => parseFloat($('hud-spin').value) || 0,
      latitude:   () => parseFloat($('hud-latitude').value) || 45,
      seed:       () => $('hud-seed').value || 'ballistics',
      salvoCount: () => Math.max(1, parseInt($('hud-salvo-count').value) || 1),
      salvoSpread:() => parseFloat($('hud-salvo-spread').value) || 5,
    };

    $('btn-replay').addEventListener('click', () => this._onReplay());
    $('btn-debug-json').addEventListener('click', () => this._onDebugJSON());
    $('btn-run-tests').addEventListener('click', () => this._onRunTests());
  }

  setStatus(state, msg) {
    const el = this._fields.status;
    el.className = `ui-status ${state}`;
    el.textContent = (msg || state).toUpperCase();
  }

  setTarget(pos) {
    if (pos) {
      this._fields.target.textContent =
        `${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`;
      const r = Math.sqrt(pos.x*pos.x + pos.z*pos.z);
      this._fields.range.textContent = `${r.toFixed(1)}m`;
    } else {
      this._fields.target.textContent = 'click terrain';
      this._fields.range.textContent = '--';
    }
  }

  setSolution(solution) {
    const sFields = ['elevation','arc','tof','impactErr','iters','residual','bracket',
                     'muzzleKe','impactKe','keRatio','apex','maxSpeed','coriolisDrift','magnusDrift'];
    if (!solution) {
      sFields.forEach(k => { if (this._fields[k]) this._fields[k].textContent = '--'; });
      if (this._fields.keBar) this._fields.keBar.style.width = '0%';
      return;
    }

    this._fields.elevation.textContent  = `${(solution.elevationDeg || 0).toFixed(2)}deg`;
    this._fields.arc.textContent        = solution.selectedArc || '--';
    this._fields.tof.textContent        = `${(solution.tof || 0).toFixed(2)}s`;
    this._fields.impactErr.textContent  = `${(solution.impactError || 0).toFixed(3)}m`;
    this._fields.iters.textContent      = solution.iterations || '--';
    this._fields.residual.textContent   = `${(solution.residual || 0).toFixed(4)}m`;

    if (solution.bracketDeg) {
      this._fields.bracket.textContent =
        `[${solution.bracketDeg[0].toFixed(1)}, ${solution.bracketDeg[1].toFixed(1)}]`;
    }

    // Energy analytics
    if (solution.energyAnalytics) {
      const ea = solution.energyAnalytics;
      this._fields.muzzleKe.textContent = `${(ea.muzzleKE / 1000).toFixed(1)} kJ`;
      this._fields.impactKe.textContent = `${(ea.impactKE / 1000).toFixed(1)} kJ`;
      const ratio = ea.muzzleKE > 0 ? (ea.impactKE / ea.muzzleKE * 100) : 0;
      this._fields.keRatio.textContent  = `${ratio.toFixed(1)}%`;
      this._fields.keBar.style.width    = `${ratio}%`;
      this._fields.apex.textContent     = `${ea.apexHeight.toFixed(1)}m`;
      this._fields.maxSpeed.textContent = `${ea.maxSpeed.toFixed(1)} m/s`;
      this._fields.coriolisDrift.textContent = `${ea.coriolisDrift.toFixed(2)}m`;
      this._fields.magnusDrift.textContent   = `${ea.magnusDrift.toFixed(2)}m`;
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
    this._fields.profFrame.textContent     = frameMs    != null ? `${frameMs.toFixed(1)}ms`    : '--';
    this._fields.profPhysics.textContent   = physicsMs  != null ? `${physicsMs.toFixed(1)}ms`  : '--';
    this._fields.profSolver.textContent    = solverMs   != null ? `${solverMs.toFixed(1)}ms`   : '--';
    this._fields.profDraws.textContent     = drawCalls  != null ? drawCalls                     : '--';
    this._fields.profParticles.textContent = particles  != null ? particles                      : '--';

    // Update mini graph
    if (frameMs != null) {
      const h = Math.min(24, Math.max(1, frameMs * 1.5));
      const color = frameMs < 8 ? '#40ff80' : frameMs < 16 ? '#ffcc40' : '#ff4040';
      this._graphSamples[this._graphIdx].style.height = `${h}px`;
      this._graphSamples[this._graphIdx].style.background = color;
      this._graphIdx = (this._graphIdx + 1) % this._graphSamples.length;
    }
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
      version: '2.0.0',
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
