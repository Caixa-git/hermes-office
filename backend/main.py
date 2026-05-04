#!/usr/bin/env python3
"""
Hermes Kanban Isometric Office Viewer — backend server.

Serves the frontend + WebSocket for real-time kanban visualisation.
Reads kanban task data from `hermes kanban list` output.
"""

import asyncio
import json
import logging
import re
import subprocess
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("hermes-kanban-viz")

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent / "frontend"
KANBAN_DIR = Path.home() / ".hermes" / "kanban"
LOG_DIR = KANBAN_DIR / "logs"
WORKSPACE_DIR = KANBAN_DIR / "workspaces"

app = FastAPI(title="Hermes Kanban Visualizer")

# ── Static file mount ──────────────────────────────────────────────────────
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="frontend")


# ── Helpers ────────────────────────────────────────────────────────────────

def parse_kanban_list(raw: str) -> list[dict]:
    """Parse `hermes kanban list` output into structured task list."""
    tasks = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        # pattern: ✓ t_xxx  done      profile-name        Title text
        m = re.match(
            r"^[✓▶✗]\s+(t_\w+)\s+(\S+)\s+(\(\S+\)|\S+)\s+(.+)",
            line,
        )
        if m:
            status_map = {"✓": "done", "▶": "in_progress", "✗": "failed"}
            icon = line[0]
            tasks.append({
                "id": m.group(1),
                "status": m.group(2),
                "assignee": m.group(3).strip("()") if m.group(3).startswith("(") else m.group(3),
                "title": m.group(4),
                "icon": icon,
            })
    return tasks


def get_kanban_tasks() -> list[dict]:
    """Fetch tasks via `hermes kanban list`."""
    try:
        r = subprocess.run(
            ["hermes", "kanban", "list"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            return parse_kanban_list(r.stdout)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        log.warning("kanban list failed: %s", e)
    return []


def get_recent_logs(limit: int = 20) -> list[dict]:
    """Get recent activity from kanban log files."""
    entries = []
    try:
        logs = sorted(LOG_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]
        for logfile in logs:
            task_id = logfile.stem
            content = logfile.read_text(errors="replace")
            for line in content.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                entries.append({
                    "task_id": task_id,
                    "timestamp": time.strftime("%H:%M:%S", time.localtime(logfile.stat().st_mtime)),
                    "message": line[:200],
                })
    except Exception as e:
        log.warning("log read failed: %s", e)
    return entries[:limit]


def get_workspace_files() -> list[dict]:
    """Scan workspace dirs for analysis artifacts."""
    artifacts = []
    try:
        for ws_dir in sorted(WORKSPACE_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:20]:
            task_id = ws_dir.name
            files = [f for f in ws_dir.iterdir() if f.is_file() and f.suffix in (".json", ".md", ".txt")]
            for f in files[:3]:
                artifacts.append({
                    "task_id": task_id,
                    "file": f.name,
                    "size": f.stat().st_size,
                })
    except Exception as e:
        log.warning("workspace scan failed: %s", e)
    return artifacts


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    index_path = FRONTEND / "index.html"
    if index_path.exists():
        return HTMLResponse(index_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>Hermes Kanban Visualizer</h1><p>frontend/index.html not found</p>")


@app.get("/api/tasks")
async def api_tasks():
    return {"tasks": get_kanban_tasks()}


@app.get("/api/logs")
async def api_logs():
    return {"entries": get_recent_logs()}


@app.get("/api/workspace-files")
async def api_workspace_files():
    return {"artifacts": get_workspace_files()}


@app.get("/api/stats")
async def api_stats():
    tasks = get_kanban_tasks()
    done = sum(1 for t in tasks if t["status"] == "done")
    active = sum(1 for t in tasks if t["status"] in ("in_progress", "ready"))
    return {
        "total": len(tasks),
        "done": done,
        "active": active,
    }


@app.get("/{path:path}")
async def fallback(path: str):
    """Serve static files from frontend/ as fallback."""
    fp = FRONTEND / path
    if fp.exists() and fp.is_file():
        return FileResponse(str(fp))
    return HTMLResponse(
        "<h1>404 — Not Found</h1><p>Path: /" + path + "</p>",
        status_code=404,
    )


# ── WebSocket ──────────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


async def periodic_broadcast():
    """Broadcast kanban state every 5 seconds."""
    while True:
        await asyncio.sleep(5)
        if manager.active:
            try:
                payload = {
                    "type": "state_update",
                    "tasks": get_kanban_tasks(),
                    "logs": get_recent_logs(),
                    "artifacts": get_workspace_files(),
                    "timestamp": time.time(),
                }
                await manager.broadcast(payload)
            except Exception as e:
                log.error("broadcast error: %s", e)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    log.info("WebSocket connected (%d active)", len(manager.active))
    try:
        # Send initial state
        await ws.send_json({
            "type": "init",
            "tasks": get_kanban_tasks(),
            "logs": get_recent_logs(),
            "artifacts": get_workspace_files(),
        })
        # Keep alive — handle incoming pings
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(ws)
        log.info("WebSocket disconnected (%d active)", len(manager.active))


# ── Main ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    asyncio.create_task(periodic_broadcast())
    log.info("Server started — kanban visualizer ready")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
