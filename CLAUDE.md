# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Claude Forge

Project guidance for Claude Code working in this repo. Read before building, running, or editing.

## What this is
**Claude Forge** — an Electron desktop GUI wrapper over `@anthropic-ai/claude-agent-sdk`. A daily-driver "forge" for agentic work with a dark amber blacksmith theme. Electron + TypeScript + React, bundled by **electron-vite**. Three layers: `main` (Node), `preload` (bridge), `renderer` (React).

BYO-key / subscription, **local-only** — secrets never leave the machine to any third-party server. Auth supports Claude **subscription** (reuses `~/.claude` login), setup-token, or API key.

## Architecture map
- `src/main/agent.ts` — core SDK runner. `runStreaming(sender, runId, prompt, opts)` is **per-runId and concurrency-safe** (active Map keyed by runId; every emitted `AgentEvent` carries `runId`). Also `getCapabilities` / `getSessions` / `getUsage` / `getTranscript` / `compactSession` / `interruptRun` / `respondPermission`. `RunOptions` includes model, effort, permission, resume, attachments, maxTurns, maxBudgetUsd, **systemPrompt** (per-agent persona for Squad). runStreaming + getCapabilities wire the EXTEND features into the SDK: `settingSources:['user','project']`, `skills`, `mcpServers`, `plugins`.
- `src/main/auth.ts` — auth status + mode switching. `resolveAuthEnv()` **strips `ANTHROPIC_API_KEY`** in subscription mode (an API key would otherwise outrank the subscription).
- `src/main/persona.ts` — global custom system prompt (`append` | `replace` modes).
- `src/main/{skills,commands,hooks,mcp,agents,plugins}.ts` — per-feature backends for the **EXTEND** tab, plus shared `frontmatter.ts` (YAML frontmatter parse/serialize) and `projectSettings.ts` (`.claude/settings.json` read/write). Source of truth is the filesystem `.claude/` (skills/commands/agents files, settings.json hooks) **except** MCP servers, plugins, and skill-toggles, which live in Forge-private `forge-{skills,mcp,plugins}.json` so secrets stay out of model-readable `.claude/`.
- `src/main/index.ts` — `BrowserWindow` (frameless, custom titlebar) + all `ipcMain` handlers (~41). Dev loads `ELECTRON_RENDERER_URL`; prod `loadFile(out/renderer/index.html)`.
- `src/preload/index.ts` — exposes `window.forge` = `{ auth, agent.{start,interrupt,respondPermission,capabilities,sessions,usage,transcript,compact,onEvent}, persona, window, ... }` plus EXTEND IPC.
- `src/renderer/src/App.tsx` (~3600 lines) — **all UI**. `App → TitleBar + MainShell | AuthGate`. `MainShell` holds sidebar state + `view: 'chat' | 'squad' | 'extend'`. Reusable pieces: `reduceBlocks`, `BlockView`, `TurnView`, `HistoryView`, `PermissionModal`, `PersonaModal`, `Composer` (CHAT), `SquadView` (multi-agent SQUAD), the EXTEND console. Event routing is by `runId`.
- `src/renderer/src/styles.css` (~1900 lines) — theme vars (`--bg #0b0a09`, `--amber #e8932a`, Pretendard mono) + all layout. Imported from `main.tsx`.
- `src/renderer/src/components/` — `AuthGate.tsx`, `Md.tsx` (markdown).

## Commands
A `.npmrc` sets `script-shell` to Git Bash and every `package.json` script invokes its tool through an explicit `node node_modules/.../bin` path, so `npm run <script>` now works even on the locked-down Windows box (it no longer routes through the blocked `cmd.exe`). Both forms below are equivalent — prefix with the PATH export on the Windows env (see below).

```bash
npm run dev          # electron-vite dev — window on desktop; 4 electron procs = healthy
npm run build        # production build → out/
npm run start        # preview the built app (electron-vite preview)
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run lint         # eslint src --ext .ts,.tsx
npm run format       # prettier --write src
node scripts/smoke.mjs   # SDK smoke test: 3 concurrent queries w/ per-run systemPrompt run in parallel
```

ESLint config: `.eslintrc.json` (`@typescript-eslint` + `react-hooks`; `no-explicit-any`/`no-unused-vars`/`no-console` are warnings). Prettier: `.prettierrc.json` (no semis, single quotes, width 100, no trailing comma, LF).

## Build & run — locked-down Windows env (REQUIRED workarounds)
This machine fights the Node/Electron toolchain, **and resets on reboot** (frozen/non-persistent — tools and deps vanish). `bootstrap/` automates full recovery; the manual notes below explain *why* each workaround exists when you need to debug or reapply one.

