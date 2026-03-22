// src/ui/layout.js
// UI Island: top-right, draggable, collapsible, smart auto-hide, Dexie persistence

import { saveUILayout, loadUILayout } from '../db/dexie.js';

export class UILayout {
  constructor(island, controls) {
    this._island    = island;
    this._controls  = controls;
    this._dragging  = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._islandStartX = 0;
    this._islandStartY = 0;
    this._collapsed = false;
    this._hideTimer = null;
    this._hidden    = false;
    this._sustainedDrag = false;  // only hide on sustained orbit drag, not clicks
    this._dragFrames = 0;

    this._onOrbitStart  = this._onOrbitStart.bind(this);
    this._onOrbitEnd    = this._onOrbitEnd.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp   = this._onPointerUp.bind(this);

    // Default position: top-right
    island.style.position = 'fixed';
    island.style.top      = '20px';
    island.style.right    = '20px';
    island.style.left     = 'auto';
    island.style.zIndex   = '100';
    island.style.transition = 'opacity 0.4s';
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
    if (!this._controls) return;
    // Use start/end events instead of 'change' to only trigger on sustained drag
    this._controls.addEventListener('start', this._onOrbitStart);
    this._controls.addEventListener('end', this._onOrbitEnd);
  }

  _onOrbitStart() {
    this._dragFrames = 0;
    this._sustainedDrag = false;
    // Start a timer — only fade after 300ms of continuous drag (not just a click)
    this._sustainedTimer = setTimeout(() => {
      this._sustainedDrag = true;
      this._showIsland(false);
    }, 300);
  }

