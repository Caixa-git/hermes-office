/**
 * Hermes Kanban Isometric Office Viewer — frontend client.
 *
 * Key fix: uses location.host for WebSocket/API, so it works behind
 * ngrok (HTTPS → wss://) and locally (HTTP → ws://) without hardcoded ports.
 */

// ── WebSocket ─────────────────────────────────────────────────────────────

const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;
const API_BASE = `${location.protocol}//${location.host}`;

let ws = null;
let reconnectTimer = null;
let deskData = {};        // task_id → { id, title, status, label }
let feedEntries = [];     // recent log entries
let eventListeners = {};  // custom events

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus('connected');
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch (e) {
      console.warn('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    setStatus('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWebSocket, 3000);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
    case 'state_update':
      if (msg.tasks) {
        deskData = {};
        msg.tasks.forEach(t => {
          deskData[t.id] = {
            id: t.id,
            title: t.title,
            status: t.status,
            label: t.title.slice(0, 24) + (t.title.length > 24 ? '…' : ''),
          };
        });
        renderOffices();
        updateTaskCount(Object.keys(deskData).length);
      }
      if (msg.logs) {
        feedEntries = msg.logs.slice(0, 30);
        renderActivityFeed();
      }
      break;
    case 'pong':
      break;
  }
}

function setStatus(state) {
  const el = document.getElementById('ws-status');
  if (!el) return;
  el.textContent = state === 'connected' ? '● Connected' : '● Disconnected';
  el.className = `status ${state}`;
}

function updateTaskCount(n) {
  const el = document.getElementById('task-count');
  if (el) el.textContent = `${n} tasks`;
}

// ── Isometric Office Rendering ─────────────────────────────────────────────

const TILE_W = 80;
const TILE_H = 46;
const DESK_W = 64;
const DESK_H = 37;

const DESK_COLORS = {
  done:        { top: '#1a4a2e', border: '#3fb950' },
  in_progress: { top: '#4a3a1a', border: '#d29922' },
  ready:       { top: '#3a2a4a', border: '#a371f7' },
  failed:      { top: '#4a1a1a', border: '#f85149' },
  default:     { top: '#1e2a3a', border: '#58a6ff' },
};

function getDeskColors(status) {
  return DESK_COLORS[status] || DESK_COLORS.default;
}

let zoom = 1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

function renderOffices() {
  const scene = document.getElementById('scene');
  if (!scene) return;

  const tasks = Object.values(deskData);
  scene.innerHTML = '';

  if (tasks.length === 0) {
    scene.innerHTML = '<div style="color:#8b949e;position:absolute;left:-100px;top:-20px;font-size:14px;width:200px;text-align:center;">No tasks loaded</div>';
    updateZoom();
    return;
  }

  // Layout: arrange desks in a grid with isometric spacing
  const cols = Math.ceil(Math.sqrt(tasks.length));
  const spacingX = TILE_W * 1.3;
  const spacingY = TILE_H * 1.3;
  const offsetX = -(cols * spacingX) / 2;
  const offsetY = -(Math.ceil(tasks.length / cols) * spacingY) / 2;

  tasks.forEach((task, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = offsetX + col * spacingX;
    const y = offsetY + row * spacingY;

    const colors = getDeskColors(task.status);

    const container = document.createElement('div');
    container.className = 'desk-container';
    container.style.transform = `translate(${x}px, ${y}px)`;
    container.dataset.taskId = task.id;

    // Floor tile
    const floor = document.createElement('div');
    floor.className = 'floor-tile';

    // Desk top
    const top = document.createElement('div');
    top.className = 'desk-top';
    top.style.background = `linear-gradient(135deg, ${colors.top}, ${lighten(colors.top, 20)})`;
    top.style.borderColor = colors.border;

    // Badge
    const badge = document.createElement('div');
    badge.className = `desk-badge badge-${task.status === 'in_progress' || task.status === 'ready' ? 'active' : task.status === 'done' ? 'done' : 'unknown'}`;

    // Label
    const label = document.createElement('div');
    label.className = 'desk-label';
    label.textContent = task.label || task.id;

    container.appendChild(floor);
    container.appendChild(top);
    container.appendChild(badge);
    container.appendChild(label);

    // Click handler
    container.addEventListener('click', () => showTaskDetail(task.id));

    scene.appendChild(container);
  });

  updateZoom();
}

function lighten(hex, amt) {
  let r = parseInt(hex.slice(1,3), 16);
  let g = parseInt(hex.slice(3,5), 16);
  let b = parseInt(hex.slice(5,7), 16);
  r = Math.min(255, r + amt);
  g = Math.min(255, g + amt);
  b = Math.min(255, b + amt);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function updateZoom() {
  const scene = document.getElementById('scene');
  if (!scene) return;
  scene.style.transform = `scale(${zoom})`;
}

// ── Activity Feed ──────────────────────────────────────────────────────────

function renderActivityFeed() {
  const feed = document.getElementById('event-feed');
  if (!feed) return;
  feed.innerHTML = feedEntries.map(e => `
    <div class="feed-entry">
      <div><span class="feed-task">${escapeHtml(e.task_id)}</span> <span class="feed-time">${escapeHtml(e.timestamp)}</span></div>
      <div>${escapeHtml(e.message.slice(0, 120))}</div>
    </div>
  `).join('');
}

// ── Overlay / Detail ───────────────────────────────────────────────────────

async function showTaskDetail(taskId) {
  const overlay = document.getElementById('overlay');
  const body = document.getElementById('overlay-body');
  if (!overlay || !body) return;

  const task = deskData[taskId];
  if (!task) {
    body.innerHTML = `<h3>${escapeHtml(taskId)}</h3><p>No details available</p>`;
  } else {
    body.innerHTML = `
      <h3>${escapeHtml(task.title)}</h3>
      <p><strong>ID:</strong> ${escapeHtml(task.id)}</p>
      <p><strong>Status:</strong> ${escapeHtml(task.status)}</p>
      <hr style="border-color:#30363d;margin:12px 0;">
      <p style="color:#8b949e;font-size:12px;">Click a kanban worker task to see workspace artifacts...</p>
    `;
  }
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Zoom Controls ──────────────────────────────────────────────────────────

function zoomIn() {
  zoom = Math.min(MAX_ZOOM, zoom + 0.15);
  updateZoom();
}
function zoomOut() {
  zoom = Math.max(MIN_ZOOM, zoom - 0.15);
  updateZoom();
}
function zoomReset() {
  zoom = 1;
  updateZoom();
}

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();

  // Ping every 30s to keep connection alive
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('ping');
    }
  }, 30000);

  // Zoom controls
  document.getElementById('zoom-in')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out')?.addEventListener('click', zoomOut);
  document.getElementById('zoom-reset')?.addEventListener('click', zoomReset);

  // Overlay close
  document.getElementById('overlay-close')?.addEventListener('click', hideOverlay);
  document.getElementById('overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideOverlay();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideOverlay();
    if (e.key === '=' || e.key === '+') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') zoomReset();
  });
});
