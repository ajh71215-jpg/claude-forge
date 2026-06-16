#!/usr/bin/env bash
# Supervisor: keep the real Electron dev app alive with CDP. Relaunch on exit.
# Logs each exit code + timestamp so we can see WHY it died.
cd "C:/Users/CKIRUser/Downloads/claude-forge-main" || exit 1
PORT="${CDP_PORT:-9333}"
# CDP is enabled via FORGE_CDP env (src/main/index.ts reads it), not a CLI flag.
export FORGE_CDP="$PORT"
export ELECTRON_DISABLE_SANDBOX=1
n=0
while true; do
  n=$((n+1))
  echo "=== [run #$n] launching $(date '+%H:%M:%S') (CDP $PORT) ==="
  node node_modules/electron-vite/bin/electron-vite.js dev --noSandbox
  code=$?
  echo "=== [run #$n] electron-vite exited code=$code at $(date '+%H:%M:%S') ==="
  # If it died almost instantly repeatedly, back off a bit more to avoid spin-loop.
  sleep 2
done