**Fast path after a reset:** run `bootstrap/setup.exe` (downloads Node + PortableGit, then runs `install.sh`), or from any Git Bash: `bash bootstrap/install.sh` (idempotent; prints `[bootstrap] …` per step). It installs PowerShell 7 + Claude Code and restores deps with all patches applied. See `bootstrap/README.md`.

The individual hurdles `install.sh` handles for you:

1. **Node** is at `C:\Users\CKIRUser\tools\node` (manual install, no admin). The Bash tool does **not** source `~/.bashrc`, so prefix every command:
   `export PATH="/c/Users/CKIRUser/tools/node:$PATH"`
2. **cmd.exe and PowerShell 5.1 are blocked** (spawn EPERM −4048). npm lifecycle scripts run via cmd.exe → fail. Install with **`npm install --ignore-scripts`**.
3. **AV quarantines some esbuild binaries** (0.27.x deleted seconds after landing; 0.25.12 survives). Keep `vite` pinned to **`^6`** and `@vitejs/plugin-react` to `^4`. Don't hand-place esbuild.exe.
4. **electron binary**: `--ignore-scripts` skips it and its extract-zip fails (DLOPEN). Fetch manually: download `electron-v<ver>-win32-x64.zip` from GitHub releases, `unzip` into `node_modules/electron/dist`, then `printf 'electron.exe' > node_modules/electron/path.txt` (use **printf, not echo** — a trailing newline → `electron.exe\n` → ENOENT).
5. **vite patch** (`bootstrap/patch-vite.mjs`): vite calls `exec("net use")` (→ cmd.exe) for network-drive realpath. In `node_modules/vite/dist/node/chunks/dep-*.js` replace the `exec("net use", ...)` block with `safeRealpathSync = fs__default.realpathSync.native;`. Lost on `npm install`; reapply (the patch script does this).

**Raw commands** (when not using `npm run`; Bash tool, sandbox disabled for spawns that launch electron):
```bash
export PATH="/c/Users/CKIRUser/tools/node:$PATH"
node node_modules/electron-vite/bin/electron-vite.js dev      # run
node node_modules/electron-vite/bin/electron-vite.js build    # build → out/
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   # typecheck
```

## Shell — tool routing priority (STRICT)
Run **every** command through this fallback chain, in order. Do not skip to a lower tier unless the one above genuinely can't do the job.

1. **Git Bash (PRIMARY)** — `C:\Users\CKIRUser\PortableGit\bin\bash.exe`. This is the only reliable shell here; `.npmrc` already points `script-shell` at it. **Launch Claude Code itself from a Git Bash terminal** so the harness exposes a working Bash tool (the default PowerShell tool below is dead). The Bash tool does **not** source `~/.bashrc` — prefix commands with `export PATH="/c/Users/CKIRUser/tools/node:$PATH"` (see the env-workarounds section).
2. **PowerShell 7 / pwsh (FALLBACK)** — `C:\Users\CKIRUser\Downloads\PowerShell-7.6.2-win-x64\pwsh.exe`, i.e. `/c/Users/CKIRUser/Downloads/PowerShell-7.6.2-win-x64/pwsh -NoProfile -Command "..."`. Use **only** for things Git Bash can't do: process management (`Get-Process electron,node | Stop-Process -Force` — `tasklist`/`wmic` don't reliably see the manually-placed `electron.exe`) and Win32/`Add-Type` screenshots.
3. **❌ NEVER PowerShell 5.1 (`powershell.exe`) or `cmd.exe`** — both are **blocked** on this machine and fail with `EPERM −4048 (uv_spawn)`. The harness's built-in "PowerShell" tool maps to 5.1, so it is unusable; never route a command through it.

## Verifying UI changes (do this — screenshots/measurements alone mislead)
Renderer verification is hard here: HMR is unreliable, and **zombie dev/electron instances from prior sessions cause stale-render confusion**. Procedure:
1. **Kill everything first**, then start ONE: `pwsh ... "Get-Process electron,node | Stop-Process -Force"`.
2. For ground truth, build and run prod with CDP:
   `./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222`
3. Probe **computed styles** via a Node script (Node 24 has global `WebSocket`): `fetch http://127.0.0.1:9222/json` → connect `webSocketDebuggerUrl` → `Runtime.evaluate` running `getComputedStyle(el)`. This is authoritative; `document.title` box-measurement hacks proved unreliable. Reusable drivers: `cdp-extend.mjs` (CDP), `scripts/smoke.mjs` (SDK).
4. For occlusion-free screenshots use Win32 **`PrintWindow(hwnd, hdc, 2)`** (PW_RENDERFULLCONTENT) via `Add-Type` in pwsh — not `CopyFromScreen` (a foreground terminal overlaps it).

