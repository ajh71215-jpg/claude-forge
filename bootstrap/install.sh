#!/usr/bin/env bash
# ============================================================================
# Claude Forge — environment bootstrap (engine)
# Restores the full toolchain + project after a machine reset (frozen/wiped PC).
#
# Assumes Git Bash + Node are already present (setup.exe installs those first,
# then calls this). Safe to re-run — every step is idempotent.
#
# What it does:
#   1. PATH       → ~/.bashrc (tools/node + ~/.local/bin)
#   2. PowerShell 7 (portable) download/extract
#   3. Claude Code CLI install
#   4. claude-forge deps: npm install (--ignore-scripts) + manual electron
#      binary + vite patch + electron-builder collector patch
# After it finishes: run `claude` to log in, then `cd claude-forge && npm run dev`.
# ============================================================================
set -u

USER_HOME="/c/Users/CKIRUser"
TOOLS="$USER_HOME/tools"
NODE_DIR="$TOOLS/node"
PWSH_DIR="$USER_HOME/Downloads/PowerShell-7.6.2-win-x64"
LOCALBIN="$USER_HOME/.local/bin"
# $TEMP/$TMP on Windows is a backslash path (C:\...) which tar refuses.
# Convert to POSIX with cygpath (always present in Git Bash / MSYS2).
# Fall back to /tmp if cygpath somehow isn't available.
if command -v cygpath >/dev/null 2>&1; then
  TMP="$(cygpath -u "${TEMP:-C:/Users/CKIRUser/AppData/Local/Temp}")"
else
  TMP="${TMPDIR:-/tmp}"
fi

# Pinned versions (stable, direct download URLs)
NODE_VER="24.16.0"
PWSH_VER="7.6.2"
ELECTRON_VER="42.4.0"
NODE_URL="https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-win-x64.zip"
PWSH_URL="https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VER}/PowerShell-${PWSH_VER}-win-x64.zip"
ELECTRON_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VER}/electron-v${ELECTRON_VER}-win32-x64.zip"

# Resolve repo root = parent of this script's directory (bootstrap/).
# Normalize the path with cygpath so this works even when setup.exe invokes us
# with a Windows-style path (C:\...\install.sh).
SRC="${BASH_SOURCE[0]}"
command -v cygpath >/dev/null 2>&1 && SRC="$(cygpath -u "$SRC" 2>/dev/null || echo "$SRC")"
SELF_DIR="$(cd "$(dirname "$SRC")" && pwd)"
REPO="$(cd "$SELF_DIR/.." && pwd)"

log() { echo "[bootstrap] $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

export PATH="$NODE_DIR:$LOCALBIN:$PATH"

# ---------------------------------------------------------------------------
log "1/5  PATH in ~/.bashrc"
touch ~/.bashrc
grep -q 'tools/node' ~/.bashrc || echo 'export PATH="/c/Users/CKIRUser/tools/node:$PATH"' >> ~/.bashrc
grep -q '.local/bin'  ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# ---------------------------------------------------------------------------
log "2/5  Node check"
if [ ! -x "$NODE_DIR/node.exe" ]; then
  log "  Node missing — downloading v${NODE_VER}…"
  curl -L --fail -o "$TMP/node.zip" "$NODE_URL" && {
    mkdir -p "$TOOLS"; tar -xf "$TMP/node.zip" -C "$TOOLS"
    rm -rf "$NODE_DIR"; mv "$TOOLS/node-v${NODE_VER}-win-x64" "$NODE_DIR"
  } || log "  !! Node download failed — install manually to $NODE_DIR"
else
  log "  Node OK ($("$NODE_DIR/node.exe" --version 2>/dev/null))"
fi

# ---------------------------------------------------------------------------
log "3/5  PowerShell 7"
if [ ! -x "$PWSH_DIR/pwsh.exe" ]; then
  log "  downloading PowerShell ${PWSH_VER}…"
  curl -L --fail -o "$TMP/pwsh.zip" "$PWSH_URL" && {
    mkdir -p "$PWSH_DIR"; tar -xf "$TMP/pwsh.zip" -C "$PWSH_DIR"
  } || log "  !! PowerShell download failed (non-fatal)"
else
  log "  PowerShell 7 OK"
fi

# ---------------------------------------------------------------------------
log "4/5  Claude Code CLI"
if [ ! -x "$LOCALBIN/claude.exe" ] && ! have claude; then
  log "  installing Claude Code (official installer)…"
  curl -fsSL https://claude.ai/install.sh | bash \
    || log "  !! auto-install failed — see https://docs.claude.com/claude-code (run the Windows installer manually)"
else
  log "  Claude Code OK"
fi

# ---------------------------------------------------------------------------
log "5/5  claude-forge dependencies"
if [ -d "$REPO" ] && [ -f "$REPO/package.json" ]; then
  cd "$REPO"

  # Point npm's script-shell at bash so `npm run dev/build` works without cmd.exe.
  # The project .npmrc also sets this, but set it user-level as belt-and-suspenders.
  GITBASH="$(command -v bash 2>/dev/null)"
  if [ -n "$GITBASH" ]; then
    # npm config needs a Windows-style path on Windows; cygpath converts it.
    WIN_BASH="$(cygpath -w "$GITBASH" 2>/dev/null || echo "$GITBASH")"
    npm config set script-shell "$WIN_BASH" --location user 2>/dev/null \
      && log "  npm script-shell → $WIN_BASH" \
      || log "  (npm config set script-shell skipped)"
  fi

  log "  npm install (--ignore-scripts; cmd.exe is blocked)…"
  npm install --ignore-scripts --no-audit --no-fund || log "  !! npm install reported errors"

  # electron binary — npm postinstall is skipped, fetch it by hand
  if [ ! -f node_modules/electron/dist/electron.exe ]; then
    log "  fetching electron ${ELECTRON_VER} binary…"
    curl -L --fail -o "$TMP/electron.zip" "$ELECTRON_URL" && {
      mkdir -p node_modules/electron/dist
      tar -xf "$TMP/electron.zip" -C node_modules/electron/dist
      printf 'electron.exe' > node_modules/electron/path.txt   # printf, NOT echo (no trailing newline)
    } || log "  !! electron binary download failed"
  fi

  # source patches (idempotent node scripts)
  [ -f bootstrap/patch-vite.mjs ]        && node bootstrap/patch-vite.mjs        || true
  [ -f bootstrap/patch-app-builder.mjs ] && node bootstrap/patch-app-builder.mjs || true
else
  log "  !! repo not found at $REPO — skipping deps"
fi

echo ""
log "DONE."
echo "  next:  claude                     # log in to your Claude subscription"
echo "         cd '$REPO' && npm run dev   # launch Claude Forge"
echo "         (build installer:  node node_modules/electron-builder/cli.js --win nsis)"
