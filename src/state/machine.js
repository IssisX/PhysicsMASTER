// src/state/machine.js
// Hardened state machine: ready->planning->planned->armed->firing->postfire

const STATES = {
  READY:     'ready',
  PLANNING:  'planning',
  PLANNED:   'planned',
  ARMED:     'armed',
  FIRING:    'firing',
  POSTFIRE:  'postfire'
};

const EVENTS = {
  PLAN_AND_FIRE_CLICKED: 'PLAN_AND_FIRE_CLICKED',
  SOLVER_SUCCESS:        'SOLVER_SUCCESS',
  SOLVER_FAILURE:        'SOLVER_FAILURE',
  FIRE_CLICKED:          'FIRE_CLICKED',
  CONFIRM_FIRE:          'CONFIRM_FIRE',
  PROJECTILE_LANDED:     'PROJECTILE_LANDED',
  RESET_CLICKED:         'RESET_CLICKED',
  TRY_HIGH_ARC:          'TRY_HIGH_ARC',
  RELAX_TOF:             'RELAX_TOF',
  EXPAND_ELEVATION:      'EXPAND_ELEVATION',
  RESET_WIND_DRAG:       'RESET_WIND_DRAG',
  RESEED_GUESS:          'RESEED_GUESS'
};

export class StateMachine {
  constructor({ solver, onStateChange, onSolverResult, onError }) {
    this._state = STATES.READY;
    this._solver = solver;
    this._onStateChange = onStateChange || (() => {});
    this._onSolverResult = onSolverResult || (() => {});
    this._onError = onError || console.error;
    this._lastSolverResult = null;
    this._lastParams = null;
    this._listeners = new Map();

    // Transition table: [currentState][event] -> {nextState, handler}
    this._transitions = {
      [STATES.READY]: {
        [EVENTS.PLAN_AND_FIRE_CLICKED]: {
          next: STATES.PLANNING,
          handler: this._handlePlanAndFire.bind(this)
        }
      },
      [STATES.PLANNING]: {
        [EVENTS.PLAN_AND_FIRE_CLICKED]: {
          next: STATES.PLANNING, // Retry from planning
          handler: this._handlePlanAndFire.bind(this)
        },
        [EVENTS.SOLVER_SUCCESS]: {
          next: STATES.PLANNED,
          handler: this._handleSolverSuccess.bind(this)
        },
        [EVENTS.SOLVER_FAILURE]: {
          next: STATES.PLANNING, // Stay in planning; show recovery UI
          handler: this._handleSolverFailure.bind(this)
        },
        [EVENTS.TRY_HIGH_ARC]:       { next: STATES.PLANNING, handler: this._handleTryHighArc.bind(this) },
        [EVENTS.RELAX_TOF]:          { next: STATES.PLANNING, handler: this._handleRelaxTOF.bind(this) },
        [EVENTS.EXPAND_ELEVATION]:   { next: STATES.PLANNING, handler: this._handleExpandElevation.bind(this) },
        [EVENTS.RESET_WIND_DRAG]:    { next: STATES.PLANNING, handler: this._handleResetWindDrag.bind(this) },
        [EVENTS.RESEED_GUESS]:       { next: STATES.PLANNING, handler: this._handleReseedGuess.bind(this) },
        [EVENTS.RESET_CLICKED]:      { next: STATES.READY,    handler: this._handleReset.bind(this) }
      },
      [STATES.PLANNED]: {
        [EVENTS.FIRE_CLICKED]: {
          next: STATES.ARMED,
          handler: this._handleFireClicked.bind(this)
        },
        [EVENTS.RESET_CLICKED]: { next: STATES.READY, handler: this._handleReset.bind(this) },
        [EVENTS.PLAN_AND_FIRE_CLICKED]: {
          next: STATES.PLANNING,
          handler: this._handlePlanAndFire.bind(this)
        }
      },
      [STATES.ARMED]: {
        [EVENTS.CONFIRM_FIRE]: {
          next: STATES.FIRING,
          handler: this._handleConfirmFire.bind(this)
        },
        [EVENTS.RESET_CLICKED]: { next: STATES.READY, handler: this._handleReset.bind(this) }
      },
      [STATES.FIRING]: {
        [EVENTS.PROJECTILE_LANDED]: {
          next: STATES.POSTFIRE,
          handler: this._handleProjectileLanded.bind(this)
        }
      },
      [STATES.POSTFIRE]: {
        [EVENTS.RESET_CLICKED]: { next: STATES.READY, handler: this._handleReset.bind(this) },
        [EVENTS.PLAN_AND_FIRE_CLICKED]: {
          next: STATES.PLANNING,
          handler: this._handlePlanAndFire.bind(this)
        }
      }
    };
  }

