#!/bin/bash
# Hermes Office — Isometric Kanban Visualizer
# Usage: bash run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧪 Installing dependencies…"
pip3 install -q -r backend/requirements.txt 2>/dev/null || true

echo "🚀 Starting Hermes Kanban Visualizer on http://localhost:8765"
cd backend && python3 main.py
