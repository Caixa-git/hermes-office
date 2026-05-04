/**
 * Hermes Office v0.2.0 — Isometric Kanban Visualizer
 * 
 * Features:
 * - SVG isometric background: floor tiles, walls, office furniture
 * - Dynamic task desks with chairs, monitors, status indicators
 * - Mouse pan (drag) and zoom (scroll wheel + buttons)
 * - Floating labels above desks for readability
 * - Activity feed sidebar
 * - WebSocket real-time updates
 */

// ── WebSocket ──────────────────────────────────────────────────────────

const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;
const API_BASE = `${location.protocol}//${location.host}`;

let ws = null;
let reconnectTimer = null;
let deskData = {};
let feedEntries = [];

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { setStatus('connected'); clearTimeout(reconnectTimer); };
  ws.onmessage = (evt) => {
    try { handleMessage(JSON.parse(evt.data)); } catch (e) { console.warn('WS parse:', e); }
  };
  ws.onclose = () => { setStatus('disconnected'); scheduleReconnect(); };
  ws.onerror = () => ws.close();
}
function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectWebSocket, 3000); }
function handleMessage(msg) {
  if (msg.type === 'init' || msg.type === 'state_update') {
    if (msg.tasks) {
      deskData = {};
      msg.tasks.forEach(t => { deskData[t.id] = { id: t.id, title: t.title, status: t.status, label: t.title.slice(0,20) }; });
      renderTasks();
      updateTaskCount(Object.keys(deskData).length);
    }
    if (msg.logs) { feedEntries = msg.logs.slice(0,30); renderActivityFeed(); }
  }
}
function setStatus(s) {
  const el = document.getElementById('ws-status');
  if (el) { el.textContent = s === 'connected' ? '● Connected' : '● Disconnected'; el.className = `status ${s}`; }
}
function updateTaskCount(n) { const el = document.getElementById('task-count'); if (el) el.textContent = `${n} tasks`; }

// ── SVG Isometric Background ──────────────────────────────────────────

const GRID = 72;       // isometric tile width in px
const GRID_H = 36;     // isometric tile height
const FLOOR_W = 14;    // grid columns
const FLOOR_D = 10;    // grid rows

// iso project: (col, row) → screen (x, y)
function iso(c, r) {
  return {
    x: (c - r) * (GRID / 2),
    y: (c + r) * (GRID_H / 2),
  };
}

// Build SVG diamond path for a floor tile at (col, row)
function tilePath(c, r) {
  const p = iso(c, r);
  const hw = GRID / 2, hh = GRID_H / 2;
  return `M${p.x},${p.y - hh} L${p.x + hw},${p.y} L${p.x},${p.y + hh} L${p.x - hw},${p.y} Z`;
}

// Desk slot position: above the floor tile
function deskPos(c, r, z) {
  const p = iso(c, r);
  return { x: p.x, y: p.y - (z || 40) };
}

const FLOOR_COLORS = ['#e8e4dc', '#e2ded5', '#ece8e0', '#e5e1d9'];
const WALL_COLOR = '#f5f2ed';
const WALL_STROKE = '#d8d3ca';
const PARTITION_COLOR = '#dcd8cf';
const SHADOW_COLOR = 'rgba(0,0,0,0.06)';