## Packaging a distributable `.exe` (electron-builder)
Config: `electron-builder.yml` (target **nsis** installer; `asar: false`). Build the renderer first (`electron-vite build` → `out/`), then run electron-builder via node (use the explicit node path for the `.bin` shim):
```bash
node node_modules/electron-builder/cli.js --win --dir   --publish never   # unpacked → dist/win-unpacked/Claude Forge.exe (fast, for testing)
node node_modules/electron-builder/cli.js --win nsis --publish never       # installer → dist/Claude Forge Setup <ver>.exe
```
Two env-specific hurdles (`bootstrap/patch-app-builder.mjs` handles the first; both are lost on `npm install` — reapply like the Vite patch):
1. **Collector patch** — electron-builder 26's node-module collector spawns `powershell.exe -EncodedCommand` to run `npm list`; here `powershell.exe`/`cmd.exe` are blocked → `spawn powershell.exe ENOENT`, build fails. Patched `node_modules/app-builder-lib/out/node-module-collector/nodeModulesCollector.js` (the `streamCollectorCommandToFile` win32 branch) to run npm directly via `node <node-dir>/node_modules/npm/bin/npm-cli.js` instead.
2. **`asar: false`** — the Agent SDK spawns its bundled `claude.exe` by on-disk path; inside an asar archive that path isn't executable (renderer shows *"claude.exe exists but failed to launch"*). With asar off, `claude.exe` is a real file at `resources/app/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` and spawns fine. NSIS/winCodeSign/7z downloads from GitHub releases worked here (not AV-blocked). Verify a packaged build by launching `dist/win-unpacked/Claude Forge.exe --remote-debugging-port=9222` and driving a test prompt via CDP — confirm a real reply, not the launch error.

## Gotchas
- **CSS unclosed-brace footgun**: a single stray `{` in `styles.css` makes modern Chromium's **CSS nesting** swallow ALL following rules as descendants — they silently stop matching (e.g. a dangling `.session-cost {` once broke the entire CHAT layout). After editing CSS, sanity-check brace balance: `grep -o '{' styles.css | wc -l` must equal `grep -o '}' ...`.
- **Flexbox height**: in a flex column, prefer `flex: 1; min-height: 0` over `height: 100%` for fill children (percentage height resolution against flex items is fragile in Chromium).
- **Inline styles** (`style={{ display: ... }}`) override CSS class rules — watch for `'block'` vs `'flex'` clobbering layout.
- **Subscription thinking text** is **encrypted/empty on Opus 4.8** but **visible on Sonnet 4.6**.
- SDK **slash commands** (`/usage`, `/context`, …) execute when sent as the prompt; REPL-only ones (`/model`, `/help`) are handled client-side in the renderer. Control methods (`supportedModels`/`supportedCommands`/`mcpServerStatus`) resolve **without** iterating the stream.

## Constraints (do NOT violate)
- **Never port `C:\Users\CKIRUser\Downloads\free-code-main`.** It is leaked Anthropic Claude Code source with safety guardrails stripped. Build every feature from scratch via the official SDK. (The SDK's safety guardrails are intentional and must stay intact.)
- Keep it **local-only / BYO-key**; never send secrets or user content to a third-party server.
- Squad (multi-agent) defaults to **PLAN / read-only** permission per agent (safety-first; parallel runs must not collide on files). The global **max $/run** applies per agent — N agents multiply cost.
- MCP servers, plugins, and skill-toggles must stay **out of `.claude/`** (in Forge-private `forge-*.json`) so secrets aren't model-readable.

## Status
8-step app complete and running. Done: subscription auth, transcript restore, prompt history, message actions, image attachment, subscription **usage %** panel, token-optimization tiers 1–4, Pretendard font, arbitrary `/model <id>`, custom titlebar/scrollbar, and **Squad** multi-agent mode. Plan: `~/.claude/plans/stateful-swimming-yeti.md`.

**Extensibility roadmap (`docs/ROADMAP.md`) — COMPLETE.** The **EXTEND** tab (CHAT | SQUAD | EXTEND) is a GUI console over the filesystem `.claude/`: Skills, Commands, Hooks, MCP, Agents, Plugins (architecture above). Also landed: **AskUserQuestion** routes via `canUseTool` (renders QuestionModal) and the pinned **TODO bar** reconstructs from Task tools. Verified end-to-end via CDP scripts (`cdp-*.mjs`).

**Tooling/infra:** ESLint + Prettier configured; `bootstrap/` provides one-step environment recovery for the reset-on-reboot machine; `scripts/smoke.mjs` is a standalone SDK concurrency check.
