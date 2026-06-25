#!/usr/bin/env bash
# dev.sh — Start all services for local development
#
# Process 1: backend-api  → Express API     (port 4000)
# Process 2: vite         → React dev server (port 5173)
# Process 3: electron     → Desktop window
#
# Usage:  bash dev.sh
# Stop:   Ctrl+C

ROOT="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT/backend-api"
APP_DIR="$ROOT/electron-app"

BOLD="\033[1m"; RESET="\033[0m"
CYAN="\033[36m"; GREEN="\033[32m"; YELLOW="\033[33m"

log()  { echo -e "${BOLD}${CYAN}[dev]${RESET} $*"; }
ok()   { echo -e "${BOLD}${GREEN}[dev]${RESET} $*"; }
warn() { echo -e "${BOLD}${YELLOW}[dev]${RESET} $*"; }

API_PID=""; VITE_PID=""; APP_PID=""

cleanup() {
  echo ""
  warn "Shutting down…"
  [ -n "$APP_PID"  ] && kill "$APP_PID"  2>/dev/null
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$API_PID"  ] && kill "$API_PID"  2>/dev/null
  wait 2>/dev/null
  ok "Goodbye."
}
trap cleanup INT TERM

# ── Dependency check ──────────────────────────────────────────────────────────
if [ ! -d "$API_DIR/node_modules" ]; then
  warn "Installing backend-api deps…"; (cd "$API_DIR" && npm install --silent)
fi
if [ ! -d "$APP_DIR/node_modules" ]; then
  warn "Installing electron-app deps…"; (cd "$APP_DIR" && npm install --silent)
fi

# ── 1. backend-api ────────────────────────────────────────────────────────────
log "Starting ${BOLD}backend-api${RESET} on :4000"
(cd "$API_DIR" && node src/server.js) &
API_PID=$!

# ── 2. Vite dev server ────────────────────────────────────────────────────────
log "Starting ${BOLD}Vite${RESET} on :5173"
(cd "$APP_DIR" && npx vite) &
VITE_PID=$!

# Vite starts in ~200ms. Sleep 3s to be safe, then launch Electron.
log "Waiting for Vite…"
sleep 3

# Verify Vite actually responded before launching Electron
if ! curl -sf http://localhost:5173 -o /dev/null 2>/dev/null; then
  warn "Vite not yet responding, waiting 5 more seconds…"
  sleep 5
fi

# ── 3. Electron ───────────────────────────────────────────────────────────────
log "Launching ${BOLD}Electron${RESET}…"
(cd "$APP_DIR" && NODE_ENV=development npx electron .) &
APP_PID=$!

echo ""
ok "All services running. Press ${BOLD}Ctrl+C${RESET} to stop."
echo ""

# Stay alive until Electron window is closed (or Ctrl+C)
wait "$APP_PID"

# When Electron exits, tear everything else down
cleanup
