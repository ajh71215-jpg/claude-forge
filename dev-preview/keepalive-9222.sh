#!/usr/bin/env bash
# Keep the Electron dev app alive with CDP on 9222. Relaunch on any exit.
# Repo dir is fixed to the nested checkout layout.
cd "C:/Users/CKIRUser/Downloads/claude-forge-main/claude-forge-main" || exit 1
PORT="${CDP_PORT:-9222}"
export FORGE_CDP="$PORT"                 # src/main/index.ts → remote-debugging-port
export ELECTRON_DISABLE_SANDBOX=1
LOG="dev-preview/dev-9222.log"
n=0
while true; do
  n=$((n+1))
  echo "=== [run #$n] launching $(date '+%H:%M:%S') (CDP $PORT) ===" >> "$LOG"
  node node_modules/electron-vite/bin/electron-vite.js dev --noSandbox >> "$LOG" 2>&1
  code=$?
  echo "=== [run #$n] exited code=$code at $(date '+%H:%M:%S') ===" >> "$LOG"
  sleep 2
done
