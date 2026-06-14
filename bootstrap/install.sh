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
#   3. Claude Code CLI install (native win32 binary — the official curl|bash
#      one-liner refuses to run on Git Bash, so we fetch the binary directly)
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
# When launched from setup.exe (NSIS → PortableGit bash) $TEMP may be unset or
# point at a dir that doesn't yet exist — make sure we have a writable scratch dir.
mkdir -p "$TMP" 2>/dev/null || { TMP="/tmp"; mkdir -p "$TMP"; }

# Detect Windows arch so the Claude Code platform string is correct on ARM too.
case "$(uname -m 2>/dev/null)" in
  arm64|aarch64) WINARCH="arm64" ;;
  *)             WINARCH="x64"   ;;
esac

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
# Robust download helper: retries + timeouts so a flaky/locked-down corporate
# network doesn't abort the whole bootstrap on a single transient hiccup.
# Uses only curl (ships with Git Bash) — never cmd.exe/powershell.exe.
dl() { # dl <url> <out-file>
  curl -fL --retry 4 --retry-delay 2 --retry-connrefused \
       --connect-timeout 30 -o "$2" "$1"
}

# Pick a ZIP-capable extractor. CRITICAL: Git Bash / PortableGit ship GNU tar
# (/usr/bin/tar), which CANNOT read .zip ("This does not look like a tar archive").
# Windows ships bsdtar (libarchive) at System32\tar.exe, which can. All our
# downloads (Node, PowerShell, Electron) are .zip, so resolve a real unzipper here
# instead of trusting whatever `tar` happens to be first on PATH.
SYS32="/c/Windows/System32"
if command -v cygpath >/dev/null 2>&1 && [ -n "${SYSTEMROOT:-}" ]; then
  SYS32="$(cygpath -u "$SYSTEMROOT" 2>/dev/null)/System32"
fi
BSDTAR=""
for c in "$SYS32/tar.exe" "/c/Windows/System32/tar.exe"; do
  if [ -x "$c" ] && "$c" --version 2>&1 | grep -qi bsdtar; then BSDTAR="$c"; break; fi
done
# bare `tar` only if it is itself bsdtar (e.g. some MSYS setups)
if [ -z "$BSDTAR" ] && have tar && tar --version 2>&1 | grep -qi bsdtar; then BSDTAR="tar"; fi

unzip_to() { # unzip_to <zipfile> <destdir>
  mkdir -p "$2"
  if [ -n "$BSDTAR" ]; then
    "$BSDTAR" -xf "$1" -C "$2"
  elif have unzip; then
    unzip -oq "$1" -d "$2"
  else
    log "  !! no ZIP extractor found (need System32 bsdtar or unzip)"; return 1
  fi
}

export PATH="$NODE_DIR:$LOCALBIN:$PATH"

# ---------------------------------------------------------------------------
log "1/5  PATH in ~/.bashrc"
touch ~/.bashrc
grep -q 'tools/node'   ~/.bashrc || echo 'export PATH="/c/Users/CKIRUser/tools/node:$PATH"' >> ~/.bashrc
grep -q '.local/bin'   ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"'              >> ~/.bashrc
grep -q '.local/gh'    ~/.bashrc || echo 'export PATH="$HOME/.local/gh/bin:$PATH"'           >> ~/.bashrc

# ---------------------------------------------------------------------------
log "2/5  Node check"
if [ ! -x "$NODE_DIR/node.exe" ]; then
  log "  Node missing — downloading v${NODE_VER}…"
  dl "$NODE_URL" "$TMP/node.zip" && {
    mkdir -p "$TOOLS"; unzip_to "$TMP/node.zip" "$TOOLS"
    rm -rf "$NODE_DIR"; mv "$TOOLS/node-v${NODE_VER}-win-x64" "$NODE_DIR"
  } || log "  !! Node download failed — install manually to $NODE_DIR"
else
  log "  Node OK ($("$NODE_DIR/node.exe" --version 2>/dev/null))"
fi

# ---------------------------------------------------------------------------
log "3/5  PowerShell 7"
if [ ! -x "$PWSH_DIR/pwsh.exe" ]; then
  log "  downloading PowerShell ${PWSH_VER}…"
  dl "$PWSH_URL" "$TMP/pwsh.zip" && {
    unzip_to "$TMP/pwsh.zip" "$PWSH_DIR"
  } || log "  !! PowerShell download failed (non-fatal)"
else
  log "  PowerShell 7 OK"
fi

# ---------------------------------------------------------------------------
log "4/5  Claude Code CLI"
# NOTE: the official one-liner (curl https://claude.ai/install.sh | bash) hard-aborts
# on Git Bash with "Windows is not supported" (it only handles darwin/linux). So we
# install the native win32 binary ourselves, straight from the release CDN — the same
# artifact the installer would fetch on a supported OS. No cmd.exe / powershell.exe.
if [ -x "$LOCALBIN/claude.exe" ] || have claude; then
  log "  Claude Code OK ($("$LOCALBIN/claude.exe" --version 2>/dev/null | head -1))"
else
  CC_BASE="https://downloads.claude.ai/claude-code-releases"
  CC_PLATFORM="win32-${WINARCH}"
  log "  installing Claude Code (native ${CC_PLATFORM} binary)…"
  CC_VER="$(curl -fsSL --retry 4 --retry-delay 2 "$CC_BASE/latest" 2>/dev/null)"
  if [[ ! "$CC_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    log "  !! couldn't resolve latest version (got: '${CC_VER:0:40}'). Check network/region — skipping."
  else
    log "  latest = $CC_VER"
    CC_MANIFEST="$(curl -fsSL --retry 4 --retry-delay 2 "$CC_BASE/$CC_VER/manifest.json" 2>/dev/null)"
    # Parse the manifest with Node (guaranteed present by step 2) → "<binary> <sha256>".
    CC_INFO="$(printf '%s' "$CC_MANIFEST" | "$NODE_DIR/node.exe" -e \
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).platforms["win32-'"$WINARCH"'"];process.stdout.write((p.binary||"claude.exe")+" "+(p.checksum||""))}catch(e){}})' 2>/dev/null)"
    CC_BIN="$(echo "$CC_INFO" | cut -d' ' -f1)"; CC_BIN="${CC_BIN:-claude.exe}"
    CC_SUM="$(echo "$CC_INFO" | cut -d' ' -f2)"
    mkdir -p "$LOCALBIN"
    if dl "$CC_BASE/$CC_VER/$CC_PLATFORM/$CC_BIN" "$LOCALBIN/claude.exe"; then
      if [ -n "$CC_SUM" ] && have sha256sum; then
        ACTUAL="$(sha256sum "$LOCALBIN/claude.exe" | cut -d' ' -f1)"
        if [ "$ACTUAL" = "$CC_SUM" ]; then
          log "  Claude Code installed + checksum verified ($CC_VER)"
        else
          log "  !! checksum mismatch — deleting partial download"; rm -f "$LOCALBIN/claude.exe"
        fi
      else
        log "  Claude Code installed ($CC_VER; checksum unverified)"
      fi
    else
      log "  !! Claude Code download failed — see https://code.claude.com/docs"
    fi
  fi
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
    dl "$ELECTRON_URL" "$TMP/electron.zip" && {
      unzip_to "$TMP/electron.zip" node_modules/electron/dist
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