function renderBackground() {
  const svg = document.getElementById('scene-bg');
  if (!svg) return;

  const totalW = (FLOOR_W + FLOOR_D) * (GRID / 2) + 120;
  const totalH = (FLOOR_W + FLOOR_D) * (GRID_H / 2) + 120;
  const ox = 60, oy = 60;

  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.setAttribute('width', totalW);
  svg.setAttribute('height', totalH);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';

  let html = '';

  // ── Defs: filters & gradients ──
  html += `<defs>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.08"/>
    </filter>
    <filter id="desk-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000" flood-opacity="0.10"/>
    </filter>
    <linearGradient id="wall-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#faf8f5"/>
      <stop offset="100%" stop-color="#f0ede8"/>
    </linearGradient>
  </defs>`;

  // ── Floor tiles ──
  for (let c = 0; c < FLOOR_W; c++) {
    for (let r = 0; r < FLOOR_D; r++) {
      const color = FLOOR_COLORS[(c + r) % FLOOR_COLORS.length];
      html += `<path d="${tilePath(c, r)}" fill="${color}" stroke="#e5e1db" stroke-width="0.5"/>`;
    }
  }

  // ── Floor shadow under walls ──
  html += `<path d="${tilePath(-0.5, -0.5)}" fill="none" />`;

  // ── Back wall (north edge) ──
  for (let c = 0; c < FLOOR_W; c++) {
    const pTop = iso(c, -0.1);
    const pBot = iso(c, 0);
    const h = 80;
    html += `<polygon points="${pTop.x - GRID/2 + 2},${pTop.y - GRID_H/2 - h} ${pTop.x + GRID/2 - 2},${pTop.y - GRID_H/2 - h} ${pBot.x + GRID/2 - 2},${pBot.y - GRID_H/2} ${pBot.x - GRID/2 + 2},${pBot.y - GRID_H/2}" fill="url(#wall-grad)" stroke="${WALL_STROKE}" stroke-width="0.5"/>`;
  }

  // ── Left wall (west edge) ──
  const leftWall = [];
  for (let r = 0; r < FLOOR_D; r++) {
    const p = iso(-0.1, r);
    leftWall.push(p);
  }
  if (leftWall.length >= 2) {
    const p0 = iso(-0.1, 0), pN = iso(-0.1, FLOOR_D - 1);
    const h = 80;
    html += `<polygon points="${p0.x - GRID/2},${p0.y - GRID_H/2 - h} ${p0.x - GRID/2},${p0.y - GRID_H/2} ${pN.x - GRID/2},${pN.y + GRID_H/2} ${pN.x - GRID/2},${pN.y + GRID_H/2 - h}" fill="url(#wall-grad)" stroke="${WALL_STROKE}" stroke-width="0.5"/>`;
  }

  // ── Partitions ──
  // Horizontal partition at row 4
  for (let c = 0; c < FLOOR_W; c += 2) {
    const p0 = iso(c, 4.5), p1 = iso(c + 2, 4.5);
    const h = 50;
    html += `<polygon points="${p0.x},${p0.y - h} ${p1.x},${p1.y - h} ${p1.x},${p1.y} ${p0.x},${p0.y}" fill="${PARTITION_COLOR}" stroke="${WALL_STROKE}" stroke-width="0.3" opacity="0.7"/>`;
  }
  // Vertical partition at col 7
  for (let r = 0; r < 5; r += 2) {
    const p0 = iso(7.5, r), p1 = iso(7.5, r + 2);
    const h = 50;
    html += `<polygon points="${p0.x},${p0.y - h} ${p1.x},${p1.y - h} ${p1.x},${p1.y} ${p0.x},${p0.y}" fill="${PARTITION_COLOR}" stroke="${WALL_STROKE}" stroke-width="0.3" opacity="0.7"/>`;
  }

  // ── Static furniture ──

  // Vending machine (top-right area, c=11, r=1)
  {
    const p = iso(11.2, 1.5);
    const vbw = 28, vbh = 16, vh = 56;
    // body
    html += `<polygon points="${p.x - vbw/2},${p.y - vh} ${p.x + vbw/2},${p.y - vh + vbh/2} ${p.x + vbw/2},${p.y + vbh/2} ${p.x - vbw/2},${p.y}" fill="#d4c8b8" stroke="#c0b4a4" stroke-width="1" rx="3"/>`;
    // front face
    html += `<polygon points="${p.x - vbw/2},${p.y - vh} ${p.x},${p.y - vh - vbh/2} ${p.x},${p.y - vbh/2} ${p.x - vbw/2},${p.y}" fill="#e8ddd0" stroke="#c0b4a4" stroke-width="0.8"/>`;
    // drink panel
    html += `<rect x="${p.x - vbw/2 + 5}" y="${p.y - vh + 12}" width="${vbw - 10}" height="22" fill="#3a6b5e" rx="2" opacity="0.8"/>`;
    // label
    html += `<text x="${p.x - vbw/4}" y="${p.y - vh/2 + 2}" font-size="6" fill="#666" text-anchor="middle" font-family="sans-serif">VENDING</text>`;
  }

  // Copier (bottom-right area, c=10, r=7)
  {
    const p = iso(10.5, 7.5);
    const cw = 34, cd = 22, ch = 32;
    // body
    html += `<polygon points="${p.x - cw/2},${p.y - ch} ${p.x + cw/2},${p.y - ch + cd/2} ${p.x + cw/2},${p.y + cd/2} ${p.x - cw/2},${p.y}" fill="#b8b0a5" stroke="#a09890" stroke-width="1"/>`;
    // top face
    html += `<polygon points="${p.x - cw/2},${p.y - ch} ${p.x},${p.y - ch - cd/2} ${p.x + cw/2},${p.y - ch + cd/2} ${p.x},${p.y - ch + cd/2}" fill="#d0c8bc"/>`;
    // paper tray
    html += `<rect x="${p.x - cw/2 + 6}" y="${p.y - ch + 8}" width="16" height="6" fill="#f5f0e8" rx="1"/>`;
    // label
    html += `<text x="${p.x - 2}" y="${p.y - ch/2}" font-size="6" fill="#666" text-anchor="middle" font-family="sans-serif">COPIER</text>`;
  }

  // Water cooler (left edge, c=1, r=5)
  {
    const p = iso(1.5, 5.2);
    const wr = 10;
    html += `<ellipse cx="${p.x}" cy="${p.y - 30}" rx="${wr}" ry="${wr * 0.6}" fill="#c8ddec" stroke="#a0b8cc" stroke-width="0.8"/>`;
    html += `<ellipse cx="${p.x}" cy="${p.y - 14}" rx="${wr}" ry="${wr * 0.6}" fill="#d8e8f4" stroke="#a0b8cc" stroke-width="0.8"/>`;
    html += `<rect x="${p.x - wr}" y="${p.y - 30}" width="${wr * 2}" height="16" fill="#7bb3d9" opacity="0.3" rx="2"/>`;
  }

  // ── Plant (corner, c=0, r=8) ──
  {
    const p = iso(0.5, 8.3);
    html += `<circle cx="${p.x}" cy="${p.y - 22}" r="10" fill="#7a9e6b" opacity="0.7"/>`;
    html += `<circle cx="${p.x - 5}" cy="${p.y - 16}" r="7" fill="#8aae7b" opacity="0.6"/>`;
    html += `<rect x="${p.x - 6}" y="${p.y - 10}" width="12" height="10" fill="#c0b098" rx="2"/>`;
  }

  // ── Clock on back wall ──
  {
    const p = iso(FLOOR_W/2, -0.1);
    html += `<circle cx="${p.x}" cy="${p.y - 62}" r="12" fill="#faf8f5" stroke="#d8d3ca" stroke-width="1"/>`;
    html += `<circle cx="${p.x}" cy="${p.y - 62}" r="9" fill="none" stroke="#ccc" stroke-width="0.5"/>`;
    html += `<line x1="${p.x}" y1="${p.y - 62}" x2="${p.x}" y2="${p.y - 67}" stroke="#999" stroke-width="1"/>`;
    html += `<line x1="${p.x}" y1="${p.y - 62}" x2="${p.x + 4}" y2="${p.y - 62}" stroke="#999" stroke-width="0.8"/>`;
  }

  // ── Zone labels ──
  {
    const zones = [
      { c: 1.5, r: 1.5, label: 'DEV ZONE', color: '#c0c8d4' },
      { c: 8.5, r: 1.5, label: 'RESEARCH', color: '#d4c8c0' },
      { c: 1.5, r: 6.5, label: 'OPS', color: '#c0d4c8' },
      { c: 8.5, r: 6.5, label: 'DESIGN', color: '#d4d0c8' },
    ];
    zones.forEach(z => {
      const p = iso(z.c, z.r);
      html += `<text x="${p.x}" y="${p.y - 2}" font-size="10" fill="${z.color}" text-anchor="middle" font-family="sans-serif" font-weight="400" letter-spacing="3" opacity="0.15">${z.label}</text>`;
    });
  }

  svg.innerHTML = html;
}

