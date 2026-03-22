// src/ui/layout.js
// UI Island: top-right, draggable, collapsible, auto-hide, Dexie persistence

import { saveUILayout, loadUILayout } from '../db/dexie.js';

export class UILayout {
  constructor(island, controls) {
    this._island    = island;
    this._controls  = controls;  // OrbitControls for change detection
    this._dragging  = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._islandStartX = 0;
    this._islandStartY = 0;
    this._collapsed = false;
    this._hideTimer = null;
    this._hidden    = false;

    this._onOrbitChange = this._onOrbitChange.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp   = this._onPointerUp.bind(this);

    // Default position: top-right
    island.style.position = 'fixed';
    island.style.top      = '20px';
    island.style.right    = '20px';
    island.style.left     = 'auto';
    island.style.zIndex   = '100';
    island.style.transition = 'opacity 0.3s';
    island.style.pointerEvents = 'auto';

    this._setupHeader();
    this._setupCollapse();
    this._setupAutoHide();
    this._loadPosition();
  }

  _setupHeader() {
    const header = this._island.querySelector('.ui-header') || this._island;
    header.style.cursor = 'move';
    header.style.userSelect = 'none';

    header.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    document.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.addEventListener('pointerup', this._onPointerUp, { passive: true });
  }

  _setupCollapse() {
    const btn = this._island.querySelector('.ui-collapse-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this.toggleCollapse());
  }

  _setupAutoHide() {
    if (this._controls) {
      this._controls.addEventListener('change', this._onOrbitChange);
    }
  }

  _onOrbitChange() {
    this._showIsland(false); // hide on camera move
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._showIsland(true), 2000);
  }

  _showIsland(visible) {
    this._hidden = !visible;
    this._island.style.opacity = visible ? '1' : '0';
    this._island.style.pointerEvents = visible ? 'auto' : 'none';
  }

  _onPointerDown(e) {
    this._dragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;

    const rect = this._island.getBoundingClientRect();
    this._islandStartX = rect.left;
    this._islandStartY = rect.top;

    // Switch from right-anchored to left-anchored for dragging
    this._island.style.right = 'auto';
    this._island.style.left = `${rect.left}px`;
    this._island.style.top  = `${rect.top}px`;
  }

  _onPointerMove(e) {
    if (!this._dragging) return;
    const dx = e.clientX - this._dragStartX;
    const dy = e.clientY - this._dragStartY;

    const newX = Math.max(0, Math.min(window.innerWidth - 50,  this._islandStartX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 50, this._islandStartY + dy));

    this._island.style.left = `${newX}px`;
    this._island.style.top  = `${newY}px`;
  }

  _onPointerUp() {
    if (!this._dragging) return;
    this._dragging = false;

    const rect = this._island.getBoundingClientRect();
    this._savePosition(rect.left, rect.top);
  }

  toggleCollapse() {
    this._collapsed = !this._collapsed;
    const body = this._island.querySelector('.ui-body');
    if (body) body.style.display = this._collapsed ? 'none' : '';

    const btn = this._island.querySelector('.ui-collapse-btn');
    if (btn) btn.textContent = this._collapsed ? '▼' : '▲';

    this._savePosition();
  }

  _savePosition(x, y) {
    const rect = this._island.getBoundingClientRect();
    saveUILayout({
      x: x !== undefined ? x : rect.left,
      y: y !== undefined ? y : rect.top,
      collapsed: this._collapsed
    });
  }

  async _loadPosition() {
    const layout = await loadUILayout();
    if (!layout) return;

    if (layout.x !== undefined) {
      this._island.style.right = 'auto';
      this._island.style.left  = `${layout.x}px`;
      this._island.style.top   = `${layout.y}px`;
    }

    if (layout.collapsed) {
      this.toggleCollapse();
    }
  }

  dispose() {
    if (this._controls) {
      this._controls.removeEventListener('change', this._onOrbitChange);
    }
    clearTimeout(this._hideTimer);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup',   this._onPointerUp);
  }
}

/**
 * Build the UI island DOM element
 */
export function buildUIIsland() {
  const island = document.createElement('div');
  island.id = 'ui-island';
  island.innerHTML = `
    <div class="ui-header">
      <span class="ui-title">⚙ Ballistics Control</span>
      <button class="ui-collapse-btn">▲</button>
    </div>
    <div class="ui-body">
      <!-- Controls inserted by main.js -->
    </div>
  `;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #ui-island {
      background: rgba(10,15,25,0.92);
      border: 1px solid rgba(100,200,255,0.3);
      border-radius: 8px;
      min-width: 260px;
      max-width: 320px;
      color: #c8e0ff;
      font-family: monospace;
      font-size: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.6);
      backdrop-filter: blur(8px);
      overflow: hidden;
    }
    .ui-header {
      background: rgba(20,40,80,0.8);
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      border-bottom: 1px solid rgba(100,200,255,0.2);
    }
    .ui-title { font-weight: bold; color: #80c8ff; font-size: 11px; letter-spacing: 0.5px; }
    .ui-collapse-btn {
      background: none; border: none; color: #80c8ff;
      cursor: pointer; font-size: 10px; padding: 0 4px;
    }
    .ui-body { padding: 8px 10px; }
    .ui-row { display: flex; justify-content: space-between; margin: 3px 0; align-items: center; }
    .ui-label { color: #6090b0; font-size: 11px; }
    .ui-value { color: #c8f0ff; font-weight: bold; font-size: 11px; text-align: right; }
    .ui-input { background: rgba(0,20,40,0.8); border: 1px solid rgba(80,160,240,0.4);
                color: #c8f0ff; padding: 2px 6px; border-radius: 3px; font-family: monospace;
                font-size: 11px; width: 90px; }
    .ui-btn {
      background: rgba(20,80,160,0.8); border: 1px solid rgba(80,160,240,0.5);
      color: #c8f0ff; padding: 4px 10px; border-radius: 4px; cursor: pointer;
      font-family: monospace; font-size: 11px; margin: 2px;
      transition: background 0.15s;
    }
    .ui-btn:hover { background: rgba(40,120,220,0.9); }
    .ui-btn.danger { background: rgba(160,30,30,0.8); border-color: rgba(240,80,80,0.5); }
    .ui-btn.danger:hover { background: rgba(200,50,50,0.9); }
    .ui-btn.success { background: rgba(20,120,60,0.8); border-color: rgba(80,220,120,0.5); }
    .ui-btn.success:hover { background: rgba(30,160,80,0.9); }
    .ui-separator { border: none; border-top: 1px solid rgba(80,160,240,0.2); margin: 6px 0; }
    .ui-status { padding: 4px 8px; border-radius: 4px; font-size: 10px; text-align: center; margin: 4px 0; }
    .ui-status.ready    { background: rgba(40,80,40,0.6); color: #80ff80; }
    .ui-status.planning { background: rgba(80,60,0,0.6);  color: #ffd060; }
    .ui-status.planned  { background: rgba(0,60,100,0.6); color: #60c0ff; }
    .ui-status.firing   { background: rgba(120,40,0,0.6); color: #ff8040; }
    .ui-status.postfire { background: rgba(60,0,80,0.6);  color: #d060ff; }
    .ui-status.error    { background: rgba(80,0,0,0.6);   color: #ff6060; }
    .ui-recovery { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
    .ui-spinner { display: inline-block; animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  document.body.appendChild(island);
  return island;
}
