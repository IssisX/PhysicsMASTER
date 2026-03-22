// src/input/touch.js
// Pointer Events pinch zoom with frame-delta scaling

export class PinchZoomHandler {
  constructor(canvas, camera, controls) {
    this._canvas = canvas;
    this._camera = camera;
    this._controls = controls;
    this._pointers = new Map(); // pointerId -> {x, y}
    this._prevDistance = null;
    this._active = false;
    this._frameTime = 0;

    this._onPointerDown   = this._onPointerDown.bind(this);
    this._onPointerMove   = this._onPointerMove.bind(this);
    this._onPointerUp     = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);

    canvas.addEventListener('pointerdown',   this._onPointerDown,   { passive: false });
    canvas.addEventListener('pointermove',   this._onPointerMove,   { passive: false });
    canvas.addEventListener('pointerup',     this._onPointerUp,     { passive: false });
    canvas.addEventListener('pointercancel', this._onPointerCancel, { passive: false });
  }

  _onPointerDown(e) {
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size >= 2) {
      e.preventDefault();
      this._prevDistance = this._getPinchDistance();
      this._active = true;
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;

    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size >= 2) {
      e.preventDefault();

      const t0 = performance.now();
      const dist = this._getPinchDistance();

      if (this._prevDistance !== null && this._prevDistance > 0) {
        const scaleDelta = dist / this._prevDistance;
        this._applyZoom(scaleDelta);
      }

      this._prevDistance = dist;
      this._frameTime = performance.now() - t0;

      if (this._frameTime > 0.1) {
        console.log(`[PinchZoom] Pinch zoom active | frame time: ${this._frameTime.toFixed(2)} ms`);
      }
    }
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);
    this._cleanup();
  }

  _onPointerCancel(e) {
    this._pointers.delete(e.pointerId);
    this._cleanup();
  }

  _cleanup() {
    if (this._pointers.size < 2) {
      this._prevDistance = null;
      this._active = false;
    }
  }

  _getPinchDistance() {
    const pts = Array.from(this._pointers.values());
    if (pts.length < 2) return 0;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx*dx + dy*dy);
  }

  _applyZoom(scaleDelta) {
    if (this._controls && typeof this._controls.dollyIn === 'function') {
      // OrbitControls dolly: dollyIn makes camera closer (zooms in)
      if (scaleDelta > 1) {
        this._controls.dollyIn(scaleDelta);
      } else {
        this._controls.dollyOut(1 / scaleDelta);
      }
      this._controls.update();
    } else if (this._camera.isPerspectiveCamera) {
      // FOV-based fallback
      this._camera.fov = Math.max(10, Math.min(120, this._camera.fov * (1 / scaleDelta)));
      this._camera.updateProjectionMatrix();
    }
  }

  get isActive() { return this._active; }

  dispose() {
    this._canvas.removeEventListener('pointerdown',   this._onPointerDown);
    this._canvas.removeEventListener('pointermove',   this._onPointerMove);
    this._canvas.removeEventListener('pointerup',     this._onPointerUp);
    this._canvas.removeEventListener('pointercancel', this._onPointerCancel);
  }
}