// ── Task Rendering ────────────────────────────────────────────────────

const DESK_COLORS = {
  done:        { top: '#d4e8d0', side: '#b8d4b0', border: '#6aaa5a', badge: '#4caf50' },
  in_progress: { top: '#f5e8c8', side: '#e8d4a0', border: '#d4a030', badge: '#ff9800' },
  ready:       { top: '#e0d4f0', side: '#ccb8e0', border: '#9c6bc4', badge: '#9c27b0' },
  failed:      { top: '#f0d0d0', side: '#e0b0b0', border: '#cc5555', badge: '#f44336' },
  default:     { top: '#e8e4dc', side: '#d8d4cc', border: '#a0a0a0', badge: '#888888' },
};

const SLOT_WIDTH = 60;
const SLOT_HEIGHT = 34;
const SLOT_SIZE = 52; // tile width for task grid

function renderTasks() {
  const layer = document.getElementById('task-layer');
  if (!layer) return;

  const tasks = Object.values(deskData);
  layer.innerHTML = '';

  if (tasks.length === 0) {
    layer.innerHTML = `<div style="position:absolute;left:${iso(FLOOR_W/2, FLOOR_D/2).x - 80}px;top:${iso(FLOOR_W/2, FLOOR_D/2).y - 10}px;width:160px;text-align:center;font-size:12px;color:#999;">No tasks loaded</div>`;
    return;
  }

  // Place tasks on the floor grid, skipping furniture zones
  const cols = FLOOR_W - 1;
  let usedSlots = new Set();
  // Mark furniture slots as taken
  const furnitureZones = [
    '11,1','11,2','10,1', // vending
    '10,7','10,8','11,7', // copier
    '1,5','0,5',          // water cooler
    '0,8',                // plant
  ];
  furnitureZones.forEach(s => usedSlots.add(s));

  let placed = 0;
  for (let c = 1; c < cols && placed < tasks.length; c++) {
    for (let r = 1; r < FLOOR_D - 1 && placed < tasks.length; r++) {
      const key = `${c},${r}`;
      if (usedSlots.has(key)) continue;
      usedSlots.add(key);

      const task = tasks[placed++];
      const p = iso(c, r);
      const colors = DESK_COLORS[task.status] || DESK_COLORS.default;

      // Desk shadow
      const deskSVG = `
        <svg x="${p.x - SLOT_WIDTH/2 - 1}" y="${p.y - SLOT_HEIGHT/2 - 1}" width="${SLOT_WIDTH + 10}" height="${SLOT_HEIGHT + 20}" style="overflow:visible;pointer-events:none;">
          <!-- shadow under desk -->
          <ellipse cx="${SLOT_WIDTH/2 + 3}" cy="${SLOT_HEIGHT/2 + 6}" rx="${SLOT_WIDTH/3}" ry="${SLOT_HEIGHT/5}" fill="rgba(0,0,0,0.06)"/>

          <!-- desk body (isometric top face) -->
          <polygon points="${8},${4} ${SLOT_WIDTH/2 + 2},${-2} ${SLOT_WIDTH - 2},${4} ${SLOT_WIDTH/2 - 2},${10}" fill="${colors.top}" stroke="${colors.border}" stroke-width="1.2" rx="2"/>

          <!-- desk front face -->
          <polygon points="${8},${4} ${SLOT_WIDTH/2 - 2},${10} ${SLOT_WIDTH/2 - 2},${18} ${8},${12}" fill="${colors.side}" stroke="${colors.border}" stroke-width="0.8"/>

          <!-- chair (simple isometric block behind desk) -->
          <rect x="${SLOT_WIDTH/2 - 6}" y="9" width="12" height="6" fill="#c8c0b4" rx="1" opacity="0.7"/>

          <!-- monitor on desk -->
          <rect x="${SLOT_WIDTH/2 - 7}" y="-5" width="14" height="9" fill="#3a3a3a" rx="1.5"/>
          <rect x="${SLOT_WIDTH/2 - 5}" y="-3" width="10" height="5" fill="#5a8ab5" rx="1" opacity="0.7"/>

          <!-- status badge -->
          <circle cx="${SLOT_WIDTH/2}" cy="-8" r="4" fill="${colors.badge}" stroke="white" stroke-width="1"/>
        </svg>`;

      const slot = document.createElement('div');
      slot.className = 'desk-slot';
      slot.style.left = `${p.x - SLOT_WIDTH/2}px`;
      slot.style.top = `${p.y - SLOT_HEIGHT - 4}px`;
      slot.style.width = `${SLOT_WIDTH + 4}px`;
      slot.style.height = `${SLOT_HEIGHT + 16}px`;
      slot.dataset.taskId = task.id;
      slot.innerHTML = deskSVG;

      // Label above desk
      const label = document.createElement('div');
      label.className = 'desk-label';
      label.style.left = `${p.x}px`;
      label.style.top = `${p.y - SLOT_HEIGHT - 12}px`;
      label.style.transform = 'translate(-50%, -100%)';
      label.style.maxWidth = `${SLOT_WIDTH + 8}px`;
      label.textContent = task.label || task.id;

      slot.addEventListener('click', (e) => { e.stopPropagation(); showTaskDetail(task.id); });

      layer.appendChild(slot);
      layer.appendChild(label);
    }
  }
}