  _onOrbitEnd() {
    clearTimeout(this._sustainedTimer);
    // If we faded out during drag, fade back in after a short delay
    if (this._sustainedDrag) {
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => this._showIsland(true), 600);
    }
    this._sustainedDrag = false;
  }

  _showIsland(visible) {
    this._hidden = !visible;
    // Fade to low opacity rather than full invisible — always partially visible
    this._island.style.opacity = visible ? '1' : '0.25';
    this._island.style.pointerEvents = visible ? 'auto' : 'none';
  }

  _onPointerDown(e) {
    this._dragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;

    const rect = this._island.getBoundingClientRect();
    this._islandStartX = rect.left;
    this._islandStartY = rect.top;

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
      this._controls.removeEventListener('start', this._onOrbitStart);
      this._controls.removeEventListener('end', this._onOrbitEnd);
    }
    clearTimeout(this._hideTimer);
    clearTimeout(this._sustainedTimer);
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
      <span class="ui-title">BALLISTICS CONTROL</span>
      <button class="ui-collapse-btn">▲</button>
    </div>
    <div class="ui-body">
      <!-- Controls inserted by HUD -->
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #ui-island {
      background: rgba(8,12,22,0.94);
      border: 1px solid rgba(80,180,255,0.25);
      border-radius: 10px;
      min-width: 270px;
      max-width: 330px;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      overflow-x: hidden;
      color: #c8e0ff;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      box-shadow: 0 4px 30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(100,200,255,0.08);
      backdrop-filter: blur(12px);
    }
    #ui-island::-webkit-scrollbar { width: 4px; }
    #ui-island::-webkit-scrollbar-track { background: transparent; }
    #ui-island::-webkit-scrollbar-thumb { background: rgba(80,160,255,0.3); border-radius: 2px; }
    .ui-header {
      background: linear-gradient(135deg, rgba(20,40,80,0.9), rgba(15,30,60,0.9));
      padding: 7px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      border-bottom: 1px solid rgba(80,180,255,0.15);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .ui-title { font-weight: bold; color: #70b8ff; font-size: 10px; letter-spacing: 1.5px; }
    .ui-collapse-btn {
      background: none; border: none; color: #70b8ff;
      cursor: pointer; font-size: 10px; padding: 0 4px;
    }
    .ui-body { padding: 8px 10px; }
    .ui-row { display: flex; justify-content: space-between; margin: 3px 0; align-items: center; }
    .ui-label { color: #5888a8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
    .ui-value { color: #c8f0ff; font-weight: bold; font-size: 11px; text-align: right; }
    .ui-input { background: rgba(0,15,30,0.9); border: 1px solid rgba(60,140,220,0.35);
                color: #c8f0ff; padding: 3px 6px; border-radius: 3px; font-family: 'Courier New', monospace;
                font-size: 11px; width: 90px; outline: none; transition: border-color 0.2s; }
    .ui-input:focus { border-color: rgba(80,180,255,0.7); }
    .ui-btn {
      background: linear-gradient(180deg, rgba(25,80,160,0.85), rgba(18,60,120,0.85));
      border: 1px solid rgba(60,150,240,0.4);
      color: #c8f0ff; padding: 5px 11px; border-radius: 4px; cursor: pointer;
      font-family: 'Courier New', monospace; font-size: 10px; margin: 2px;
      transition: all 0.15s; letter-spacing: 0.3px;
    }
    .ui-btn:hover { background: linear-gradient(180deg, rgba(40,120,220,0.95), rgba(30,90,180,0.95));
                    border-color: rgba(80,180,255,0.6); transform: translateY(-1px); }
    .ui-btn:active { transform: translateY(0); }
    .ui-btn.danger { background: linear-gradient(180deg, rgba(140,25,25,0.85), rgba(100,18,18,0.85));
                     border-color: rgba(220,60,60,0.4); }
    .ui-btn.danger:hover { background: linear-gradient(180deg, rgba(180,40,40,0.95), rgba(140,30,30,0.95)); }
    .ui-btn.success { background: linear-gradient(180deg, rgba(20,110,55,0.85), rgba(15,80,40,0.85));
                      border-color: rgba(60,200,100,0.4); }
    .ui-btn.success:hover { background: linear-gradient(180deg, rgba(30,150,70,0.95), rgba(22,120,55,0.95)); }
    .ui-separator { border: none; border-top: 1px solid rgba(60,140,220,0.15); margin: 6px 0; }
    .ui-section-title { font-size: 9px; color: #4878a0; letter-spacing: 1px; text-transform: uppercase;
                        margin: 4px 0 2px 0; }
    .ui-status { padding: 5px 8px; border-radius: 4px; font-size: 10px; text-align: center; margin: 4px 0;
                 letter-spacing: 0.5px; font-weight: bold; }
    .ui-status.ready    { background: rgba(30,70,30,0.5); color: #70e070; border: 1px solid rgba(70,180,70,0.3); }
    .ui-status.planning { background: rgba(70,55,0,0.5);  color: #ffd050; border: 1px solid rgba(200,160,0,0.3); }
    .ui-status.planned  { background: rgba(0,50,90,0.5);  color: #50b8ff; border: 1px solid rgba(50,150,255,0.3); }
    .ui-status.armed    { background: rgba(90,50,0,0.5);  color: #ffa050; border: 1px solid rgba(200,120,0,0.3); }
    .ui-status.firing   { background: rgba(100,30,0,0.5); color: #ff7030; border: 1px solid rgba(220,80,0,0.3); }
    .ui-status.postfire { background: rgba(50,0,70,0.5);  color: #c060ff; border: 1px solid rgba(160,60,220,0.3); }
    .ui-status.error    { background: rgba(70,0,0,0.5);   color: #ff5050; border: 1px solid rgba(200,50,50,0.3); }
    .ui-recovery { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
    .ui-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px;
                background: rgba(40,80,140,0.5); color: #90c0e0; border: 1px solid rgba(60,120,200,0.3); }
    .ui-energy-bar { height: 4px; border-radius: 2px; background: rgba(40,60,100,0.5); margin: 2px 0; overflow: hidden; }
    .ui-energy-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
    .ui-mini-graph { display: flex; align-items: flex-end; gap: 1px; height: 24px; }
    .ui-mini-bar { width: 3px; background: rgba(60,150,255,0.6); border-radius: 1px 1px 0 0;
                   transition: height 0.2s; }
  `;
  document.head.appendChild(style);

  document.body.appendChild(island);
  return island;
}
