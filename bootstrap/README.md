# Claude Forge — environment bootstrap

This machine **resets on reboot** (frozen/non-persistent): tools, dependencies,
and Claude Code all vanish. This folder restores the whole working environment
from scratch so you can get back to developing Claude Forge in one step.

## Use it (after a reset)

1. On GitHub, **Code → Download ZIP** (or download just this repo), and extract it
   somewhere persistent enough to run from (Desktop/Downloads is fine).
2. Open the `claude-forge/bootstrap/` folder and **double-click `setup.exe`**.
3. Watch the progress window. It will:
   - download **Node.js** + **Git for Windows (PortableGit)** using `curl`/`tar`
     (both ship with Windows — no cmd/PowerShell needed),
   - then run **`install.sh`**, which installs **PowerShell 7** + **Claude Code**
     (the official `claude.ai/install.sh` refuses to run on Git Bash, so the
     native `win32` binary is fetched directly and checksum-verified) and
     restores the **claude-forge** dependencies with all the local workarounds
     (manual Electron binary, Vite patch, electron-builder patch).
4. When it finishes, open **Git Bash** and:
   ```bash
   claude                       # log in to your Claude subscription
   cd claude-forge && npm run dev   # launch Claude Forge
   ```

That's it — git bash, Node, PATH, Claude Code, and the app are all back.

## What gets installed / where
| Tool | Location | Source |
|---|---|---|
| Node.js 24.16.0 | `C:\Users\CKIRUser\tools\node` | nodejs.org |
| Git for Windows | `C:\Users\CKIRUser\PortableGit` | git-for-windows (GitHub) |
| PowerShell 7.6.2 | `C:\Users\CKIRUser\Downloads\PowerShell-7.6.2-win-x64` | GitHub |
| Claude Code | `C:\Users\CKIRUser\.local\bin\claude.exe` | native `win32-x64` binary from the release CDN (checksum-verified) |
| PATH | `~/.bashrc` (`tools/node`, `~/.local/bin`) | written by `install.sh` |
| Forge deps | `claude-forge/node_modules` | `npm install --ignore-scripts` + patches |

## Files here
- **`setup.exe`** — the bare-Windows entry point (compiled from `setup.nsi`).
- **`setup.nsi`** — its NSIS source (recompile with `makensis setup.nsi`).
- **`install.sh`** — the engine. Does the real work; safe to re-run (idempotent).
- **`patch-vite.mjs`** — neutralizes Vite's `exec("net use")` (→ blocked cmd.exe).
- **`patch-app-builder.mjs`** — fixes electron-builder's npm collector (→ blocked powershell.exe). Only needed when building the distributable `.exe`.

## If `setup.exe` fails / manual fallback
The heavy lifting lives in `install.sh`, so once **any** Git Bash is available you
can finish (or redo) the setup by hand:
```bash
# from a Git Bash prompt, inside the extracted repo:
bash bootstrap/install.sh
```
Each step prints `[bootstrap] …`; re-running is safe. If a single tool fails,
the log says which, and you can install just that one and re-run.

## Notes & caveats
- **Unsigned** — Windows SmartScreen may warn on first run of `setup.exe`
  ("More info → Run anyway"). Normal for a personal build.
- **Credentials are NOT included** (by design). Your Claude login lives in
  `~/.claude` and is re-created when you run `claude` and sign in.
- **Pinned versions** — download URLs point at fixed versions (Node 24.16.0,
  PowerShell 7.6.2, PortableGit 2.51.0, Electron 42.4.0). If one 404s later,
  bump the version in `setup.nsi` / `install.sh`.
- **Not testable from here** — a true cold-boot (fully wiped machine) can't be
  simulated during development, so test it once on a real reset and report any
  step that needs adjusting.