// ── Mouse Pan & Zoom ──────────────────────────────────────────────────

let panX = 0, panY = 0, zoom = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.08;

function applyTransform() {
  const wrapper = document.getElementById('scene-wrapper');
  if (!wrapper) return;
  wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

const container = document.getElementById('scene-container');

container.addEventListener('mousedown', (e) => {
  if (e.target.closest('.desk-slot')) return; // don't pan when clicking desk
  isPanning = true;
  container.classList.add('panning');
  panStart = { x: e.clientX, y: e.clientY };
  panOrigin = { x: panX, y: panY };
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = panOrigin.x + (e.clientX - panStart.x);
  panY = panOrigin.y + (e.clientY - panStart.y);
  applyTransform();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  container.classList.remove('panning');
});

container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const oldZoom = zoom;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - Math.sign(e.deltaY) * ZOOM_STEP));

  // Zoom toward cursor position
  const rect = container.getBoundingClientRect();
  const cx = e.clientX - rect.left - rect.width / 2;
  const cy = e.clientY - rect.top - rect.height / 2;
  const scale = zoom / oldZoom;
  panX = cx - scale * (cx - panX);
  panY = cy - scale * (cy - panY);
  applyTransform();
}, { passive: false });

function zoomIn() { zoom = Math.min(MAX_ZOOM, zoom + 0.2); applyTransform(); }
function zoomOut() { zoom = Math.max(MIN_ZOOM, zoom - 0.2); applyTransform(); }
function zoomReset() { zoom = 1; panX = 0; panY = 0; applyTransform(); }