  get state() { return this._state; }
  get lastResult() { return this._lastSolverResult; }
  get lastParams() { return this._lastParams; }

  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(listener);
    return () => {
      const arr = this._listeners.get(event);
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  _emit(event, data) {
    const listeners = this._listeners.get(event) || [];
    for (const fn of listeners) fn(data);
  }

  async dispatch(event, data = {}) {
    const stateTransitions = this._transitions[this._state];
    if (!stateTransitions || !stateTransitions[event]) {
      console.warn(`[StateMachine] Invalid transition: ${this._state} + ${event}`);
      return;
    }

    const { next, handler } = stateTransitions[event];
    const prevState = this._state;

    // Transition immediately for non-async start
    if (next !== this._state) {
      this._state = next;
      console.log(`[StateMachine] ${prevState} --[${event}]--> ${this._state}`);
      this._onStateChange(this._state, prevState, event, data);
      this._emit('stateChange', { state: this._state, prev: prevState, event, data });
    }

    try {
      await handler(data);
    } catch (err) {
      this._onError(err);
    }
  }

  // --- Handlers ---

  async _handlePlanAndFire(data) {
    this._lastParams = data.solverParams;
    if (!this._lastParams) return;

    this._emit('planningStart', { params: this._lastParams });

    try {
      const result = await this._solver.solve(this._lastParams);
      if (result.status === 'converged') {
        await this.dispatch(EVENTS.SOLVER_SUCCESS, { result });
      } else {
        await this.dispatch(EVENTS.SOLVER_FAILURE, { result });
      }
    } catch (err) {
      await this.dispatch(EVENTS.SOLVER_FAILURE, {
        result: { status: 'error', reason: err.message, recommendation: 'Check solver parameters.' }
      });
    }
  }

  async _handleSolverSuccess(data) {
    this._lastSolverResult = data.result;
    this._onSolverResult(data.result);
    this._emit('solverSuccess', data);
  }

  async _handleSolverFailure(data) {
    this._lastSolverResult = data.result;
    this._onSolverResult(data.result);
    this._emit('solverFailure', data);
  }

  async _handleFireClicked() {
    // Auto-confirm if no confirmation gate needed
    await this.dispatch(EVENTS.CONFIRM_FIRE);
  }

  async _handleConfirmFire() {
    this._emit('firing', { solution: this._lastSolverResult });
  }

  async _handleProjectileLanded(data) {
    this._emit('landed', data);
  }

  async _handleReset() {
    this._lastSolverResult = null;
    this._lastParams = null;
    this._emit('reset', {});
  }

  // Recovery handlers
  async _handleTryHighArc() {
    if (!this._lastParams) return;
    const params = { ...this._lastParams, preferHighArc: true };
    await this._handlePlanAndFire({ solverParams: params });
  }

  async _handleRelaxTOF() {
    if (!this._lastParams) return;
    const params = { ...this._lastParams, maxTimeOfFlight: (this._lastParams.maxTimeOfFlight || 30) * 1.2 };
    await this._handlePlanAndFire({ solverParams: params });
  }

  async _handleExpandElevation() {
    if (!this._lastParams) return;
    const limits = this._lastParams.mechanicalLimits || { minElev: 5, maxElev: 85 };
    const params = {
      ...this._lastParams,
      mechanicalLimits: { ...limits, maxElev: Math.min(89, limits.maxElev + 2) }
    };
    await this._handlePlanAndFire({ solverParams: params });
  }

  async _handleResetWindDrag() {
    if (!this._lastParams) return;
    const params = {
      ...this._lastParams,
      wind: { vx: 0, vy: 0, vz: 0 },
      enableDrag: false
    };
    await this._handlePlanAndFire({ solverParams: params });
  }

  async _handleReseedGuess() {
    if (!this._lastParams) return;
    const params = { ...this._lastParams, seed: String(Date.now()) };
    await this._handlePlanAndFire({ solverParams: params });
  }
}

export { STATES, EVENTS };