// ── Activity Feed ─────────────────────────────────────────────────────

function renderActivityFeed() {
  const feed = document.getElementById('event-feed');
  if (!feed) return;
  feed.innerHTML = feedEntries.map(e => `
    <div class="feed-entry">
      <div><span class="feed-task">${esc(e.task_id)}</span> <span class="feed-time">${esc(e.timestamp)}</span></div>
      <div>${esc(e.message.slice(0, 120))}</div>
    </div>
  `).join('');
}

// ── Overlay / Detail ──────────────────────────────────────────────────

function showTaskDetail(taskId) {
  const overlay = document.getElementById('overlay');
  const body = document.getElementById('overlay-body');
  if (!overlay || !body) return;
  const task = deskData[taskId];
  body.innerHTML = task
    ? `<h3>${esc(task.title)}</h3><p><strong>ID:</strong> ${esc(task.id)}</p><p><strong>Status:</strong> ${esc(task.status)}</p><hr><p style="color:#999;font-size:11px;">Click a kanban worker task to see workspace artifacts...</p>`
    : `<h3>${esc(taskId)}</h3><p>No details</p>`;
  overlay.classList.remove('hidden');
}
function hideOverlay() { document.getElementById('overlay')?.classList.add('hidden'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Init ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderBackground();
  connectWebSocket();

  setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);

  document.getElementById('zoom-in')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out')?.addEventListener('click', zoomOut);
  document.getElementById('zoom-reset')?.addEventListener('click', zoomReset);
  document.getElementById('overlay-close')?.addEventListener('click', hideOverlay);
  document.getElementById('overlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) hideOverlay(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideOverlay();
    if (e.key === '=' || e.key === '+') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') zoomReset();
  });

  // Initial transform
  applyTransform();
});
